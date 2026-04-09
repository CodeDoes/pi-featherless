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
import { registerProvider } from "../src/handlers/provider";
import { registerConcurrencyTracking } from "../src/handlers/concurrency";
import { registerContextTracking } from "../src/handlers/context";
import { registerCompaction } from "../src/handlers/compaction";

export default function (pi: ExtensionAPI) {
    registerProvider(pi);
    registerConcurrencyTracking(pi);
    registerContextTracking(pi);
    registerCompaction(pi);
}
