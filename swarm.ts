import { spawn, ChildProcess } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

/**
 * Swarm Configuration
 */
const SCANNER_MODEL = "featherless-ai/zai-org/GLM-4-9B"; // Cost: 1 (fast, cheap parallel scanning)
const WRITER_MODEL = "featherless-ai/Qwen/Qwen3-32B";   // Cost: 2 (high precision writing)

const SCANNER_SYSTEM_PROMPT = `You are a high-speed codebase scanner. 
Your goal is to quickly summarize a file's purpose, key logic, and exported interface so a smarter "architect" model can decide how to use it.

RULES:
1. FOCUS: Pay special attention to parts of the file relevant to the ARCHITECT'S QUERY.
2. CORE RESPONSIBILITY: Identify what the file does.
3. INTERFACE: List key functions, classes, or data structures.
4. LOGIC: Briefly explain any complex logic or unique patterns.
5. CONCISENESS: Be technical and extremely concise. No conversational filler.`;

interface SwarmAgent {
    id: string;
    model: string;
    task: string;
    status: "pending" | "running" | "completed" | "failed";
    output: string;
    lastEvent?: string; // Latest captured event (tool call, thinking, etc)
    process?: ChildProcess;
}

const activeSwarm = new Map<string, SwarmAgent>();

/**
 * Update the Swarm UI widget
 */
function updateSwarmWidget(ctx: ExtensionContext) {
    const lines: string[] = [" 🐝 Swarm Activity "];
    
    if (activeSwarm.size === 0) {
        lines.push(" Idle");
    } else {
        for (const agent of activeSwarm.values()) {
            const icon = agent.status === "running" ? "⏳" : agent.status === "completed" ? "✅" : "❌";
            const taskPreview = agent.task.length > 20 ? agent.task.slice(0, 17) + "..." : agent.task;
            
            // Add the latest event for live "observation"
            const eventStr = agent.lastEvent ? ` > ${agent.lastEvent}` : "";
            lines.push(` ${icon} [${agent.id}] ${taskPreview}${eventStr}`);
        }
    }
    
    ctx.ui.setWidget("featherless-swarm", lines, { placement: "aboveEditor" });
}

/**
 * Run a subagent process
 */
async function runSubagent(
    ctx: ExtensionContext, 
    id: string, 
    model: string, 
    task: string,
    systemPrompt?: string
): Promise<string> {
    const agent: SwarmAgent = { id, model, task, status: "running", output: "" };
    activeSwarm.set(id, agent);
    updateSwarmWidget(ctx);

    return new Promise((resolve, reject) => {
        // Spawn pi in JSON mode for structured output
        const args = [
            "--model", model,
            "--mode", "json",
            "-p",
            "--no-session"
        ];

        if (systemPrompt) {
            args.push("--system-prompt", systemPrompt);
        }

        args.push(task);

        const child = spawn("pi", args, {
            cwd: ctx.cwd,
            env: { ...process.env, FEATHERLESS_SWARM_MEMBER: "1" }
        });

        agent.process = child;

        // Handle ESC / Abort signal
        const onAbort = () => {
            if (!child.killed) {
                child.kill("SIGINT");
                agent.status = "failed";
                agent.lastEvent = "Interrupted (ESC)";
                updateSwarmWidget(ctx);
            }
        };
        signal?.addEventListener("abort", onAbort);

        let stdoutBuffer = "";
        let stdoutAccumulated = "";

        child.stdout.on("data", (data) => {
            const chunk = data.toString();
            stdoutAccumulated += chunk;
            stdoutBuffer += chunk;
            
            // Parse streaming JSON lines to update live status
            const lines = stdoutBuffer.split("\n");
            stdoutBuffer = lines.pop() || "";
            
            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const event = JSON.parse(line);
                    
                    // Capture high-signal events for the UI
                    if (event.type === "message_update" && event.message.role === "assistant") {
                        // Capture streaming thinking and text
                        const content = event.message.content || [];
                        const lastBlock = content[content.length - 1];
                        if (lastBlock?.type === "thinking") {
                            const thought = lastBlock.thinking || "";
                            agent.lastEvent = thought.length > 25 ? thought.slice(-22) + "..." : thought;
                        } else if (lastBlock?.type === "text") {
                            const text = lastBlock.text || "";
                            agent.lastEvent = text.length > 25 ? text.slice(-22) + "..." : text;
                        }
                    } else if (event.type === "message_start") {
                        agent.lastEvent = "Thinking...";
                    } else if (event.type === "tool_execution_start") {
                        agent.lastEvent = `Using ${event.toolName}`;
                    } else if (event.type === "tool_execution_end") {
                        agent.lastEvent = `Finished ${event.toolName}`;
                    } else if (event.type === "message_end" && event.message.role === "assistant") {
                        agent.lastEvent = "Responding...";
                    }
                    
                    updateSwarmWidget(ctx);
                } catch (e) {
                    // Ignore partial/invalid JSON
                }
            }
        });

        child.on("close", (code) => {
            agent.status = code === 0 ? "completed" : "failed";
            // Capture all previous output before closing
            agent.lastEvent = code === 0 ? "Done" : `Failed (${code})`;
            updateSwarmWidget(ctx);
            
            // Re-parse the final output to ensure we didn't miss anything from the last buffer chunk
            const finalLines = (stdoutBuffer + stdoutAccumulated).split("\n").filter(l => l.trim());
            let finalContent = "";
            
            if (code === 0) {
                try {
                    for (const line of finalLines) {
                        try {
                            const event = JSON.parse(line);
                            if (event.type === "message_end" && event.message.role === "assistant") {
                                finalContent = event.message.content.map((c: any) => c.text || "").join("");
                            }
                        } catch(e) {}
                    }
                    resolve(finalContent || stdoutAccumulated);
                } catch (e) {
                    resolve(stdoutAccumulated); // Fallback to raw output
                }
            } else {
                reject(new Error(`Agent ${id} failed with code ${code}`));
            }
        });
    });
}

export function registerSwarmTools(pi: ExtensionAPI) {
    pi.registerTool({
        name: "swarm_scan",
        label: "Swarm Scan",
        description: "Spawn parallel subagents to scan multiple files and return relevant info.",
        parameters: {
            type: "object",
            properties: {
                files: { type: "array", items: { type: "string" }, description: "List of file paths to scan." },
                query: { type: "string", description: "What to look for in these files." }
            },
            required: ["files", "query"]
        },
        async execute(toolCallId, params: any, signal, onUpdate, ctx) {
            const { files, query } = params;
            
            ctx.ui.notify(`Launching swarm to analyze ${files.length} files...`, "info");
            
            // Run in parallel with concurrency limit (respecting Featherless plan)
            const results = await Promise.all(files.map((file: string, index: number) => {
                const id = `scan-${index}`;
                const task = `ARCHITECT'S QUERY: "${query}"
Analyze file: ${file}
Report back on the file's purpose and contents as they relate to the architect's query.`;
                return runSubagent(ctx, id, SCANNER_MODEL, task, SCANNER_SYSTEM_PROMPT);
            }));

            // Clear swarm after completion
            activeSwarm.clear();
            updateSwarmWidget(ctx);

            return {
                content: [{ type: "text", text: results.join("\n\n---\n\n") }],
                details: { files_scanned: files.length }
            };
        }
    });

    pi.registerTool({
        name: "swarm_write",
        label: "Swarm Write",
        description: "Delegate a file write/edit operation to a high-speed subagent.",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "File path to modify." },
                plan: { type: "string", description: "Detailed instruction on what to change." }
            },
            required: ["path", "plan"]
        },
        async execute(toolCallId, params: any, signal, onUpdate, ctx) {
            const { path, plan } = params;
            const id = "writer";
            const task = `Modify file ${path} according to this plan: ${plan}. Verify your changes by reading the file back.`;
            
            const result = await runSubagent(ctx, id, WRITER_MODEL, task);
            
            activeSwarm.clear();
            updateSwarmWidget(ctx);

            return {
                content: [{ type: "text", text: result }],
                details: { file_modified: path }
            };
        }
    });
}
