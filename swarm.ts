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
    lastEvent?: string; 
    startTime: number;
    duration?: number;
    process?: ChildProcess;
}

const activeSwarm = new Map<string, SwarmAgent>();

function updateSwarmWidget(ctx: ExtensionContext) {
    const theme = ctx.ui.theme;
    const lines: string[] = [
        theme.fg("accent", theme.bold(" 🐝 FEATHERLESS BEEHIVE ")) + theme.fg("muted", `[${activeSwarm.size} AGENTS ACTIVE] ─────────────────`)
    ];
    
    if (activeSwarm.size === 0) {
        lines.push(theme.fg("muted", "  Waiting for instructions..."));
    } else {
        const now = Date.now();
        for (const agent of activeSwarm.values()) {
            let statusIcon = "";
            let statusColor: any = "muted";
            
            switch (agent.status) {
                case "running":
                    statusIcon = "⏳";
                    statusColor = "accent";
                    break;
                case "completed":
                    statusIcon = "✅";
                    statusColor = "success";
                    break;
                case "failed":
                    statusIcon = "❌";
                    statusColor = "error";
                    break;
            }

            const elapsed = agent.duration || (now - agent.startTime);
            const timerStr = theme.fg("dim", `[${(elapsed / 1000).toFixed(1)}s]`);
            const idStr = theme.fg("accent", `[${agent.id}]`);
            const eventStr = agent.lastEvent ? theme.fg(statusColor, ` ${agent.lastEvent}`) : theme.fg("muted", " Initializing...");
            lines.push(` ${statusIcon} ${idStr} ${timerStr}${eventStr}`);
        }
    }
    lines.push(theme.fg("muted", " ─────────────────────────────────────────────────────────────"));
    ctx.ui.setWidget("featherless-swarm", lines, { placement: "aboveEditor" });
}

async function runSubagent(
    ctx: ExtensionContext, 
    id: string, 
    model: string, 
    task: string,
    systemPrompt?: string,
    signal?: AbortSignal
): Promise<string> {
    const agent: SwarmAgent = { id, model, task, status: "running", output: "", startTime: Date.now() };
    activeSwarm.set(id, agent);
    
    return new Promise((resolve, reject) => {
        const args = ["--model", model, "--mode", "json", "-p", "--no-session"];
        if (systemPrompt) args.push("--system-prompt", systemPrompt);
        args.push(task);

        const child = spawn("pi", args, {
            cwd: ctx.cwd,
            env: { ...process.env, FEATHERLESS_SWARM_MEMBER: "1" }
        });

        agent.process = child;
        let stdoutBuffer = "";
        let stdoutAccumulated = "";

        child.stdout.on("data", (data) => {
            const chunk = data.toString();
            stdoutAccumulated += chunk;
            stdoutBuffer += chunk;
            
            const lines = stdoutBuffer.split("\n");
            stdoutBuffer = lines.pop() || "";
            
            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const event = JSON.parse(line);
                    if (event.type === "message_update" && event.message.role === "assistant") {
                        const content = event.message.content || [];
                        const lastBlock = content[content.length - 1];
                        if (lastBlock?.type === "thinking") {
                            agent.lastEvent = lastBlock.thinking.slice(-30);
                        } else if (lastBlock?.type === "text") {
                            agent.lastEvent = lastBlock.text.slice(-30);
                        }
                    } else if (event.type === "tool_execution_start") {
                        agent.lastEvent = `Using ${event.toolName}`;
                    }
                    updateSwarmWidget(ctx);
                } catch (e) {}
            }
        });

        child.on("close", (code) => {
            agent.status = code === 0 ? "completed" : "failed";
            agent.duration = Date.now() - agent.startTime;
            updateSwarmWidget(ctx);
            
            if (code === 0) {
                const finalLines = (stdoutAccumulated).split("\n").filter(l => l.trim());
                let finalContent = "";
                for (const line of finalLines) {
                    try {
                        const event = JSON.parse(line);
                        if (event.type === "message_end" && event.message.role === "assistant") {
                            finalContent = event.message.content.map((c: any) => c.text || "").join("");
                        }
                    } catch(e) {}
                }
                resolve(finalContent || stdoutAccumulated);
            } else {
                reject(new Error(`Agent ${id} failed with code ${code}`));
            }
        });

        signal?.addEventListener("abort", () => {
            if (!child.killed) {
                child.kill("SIGINT");
                agent.status = "failed";
                agent.lastEvent = "Interrupted";
                updateSwarmWidget(ctx);
            }
        });
    });
}

export function registerSwarmTools(pi: ExtensionAPI) {
    pi.registerTool({
        name: "swarm_scan",
        label: "Swarm Scan",
        description: "Analyze multiple files in parallel using subagents.",
        parameters: {
            type: "object",
            properties: {
                files: { type: "array", items: { type: "string" } },
                query: { type: "string" }
            },
            required: ["files", "query"]
        },
        async execute(toolCallId, params: any, signal, onUpdate, ctx) {
            const { files, query } = params;
            
            // PAUSE MECHANISM: Releasing concurrency of the main agent while the swarm runs
            // This allows the subagents (cost 1 each) to use the 4 units of CC.
            const modelId = ctx.model?.id;
            const released = modelId ? (pi as any)._releaseConcurrency?.(modelId) : false;
            if (released) {
                ctx.ui.notify("Main agent CC yielded to swarm.", "info");
            }

            const uiInterval = setInterval(() => updateSwarmWidget(ctx), 500);
            
            try {
                const results = await Promise.all(files.map((file: string, index: number) => {
                    const id = `scan-${index}`;
                    const task = `ARCHITECT'S QUERY: "${query}"\nAnalyze file: ${file}`;
                    return runSubagent(ctx, id, SCANNER_MODEL, task, SCANNER_SYSTEM_PROMPT, signal);
                }));

                // Format each subagent's report as a distinct block for the architect's context
                const formattedReports = results.map((report, index) => {
                    return `### SUBAGENT REPORT [${index}] - ${files[index]}\n${report}`;
                }).join("\n\n---\n\n");

                return { 
                    content: [{ type: "text", text: formattedReports }],
                    details: { files_scanned: files.length, subagent_ids: results.map((_, i) => `scan-${i}`) }
                };
            } finally {
                clearInterval(uiInterval);
                activeSwarm.clear();
                updateSwarmWidget(ctx);
                
                // RESTORE MECHANISM: The main agent's turn will automatically re-register 
                // its concurrency on the next provider request after this tool returns.
            }
        }
    });

    pi.registerTool({
        name: "swarm_write",
        label: "Swarm Write",
        description: "Delegate file edits to a subagent.",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string" },
                plan: { type: "string" }
            },
            required: ["path", "plan"]
        },
        async execute(toolCallId, params: any, signal, onUpdate, ctx) {
            const { path, plan } = params;
            const task = `Edit ${path}: ${plan}`;
            const result = await runSubagent(ctx, "writer", WRITER_MODEL, task, undefined, signal);
            activeSwarm.clear();
            updateSwarmWidget(ctx);
            return { content: [{ type: "text", text: result }] };
        }
    });
}
