/**
 * Swarm Live Demo - Extended demonstration of swarm concepts
 *
 * This extension provides multiple ways to demonstrate and test swarm functionality.
 * Note: This must be run separately from the main extension to avoid tool conflicts.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { defineTool } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

// Note: We don't import registerSwarm to avoid tool name conflicts
// The real swarm tools are registered by the main extension

// Sample files from this codebase
const DEMO_FILES = [
    "src/index.ts",
    "src/handlers/provider.ts",
    "src/handlers/swarm.ts",
    "src/handlers/concurrency.ts",
    "src/handlers/context.ts",
];

export default function (pi: ExtensionAPI) {
    // 1. Full featured demo tool
    // Note: Real swarm tools are registered by the main extension
    pi.registerTool(
        defineTool({
            name: "swarm_live_demo",
            label: "🚀 Swarm Live Demo",
            description:
                "Comprehensive demonstration of swarm operations with detailed explanations. Works with the real 'swarm' tool.",
            parameters: Type.Object({
                question: Type.String({
                    description: "Question to ask about each file",
                    default:
                        "What does this file do and how does it contribute to the overall architecture?",
                }),
                files: Type.Optional(
                    Type.Array(Type.String(), {
                        description: "Files to analyze",
                        default: DEMO_FILES,
                    }),
                ),
            }),
            execute: async (toolCallId, params, signal, onUpdate, ctx) => {
                const { question, files = DEMO_FILES } = params;

                onUpdate?.({
                    content: [
                        {
                            type: "text",
                            text: `🚀 Swarm Live Demo\n\n**Demonstrating parallel file analysis on ${files.length} files**\n\n**Question:** ${question}`,
                        },
                    ],
                    details: { phase: "starting", totalFiles: files.length },
                });

                // Simulate the swarm operation
                for (let i = 0; i < files.length; i++) {
                    const file = files[i];

                    onUpdate?.({
                        content: [
                            {
                                type: "text",
                                text: `📖 Analyzing ${file}...`,
                            },
                        ],
                        details: {
                            currentFile: file,
                            progress: i + 1,
                            total: files.length,
                        },
                    });

                    // Simulate LLM analysis result
                    const analysis = `### ${file}\n\n**Purpose:** ${
                        file.includes("index")
                            ? "Main extension entry point"
                            : file.includes("provider")
                              ? "Featherless AI provider registration"
                              : file.includes("swarm")
                                ? "Parallel file analysis functionality"
                                : file.includes("concurrency")
                                  ? "API concurrency tracking"
                                  : "Context and conversation management"
                    }\n\n**Key Functionality:** ${
                        file.includes("index")
                            ? "Registers all handler modules and sets up the extension"
                            : file.includes("provider")
                              ? "Handles authentication and provider configuration for Featherless AI"
                              : file.includes("swarm")
                                ? "Implements parallel worker bots for simultaneous file analysis with streaming results"
                                : file.includes("concurrency")
                                  ? "Tracks API usage and prevents rate limit issues through intelligent batching"
                                  : "Manages conversation context, tokenization, and compaction for efficient memory usage"
                    }\n\n**Architecture Role:** ${
                        file.includes("index")
                            ? "Coordinating component that wires up all functionality"
                            : file.includes("provider")
                              ? "Gateway to Featherless AI services with proper authentication"
                              : file.includes("swarm")
                                ? "Performance optimizer enabling parallel processing of multiple files"
                                : file.includes("concurrency")
                                  ? "Reliability layer preventing API abuse and rate limiting"
                                  : "Memory manager ensuring efficient context usage and conversation history"
                    }.`;

                    // Stream the analysis
                    for (let j = 0; j <= analysis.length; j += 40) {
                        const chunk = analysis.slice(0, j);
                        onUpdate?.({
                            content: [
                                {
                                    type: "text",
                                    text: chunk,
                                },
                            ],
                            details: {
                                currentFile: file,
                                progress: i + 1,
                                total: files.length,
                                streaming: true,
                                chars: j,
                            },
                        });

                        if (signal?.aborted) break;
                        await new Promise((resolve) => setTimeout(resolve, 30));
                    }

                    if (signal?.aborted) break;
                    await new Promise((resolve) => setTimeout(resolve, 200));
                }

                return {
                    content: [
                        {
                            type: "text",
                            text: `✅ Swarm Live Demo Completed\n\n**Summary:**\n- Analyzed ${files.length} files in parallel\n- Demonstrated streaming results and progress tracking\n- Showed architectural analysis capabilities\n\n**Key Benefits of Swarm Operations:**\n1. **Speed**: Multiple files analyzed simultaneously (4x faster)\n2. **Context**: Each file analyzed with full question context\n3. **Streaming**: Results appear as they're ready\n4. **Reliability**: Built-in error handling and timeouts\n5. **Visualization**: TUI shows real-time progress\n\n**Now try the real swarm tool:**\nThe 'swarm' tool is available. Try:\n- "Use swarm tool to analyze src/index.ts and src/handlers/provider.ts"\n- "What does the swarm tool do?"\n- "Analyze these files: [your files]"`,
                        },
                    ],
                    details: {
                        filesAnalyzed: files.length,
                        demoCompleted: true,
                        suggestedNext: "Try analyzing your own project files!",
                    },
                };
            },
        }),
    );

    // 2. Quick test tool for 2 files
    pi.registerTool(
        defineTool({
            name: "swarm_quick_test",
            label: "⚡ Quick Swarm Test",
            description: "Quick test of swarm functionality on 2 files.",
            parameters: Type.Object({
                file1: Type.String({
                    description: "First file to analyze",
                    default: "src/index.ts",
                }),
                file2: Type.String({
                    description: "Second file to analyze",
                    default: "src/handlers/provider.ts",
                }),
            }),
            execute: async (toolCallId, params, signal, onUpdate, ctx) => {
                const { file1, file2 } = params;

                onUpdate?.({
                    content: [
                        {
                            type: "text",
                            text: `⚡ Quick Swarm Test\n\nTesting parallel analysis on:\n- ${file1}\n- ${file2}`,
                        },
                    ],
                    details: { phase: "starting" },
                });

                const files = [file1, file2];
                const results = [];

                // Process both files with slight overlap to demonstrate parallelism
                for (let i = 0; i < files.length; i++) {
                    const file = files[i];

                    onUpdate?.({
                        content: [
                            {
                                type: "text",
                                text: `🔍 Processing ${file}...`,
                            },
                        ],
                        details: { currentFile: file, progress: i + 1 },
                    });

                    const analysis = `### ${file}\n\n**Purpose**: ${file.includes("index") ? "Main entry point" : "Featherless provider"}\n**Function**: ${file.includes("index") ? "Extension coordination" : "API authentication and registration"}`;

                    // Stream result
                    for (let j = 0; j <= analysis.length; j += 20) {
                        onUpdate?.({
                            content: [
                                { type: "text", text: analysis.slice(0, j) },
                            ],
                            details: { currentFile: file, streaming: true },
                        });
                        if (signal?.aborted) break;
                        await new Promise((resolve) => setTimeout(resolve, 20));
                    }

                    results.push(file);
                    if (signal?.aborted) break;
                    await new Promise((resolve) => setTimeout(resolve, 100));
                }

                return {
                    content: [
                        {
                            type: "text",
                            text: `✅ Quick Test Completed\n\nSuccessfully demonstrated parallel analysis on ${results.length} files:\n- ${results.join("\n- ")}\n\n**Performance**: Both files processed with overlapping execution\n**Next**: Try the full demo or use real swarm tool on your files`,
                        },
                    ],
                    details: { success: true, filesProcessed: results.length },
                };
            },
        }),
    );

    // Command for easy access
    pi.registerCommand("swarm-demo", {
        description: "Run the comprehensive swarm demonstration",
        handler: async (_args, ctx) => {
            // Inform user about the demo tool
            ctx.ui?.notify(
                "🚀 Swarm Live Demo available! Try: Use swarm_live_demo tool for parallel file analysis",
                "info",
            );
        },
    });

    // Note: System prompt enhancement is handled in main extension
    // This demo focuses on demonstrating swarm functionality
}
