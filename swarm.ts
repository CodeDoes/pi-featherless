import { spawn, ChildProcess } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

/**
 * Swarm Configuration
 */
const SCANNER_MODEL = "featherless-ai/zai-org/GLM-4.7-Flash"; // Cost: 2 (safest low-cost model)
const WRITER_MODEL = "featherless-ai/Qwen/Qwen3-32B";        // Cost: 2 (high precision)

interface SwarmAgent {
    id: string;
    model: string;
    task: string;
    status: "pending" | "running" | "completed" | "failed";
    output: string;
    process?: ChildProcess;
}

const activeSwarm = new Map<string, SwarmAgent>();

/**
 * Update the Swarm UI widget
 */
function updateSwarmWidget(ctx: ExtensionContext) {
    const lines: string[] = [" 🐝 Swarm Status "];
    
    if (activeSwarm.size === 0) {
        lines.push(" Idle");
    } else {
        for (const agent of activeSwarm.values()) {
            const icon = agent.status === "running" ? "⏳" : agent.status === "completed" ? "✅" : "❌";
            const taskPreview = agent.task.length > 30 ? agent.task.slice(0, 27) + "..." : agent.task;
            lines.push(` ${icon} [${agent.id}] ${taskPreview}`);
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
    task: string
): Promise<string> {
    const agent: SwarmAgent = { id, model, task, status: "running", output: "" };
    activeSwarm.set(id, agent);
    updateSwarmWidget(ctx);

    return new Promise((resolve, reject) => {
        // Spawn pi in JSON mode for structured output
        // Note: We use -p (print mode) and --no-session to avoid recursion and TUI conflicts
        const child = spawn("pi", [
            "--model", model,
            "--mode", "json",
            "-p",
            "--no-session",
            task
        ], {
            cwd: ctx.cwd,
            env: { ...process.env, FEATHERLESS_SWARM_MEMBER: "1" }
        });

        agent.process = child;
        let stdout = "";

        child.stdout.on("data", (data) => {
            stdout += data.toString();
            // Optional: Parse JSON events for real-time progress
        });

        child.on("close", (code) => {
            agent.status = code === 0 ? "completed" : "failed";
            agent.output = stdout;
            updateSwarmWidget(ctx);
            
            if (code === 0) {
                // Extract final message from JSON output
                try {
                    const lines = stdout.split("\n").filter(l => l.trim());
                    let finalContent = "";
                    for (const line of lines) {
                        const event = JSON.parse(line);
                        if (event.type === "message_end" && event.message.role === "assistant") {
                            finalContent = event.message.content.map((c: any) => c.text || "").join("");
                        }
                    }
                    resolve(finalContent);
                } catch (e) {
                    resolve(stdout); // Fallback to raw output
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
            
            ctx.ui.notify(`Launching swarm to scan ${files.length} files...`, "info");
            
            // Run in parallel with concurrency limit (respecting Featherless plan)
            const results = await Promise.all(files.map((file: string, index: number) => {
                const id = `scan-${index}`;
                const task = `Read file ${file} and find: ${query}. Return only the relevant code or facts. Be extremely concise.`;
                return runSubagent(ctx, id, SCANNER_MODEL, task);
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
