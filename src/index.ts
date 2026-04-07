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
import { registerUnifiedSwarmHandler } from "./handlers/swarm-unified";

export default function (pi: ExtensionAPI) {
    registerProvider(pi);
    registerConcurrencyTracking(pi);
    registerContextTracking(pi);
    registerCompaction(pi);
    registerUnifiedSwarmHandler(pi);


}
