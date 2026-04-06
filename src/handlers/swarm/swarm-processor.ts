import { readFileSync } from "fs";
import { completeSimple } from "@mariozechner/pi-ai";

import { SwarmPanel } from "./swarm-panel";
import { SwarmLogger } from "./swarm-logger";
import { SwarmConfig, SwarmFileResult } from "./swarm-types";
import { semaphore } from "./concurrency";

const DEFAULT_CONFIG: SwarmConfig = {
    concurrency: 4,
    maxFileChars: 24_000,
    timeoutMs: 20_000,
};

interface SwarmProcessingOptions {
    model: any;
    apiKey: string;
    signal: AbortSignal;
    ctx: any;
    onUpdate?: (update: any) => void;
    preReadContent?: string;
}

export class SwarmProcessor {
    private config: SwarmConfig;

    constructor(config: Partial<SwarmConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    async processFile(
        filePath: string,
        instruction: string,
        options: SwarmProcessingOptions,
    ): Promise<SwarmFileResult> {
        const { model, apiKey, signal } = options;
        const onUpdate = options.onUpdate || (() => {}); // Ensure onUpdate is always a function
        const result: SwarmFileResult = { filePath, content: "" };

        try {
            SwarmLogger.fileProcessing(options.ctx, filePath, "start");

            // Read file (or use pre-read content if available)
            const fileContent = options.preReadContent || readFileSync(filePath, "utf8");

            // Process with LLM if available
            if (model && apiKey) {
                SwarmLogger.llmCall(options.ctx, filePath, instruction);

                const prompt = this.createPrompt(
                    filePath,
                    fileContent,
                    instruction,
                );
                result.content = await this.callLLM(
                    model,
                    apiKey,
                    prompt,
                    signal,
                );
            } else {
                // Return raw content if no model
                result.content = fileContent;
            }

            SwarmLogger.fileProcessing(options.ctx, filePath, "success");
            return result;
        } catch (error) {
            result.error =
                error instanceof Error ? error : new Error(String(error));
            SwarmLogger.fileProcessing(options.ctx, filePath, "error");
            return result;
        }
    }

    private createPrompt(
        filePath: string,
        fileContent: string,
        instruction: string,
    ): string {
        const contentPreview = fileContent.slice(0, this.config.maxFileChars);
        return `File: ${filePath}\n\n\`\`\`\n${contentPreview}\n\`\`\`\n\n${instruction}`;
    }

    private async callLLM(
        model: any,
        apiKey: string,
        prompt: string,
        signal: AbortSignal,
    ): Promise<string> {
        const result = await completeSimple(model, apiKey, prompt, {
            signal,
            temperature: 0.1,
            max_tokens: 2048,
        });
        return this.stripCodeFence(result);
    }

    private stripCodeFence(text: string): string {
        return text.replace(/^```[^\n]*\n([\s\S]*?)```\s*$/m, "$1").trim();
    }

    private checkContextLimit(fileContents: string[]): { withinLimit: boolean, totalChars: number, warnings: string[] } {
        const totalChars = fileContents.reduce((sum, content) => sum + content.length, 0);
        const withinLimit = totalChars <= this.config.maxFileChars * fileContents.length;

        const warnings: string[] = [];

        // Warn if any single file exceeds the per-file limit
        for (const [index, content] of fileContents.entries()) {
            if (content.length > this.config.maxFileChars) {
                warnings.push(`File ${index + 1} exceeds per-file limit: ${content.length} > ${this.config.maxFileChars} characters`);
            }
        }

        // Warn if total content is very large
        if (totalChars > this.config.maxFileChars * fileContents.length * 0.8) {
            warnings.push(`Total content approaches context limits: ${totalChars} characters`);
        }

        return { withinLimit, totalChars, warnings };
    }

    async processFiles(
        filePaths: string[],
        instructions: string[],
        options: SwarmProcessingOptions,
    ): Promise<SwarmFileResult[]> {
        SwarmLogger.startOperation(options.ctx, filePaths);

        const results: SwarmFileResult[] = [];
        const startTime = Date.now();
        const onUpdate = options.onUpdate || (() => {}); // Ensure onUpdate is always defined

        // Check context limits before processing
        const fileContents = await Promise.all(
            filePaths.map(filePath =>
                readFileSync(filePath, "utf8").slice(0, this.config.maxFileChars)
            )
        );

        const { withinLimit, totalChars, warnings } = this.checkContextLimit(fileContents);
        if (warnings.length > 0) {
            SwarmLogger.log(options.ctx, "Context limit warnings", {
                warnings,
                totalChars,
                maxPerFile: this.config.maxFileChars,
                fileCount: filePaths.length
            });
        }

        // Process files in parallel using semaphore for concurrency control
        const run = semaphore(this.config.concurrency);
        const filePromises = filePaths.map((filePath, i) =>
            run(async () => {
                const instruction = instructions[i] || "Analyze this file and provide key insights";
                const fileContent = fileContents[i]; // Use pre-read content
                return this.processFile(filePath, instruction, { ...options, preReadContent: fileContent });
            })
        );

        const fileResults = await Promise.all(filePromises);
        results.push(...fileResults);

            // Update progress
            if (onUpdate) {
                onUpdate({
                    content: [
                        {
                            type: "text",
                            text: `### ${filePath}\n${result.content.slice(0, 200)}`,
                        },
                    ],
                    details: {
                        completed: i + 1,
                        total: filePaths.length,
                    },
                });
            }
        }

        SwarmLogger.completeOperation(options.ctx, results);

        return results;
    }
}
