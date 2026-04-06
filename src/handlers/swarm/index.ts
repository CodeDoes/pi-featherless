import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerSwarmRead } from "./swarm-tool";

export function registerSwarm(pi: ExtensionAPI) {
    registerSwarmRead(pi);
    // registerSwarmWrite(pi);  // Would add these back
    // registerSwarmEdit(pi);   // incrementally
}

export * from "./swarm-types";
export * from "./swarm-logger";
export * from "./swarm-processor";
