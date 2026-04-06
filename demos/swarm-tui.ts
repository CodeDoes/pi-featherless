/**
 * Swarm TUI Demo - Live demonstration of swarm concepts
 *
 * This demo shows how swarm operations work with streaming results.
 * Note: This must be run separately from the main extension to avoid tool conflicts.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { defineTool } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

// Note: We don't registerSwarm here to avoid tool name conflicts
// The real swarm tools are registered by the main extension

// Sample files from this codebase for demonstration
const SAMPLE_FILES = [
    "src/index.ts",
    "src/handlers/provider.ts",
    "src/handlers/swarm.ts",
    "src/handlers/concurrency.ts",
    "src/handlers/context.ts",
];

export default function (pi: ExtensionAPI) {
    // Register the demo tool that explains how swarm works
    // Note: Real swarm tools are registered by the main extension
    pi.registerTool(
        defineTool({
            name: "swarm_tui_demo",
            label: "🎯 Swarm TUI Demo",
            description:
                "Demonstrates how swarm operations work with streaming results. This demo works with the real 'swarm' tool registered by the main extension.",
            parameters: Type.Object({
                question: Type.String({
                    description: "Question to analyze about each file",
                    default:
                        "Explain this file's purpose and key functionality",
                }),
                files: Type.Optional(
                    Type.Array(Type.String(), {
                        description:
                            "Files to analyze (defaults to sample files)",
                        default: SAMPLE_FILES,
                    }),
                ),
            }),
            execute: async (toolCallId, params, signal, onUpdate, ctx) => {
                const { question, files = SAMPLE_FILES } = params;

                // Initial update
                onUpdate?.({
                    content: [
                        {
                            type: "text",
                            text: `🎯 Swarm TUI Demo Starting\n\n**Concept:** This demonstrates how swarm operations work.\n\n**Files to analyze:**\n${files.map((f) => `- ${f}`).join("\n")}\n\n**Question:** ${question}`,
                        },
                    ],
                    details: {
                        phase: "initializing",
                        total_files: files.length,
                    },
                });

                // Simulate swarm operation with streaming results
                for (let i = 0; i < files.length; i++) {
                    const file = files[i];

                    // Show processing started
                    onUpdate?.({
                        content: [
                            {
                                type: "text",
                                text: `📄 Processing ${file}...`,
                            },
                        ],
                        details: {
                            current_file: file,
                            progress: i + 1,
                            total: files.length,
                            phase: "processing",
                        },
                    });

                    // Simulate the streaming result that would come from real swarm tool
                    const simulatedAnalysis = `### ${file}\n\nThis file is part of the Featherless PI extension. It handles ${
                        file.includes("provider")
                            ? "provider registration with Featherless AI"
                            : file.includes("swarm")
                              ? "parallel file analysis using worker bots"
                              : file.includes("concurrency")
                                ? "API concurrency tracking and rate limiting"
                                : file.includes("context")
                                  ? "conversation context management and tokenization"
                                  : "main extension coordination and module loading"
                    }, contributing to the overall architecture by ${
                        file.includes("provider")
                            ? "registering the provider and handling authentication"
                            : file.includes("swarm")
                              ? "enabling simultaneous analysis of multiple files"
                              : file.includes("concurrency")
                                ? "preventing rate limit issues and optimizing API usage"
                                : file.includes("context")
                                  ? "managing conversation history and compacting when needed"
                                  : "orchestrating all components and providing the main entry point"
                    }.`;

                    // Stream the result in chunks to demonstrate streaming behavior
                    for (let j = 0; j <= simulatedAnalysis.length; j += 30) {
                        const chunk = simulatedAnalysis.slice(0, j);

                        onUpdate?.({
                            content: [
                                {
                                    type: "text",
                                    text: chunk,
                                },
                            ],
                            details: {
                                current_file: file,
                                progress: i + 1,
                                total: files.length,
                                phase: "streaming",
                                characters_streamed: j,
                                total_characters: simulatedAnalysis.length,
                            },
                        });

                        // Small delay to create streaming effect
                        if (signal?.aborted) break;
                        await new Promise((resolve) => setTimeout(resolve, 25));
                    }

                    // Small pause between files
                    if (signal?.aborted) break;
                    await new Promise((resolve) => setTimeout(resolve, 150));
                }

                // Final summary
                return {
                    content: [
                        {
                            type: "text",
                            text: `✅ Swarm TUI Demo Completed\n\n**What just happened:**\n- Demonstrated how swarm operations work with streaming results\n- Showed the pattern of parallel file analysis\n\n**Now try the real thing:**\nThe 'swarm' tool is already available (registered by main extension). Try:\n- "Use swarm tool to analyze src/index.ts and src/handlers/provider.ts"\n- "What does the swarm tool do?"\n- "Analyze these files in parallel: [your files]"\n\n**Key features you'll see:**\n✅ Parallel processing (4 files at once)\n✅ Streaming results as each file completes\n✅ TUI progress visualization\n✅ 20-second timeout protection`,
                        },
                    ],
                    details: {
                        phase: "completed",
                        files_demonstrated: files.length,
                        success: true,
                        next_steps: [
                            "Try: Use swarm tool to analyze src/index.ts and src/handlers/provider.ts",
                            "Ask: What does the swarm tool do?",
                            "Experiment with different questions and file combinations",
                        ],
                    },
                };
            },
        }),
    );

    // Register a command for easy access
    pi.registerCommand("tui-demo", {
        description: "Run the Swarm TUI demonstration",
        handler: async (_args, ctx) => {
            // Inform user about the demo tool
            ctx.ui?.notify(
                "🎯 Swarm TUI Demo available! Try: Use swarm_tui_demo tool to see it in action",
                "info",
            );
        },
    });

    // Note: System prompt modification is handled in main extension
    // This demo focuses on demonstrating swarm functionality
}
