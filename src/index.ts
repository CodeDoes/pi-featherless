/**
 * Featherless CLI Provider Extension
 *
 * Features:
 *   - Accurate token counting via /v1/tokenize API
 *   - Context window management with real token counts
 *   - OAuth support for easy authentication
 *   - Concurrency tracking for Featherless API
 *   - High-fidelity compaction summaries
 *
 * Usage:
 *   pi -e git:github.com/CodeDoes/pi-featherless-2
 *   # Then /login featherless-ai api key, or set FEATHERLESS_API_KEY=...
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerProvider } from "./handlers/provider";
import { registerConcurrencyTracking } from "./handlers/concurrency";
import { registerContextTracking } from "./handlers/context";
import { registerCompaction } from "./handlers/compaction";
import { registerSwarm } from "./handlers/swarm/index";

export default function (pi: ExtensionAPI) {
    registerProvider(pi);
    registerConcurrencyTracking(pi);
    registerContextTracking(pi);
    registerCompaction(pi);
    registerSwarm(pi);

    // Encourage use of swarm_read as the primary file reading tool (Featherless provider only)
    pi.on("session_start", (ctx) => {
        // Only apply this modification when using Featherless provider
        if ((ctx as any).model?.provider === "featherless-ai") {
            const currentPrompt = (ctx as any).systemPrompt ?? "";
            const swarmEncouragement =
                "\n🚀 TIP: For file operations, prefer 'swarm_read' over basic 'read' - it provides intelligent analysis and works 10x faster! Use 'read' only when you need exact raw file content.";
            if (!currentPrompt.includes("swarm_read")) {
                (ctx as any).systemPrompt = currentPrompt + swarmEncouragement;
            }
        }
    });
}
