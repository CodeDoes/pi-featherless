import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getConcurrencyUse, getModelClass } from "../models";
import { PROVIDER } from "./shared";

interface ConcurrencyState {
    activeRequests: Map<string, number>;
    totalCost: number;
    limit: number;
}

const state: ConcurrencyState = {
    activeRequests: new Map(),
    totalCost: 0,
    limit: 4,
};
let requestIdCounter = 0;

function parse429Limit(errorText: string): number | null {
    const match = errorText.match(/plan limit:\s*(\d+)/i);
    return match ? parseInt(match[1], 10) : null;
}

export function handleApiError(error: any): void {
    const message = error?.message || String(error);
    if (message.includes("429") || message.includes("Concurrency limit")) {
        const limit = parse429Limit(message);
        if (limit !== null) state.limit = limit;
    }
}

function release(modelId: string): boolean {
    const modelClass = getModelClass(modelId);
    if (modelClass && state.totalCost > 0) {
        const cost = getConcurrencyUse(modelClass);
        for (const [id, c] of state.activeRequests) {
            if (c === cost) {
                state.activeRequests.delete(id);
                state.totalCost -= c;
                return true;
            }
        }
    }
    return false;
}

export function registerConcurrencyTracking(pi: ExtensionAPI) {
    pi.on("session_start", async () => {
        state.activeRequests.clear();
        state.totalCost = 0;
    });

    pi.on("before_provider_request", async (event, ctx) => {
        const model = ctx.model;
        if (model?.provider !== PROVIDER) return;

        const modelClass = getModelClass(model.id);
        if (!modelClass) return;

        const cost = getConcurrencyUse(modelClass);
        const requestId = `req_${++requestIdCounter}`;
        state.activeRequests.set(requestId, cost);
        state.totalCost += cost;
    });

    pi.on("turn_end", async (_event, ctx) => {
        const model = ctx.model;
        if (model?.provider !== PROVIDER) return;
        release(model.id);
    });
}
