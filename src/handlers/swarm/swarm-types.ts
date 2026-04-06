import { Type } from "@sinclair/typebox";

// Input parameters
const SimpleModeParams = Type.Object({
    question: Type.String({
        description: "Question to answer about each file",
    }),
    files: Type.Array(Type.String(), {
        description: "List of file paths to analyze",
        minItems: 1,
    }),
});

const AdvancedModeParams = Type.Object({
    instructions: Type.Array(
        Type.Array(Type.String(), {
            minItems: 1,
            maxItems: 2,
        }),
        {
            description: "Array of [filePath] or [filePath, instruction] pairs",
            minItems: 1,
        },
    ),
});

export const SwarmReadParams = Type.Union([
    SimpleModeParams,
    AdvancedModeParams,
]);

// Internal types
export interface SwarmFileResult {
    filePath: string;
    content: string;
    error?: Error;
    skipped?: boolean;
}

export interface SwarmProcessingOptions {
    model: any;
    apiKey: string;
    signal: AbortSignal;
    onUpdate?: (update: any) => void;
}

export interface SwarmConfig {
    concurrency: number;
    maxFileChars: number;
    timeoutMs: number;
}
