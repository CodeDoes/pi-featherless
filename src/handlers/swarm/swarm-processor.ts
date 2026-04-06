import { readFileSync } from "fs";
import { completeSimple } from "@mariozechner/pi-ai";
import { SwarmLogger } from "./swarm-logger";
import { SwarmConfig, SwarmFileResult } from "./swarm-types";

const DEFAULT_CONFIG: SwarmConfig = {
    concurrency: 4,
    maxFileChars: 24_000,
    timeoutMs: 20_000,
};

export class SwarmProcessor {
    private config: SwarmConfig;

    constructor(config: Partial<SwarmConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    async processFile(
        filePath: string,
        instruction: string,
        options: SwarmProcessingOptions
    ): Promise<SwarmFileResult> {
        const { model, apiKey, signal, onUpdate } = options;
        const result: SwarmFileResult = { filePath, content: "" };

        try {
            SwarmLogger.fileProcessing(options.ctx, filePath, 'start');

            // Read file
            const fileContent = readFileSync(filePath, "utf8");

            // Process with LLM if available
            if (model && apiKey) {
                SwarmLogger.llmCall(options.ctx, filePath, instruction);

                const prompt = this.createPrompt(filePath, fileContent, instruction);
                result.content = await this.callLLM(model, apiKey, prompt, signal);
            } else {
                // Return raw content if no model
                result.content = fileContent;
            }

            SwarmLogger.fileProcessing(options.ctx, filePath, 'success');
            return result;

        } catch (error) {
            result.error = error instanceof Error ? error : new Error(String(error));
            SwarmLogger.fileProcessing(options.ctx, filePath, 'error');
            return result;
        }
    }

    private createPrompt(filePath: string, fileContent: string, instruction: string): string {
        const contentPreview = fileContent.slice(0, this.config.maxFileChars);
        return `File: ${filePath}\n\n\`\`\`\n${contentPreview}\n\`\`\`\n\n${instruction}`;
    }

    private async callLLM(model: any, apiKey: string, prompt: string, signal: AbortSignal): Promise<string> {
        const result = await completeSimple(
            model,
            apiKey,
            prompt,
            {
                signal,
                temperature: 0.1,
                max_tokens: 2048,
            }
        );
        return this.stripCodeFence(result);
    }

    private stripCodeFence(text: string): string {
        return text.replace(/^```[^\n]*\n([\s\S]*?)```\s*$/m, "$1").trim();
    }

    async processFiles(
        filePaths: string[],
        instructions: string[],
        options: SwarmProcessingOptions
    ): Promise<SwarmFileResult[]> {
        SwarmLogger.startOperation(options.ctx, filePaths);

        const results: SwarmFileResult[] = [];
        const startTime = Date.now();

        // Process files sequentially for now (will add parallelism next)
        for (let i = 0; i < filePaths.length; i++) {
            const filePath = filePaths[i];
            const instruction = instructions[i] || "Analyze this file and provide key insights";

            const result = await this.processFile(filePath, instruction, options);
            results.push(result);

            // Update progress
            if (onUpdate) {
                onUpdate({
                    content: [{
                        type: "text",
                        text: `### ${filePath}\n${result.content.slice(0, 200)}`,
                    }],
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

interface SwarmProcessingOptions {
    model: any;
    apiKey: string;
    signal: AbortSignal;
    ctx: any;
    onUpdate?: (update: any) => void;
}
