import { readFileSync } from "fs";
import { Type } from "@sinclair/typebox";
import type { Model } from "@mariozechner/pi-ai";
import { completeSimple } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { defineTool } from "@mariozechner/pi-coding-agent";
import type { Component, TUI } from "@mariozechner/pi-tui";
import { PROVIDER, getApiKey } from "./shared";

// ─── colours ──────────────────────────────────────────────────────────────────

const R          = "\x1b[0m";
const WHITE_FG   = "\x1b[97m";
const BOT_BG     = ["\x1b[48;5;23m", "\x1b[48;5;130m", "\x1b[48;5;53m", "\x1b[48;5;22m"];
const EMPTY_BG   = "\x1b[48;5;236m";
const OVERALL_FILL_BG  = "\x1b[48;5;18m";
const OVERALL_EMPTY_BG = "\x1b[48;5;234m";

function bgBar(
    plainText: string,
    width: number,
    pct: number,
    fillBg: string,
    emptyBg: string,
): string {
    const padded  = plainText.padEnd(width).slice(0, width);
    const filledW = Math.round((pct / 100) * width);
    return `${fillBg}${WHITE_FG}${padded.slice(0, filledW)}${R}${emptyBg}${WHITE_FG}${padded.slice(filledW)}${R}`;
}

// ─── SwarmPanel component ─────────────────────────────────────────────────────

interface BotState {
    label: string;
    progress: number;   // 0–100
    snippet: string;    // partial response shown inline
    status: "idle" | "working" | "done" | "error";
}

class SwarmPanel implements Component {
    bots: BotState[];
    doneCount = 0;
    private _requestRender: (() => void) | null = null;

    constructor(labels: string[]) {
        this.bots = labels.map(label => ({
            label, progress: 0, snippet: "", status: "idle" as const,
        }));
    }

    /** Called once the TUI instance is available. */
    attach(tui: TUI) {
        this._requestRender = tui.requestRender.bind(tui);
    }

    requestRender() {
        this._requestRender?.();
    }

    render(w: number): string[] {
        const lines: string[] = [];

        // overall bar
        const overallPct = this.bots.length === 0 ? 0
            : Math.round((this.doneCount / this.bots.length) * 100);
        const overallLabel = `  ◈ swarm  ${this.doneCount}/${this.bots.length}  ${overallPct}%`;
        lines.push(bgBar(overallLabel, w, overallPct, OVERALL_FILL_BG, OVERALL_EMPTY_BG));
        lines.push("");

        // one line per bot (up to 8; clamp for very large swarms)
        const visible = this.bots.slice(0, 8);
        for (let i = 0; i < visible.length; i++) {
            const b = visible[i];
            const colorIdx = i % BOT_BG.length;
            const pctStr  = b.status !== "idle" ? `  ${String(b.progress).padStart(3)}%` : "";
            const tag     = b.status === "error" ? " ✗" : b.status === "done" ? " ✓" : "";
            const label   = `  ${b.label}${tag}`;
            const snip    = b.snippet ? `  ${b.snippet}` : (b.status === "idle" ? "  waiting" : "");
            const rightW  = pctStr.length;
            const leftMax = w - rightW;
            let left = label + snip;
            if (left.length > leftMax) left = left.slice(0, leftMax);
            const plain = left.padEnd(leftMax) + pctStr;
            lines.push(bgBar(plain, w, b.progress, BOT_BG[colorIdx], EMPTY_BG));
        }

        if (this.bots.length > 8) {
            const rest = `  … and ${this.bots.length - 8} more`;
            lines.push(EMPTY_BG + WHITE_FG + rest.padEnd(w).slice(0, w) + R);
        }

        return lines;
    }

    invalidate() {}
}

// ─── semaphore ────────────────────────────────────────────────────────────────

function semaphore(limit: number) {
    let running = 0;
    const queue: (() => void)[] = [];
    return async function run<T>(fn: () => Promise<T>): Promise<T> {
        if (running >= limit) await new Promise<void>(res => queue.push(res));
        running++;
        try { return await fn(); }
        finally {
            running--;
            queue.shift()?.();
        }
    };
}

// ─── tool registration ────────────────────────────────────────────────────────

export function registerSwarm(pi: ExtensionAPI) {
    pi.registerTool(defineTool({
        name: "swarm",
        description:
            "Fan out a question or task to multiple files in parallel using concurrent LLM workers. " +
            "Use this when you need to read and analyse many files at once (e.g. summarise all source files, " +
            "find usages across a large codebase, or answer the same question about many documents). " +
            "Each worker reads one file and answers the given question independently. Results are returned together.",
        params: Type.Object({
            question: Type.String({
                description: "The question or task each worker should answer about its assigned file.",
            }),
            files: Type.Array(Type.String(), {
                description: "List of file paths (relative to cwd) each worker will read and process.",
                minItems: 2,
            }),
        }),
        execute: async (toolCallId, params, signal, onUpdate, ctx) => {
            const model = ctx.model as Model<any> | undefined;
            const apiKey = await getApiKey(ctx);

            const { question, files } = params;
            const results: string[] = new Array(files.length).fill("");

            // Create panel and widget
            const labels = files.map(f => f.split("/").pop() ?? f);
            const panel = new SwarmPanel(labels);

            if (ctx.hasUI) {
                ctx.ui.setWidget("swarm", (tui, _theme) => {
                    panel.attach(tui);
                    return panel;
                }, { placement: "aboveEditor" });
            }

            const run = semaphore(4);

            await Promise.all(files.map((filePath, i) =>
                run(async () => {
                    const b = panel.bots[i];
                    b.status = "working";
                    b.progress = 5;
                    panel.requestRender();

                    // Read file
                    let fileContent: string;
                    try {
                        fileContent = readFileSync(filePath, "utf8");
                    } catch {
                        b.status = "error";
                        b.snippet = "file not found";
                        b.progress = 100;
                        panel.doneCount++;
                        panel.requestRender();
                        results[i] = `[error: could not read ${filePath}]`;
                        return;
                    }

                    b.progress = 20;
                    panel.requestRender();

                    // Build prompt
                    const prompt = `File: ${filePath}\n\n\`\`\`\n${fileContent.slice(0, 24000)}\n\`\`\`\n\n${question}`;

                    if (!model || !apiKey) {
                        // No LLM available — return file content as-is
                        b.status = "done";
                        b.progress = 100;
                        b.snippet = "(no model)";
                        panel.doneCount++;
                        panel.requestRender();
                        results[i] = fileContent;
                        return;
                    }

                    try {
                        // Tick progress while waiting
                        const ticker = setInterval(() => {
                            if (b.progress < 90) {
                                b.progress += 5;
                                panel.requestRender();
                            }
                        }, 200);

                        const response = await completeSimple(
                            model,
                            {
                                messages: [{
                                    role: "user",
                                    content: [{ type: "text", text: prompt }],
                                    timestamp: Date.now(),
                                }],
                            },
                            { apiKey, maxTokens: 1024, signal },
                        );

                        clearInterval(ticker);

                        const text = response.content
                            .filter((c: any) => c.type === "text")
                            .map((c: any) => c.text)
                            .join("");

                        results[i] = text;
                        b.snippet = text.slice(0, 50).replace(/\n/g, " ");
                        b.status = "done";
                        b.progress = 100;
                        panel.doneCount++;
                        panel.requestRender();

                        // Stream partial results back so the LLM can see progress
                        onUpdate?.({
                            content: [{
                                type: "text",
                                text: results
                                    .map((r, j) => r ? `### ${files[j]}\n${r}` : "")
                                    .filter(Boolean)
                                    .join("\n\n"),
                            }],
                            details: { partial: true, completed: panel.doneCount, total: files.length },
                        });
                    } catch (err: any) {
                        b.status = "error";
                        b.snippet = String(err?.message ?? err).slice(0, 40);
                        b.progress = 100;
                        panel.doneCount++;
                        panel.requestRender();
                        results[i] = `[error: ${err?.message ?? err}]`;
                    }
                })
            ));

            // Remove widget
            if (ctx.hasUI) {
                ctx.ui.setWidget("swarm", undefined);
            }

            const formatted = files
                .map((f, i) => `### ${f}\n${results[i]}`)
                .join("\n\n---\n\n");

            return {
                content: [{ type: "text", text: formatted }],
                details: { files, results },
            };
        },
    }));
}
