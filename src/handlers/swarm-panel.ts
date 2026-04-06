import type { Component, TUI } from "@mariozechner/pi-tui";

// ─── colours ──────────────────────────────────────────────────────────────────

const R          = "\x1b[0m";
const WHITE_FG   = "\x1b[97m";
export const BOT_BG     = ["\x1b[48;5;23m", "\x1b[48;5;130m", "\x1b[48;5;53m", "\x1b[48;5;22m"];
export const EMPTY_BG   = "\x1b[48;5;236m";
const OVERALL_FILL_BG   = "\x1b[48;5;18m";
const OVERALL_EMPTY_BG  = "\x1b[48;5;234m";

export function bgBar(
    plainText: string,
    width: number,
    pct: number,
    fillBg: string,
    emptyBg: string,
): string {
    const padded  = plainText.padEnd(width).slice(0, width);
    const filledW = Math.round((pct / 100) * width);
    return `${fillBg}${WHITE_FG}${padded.slice(0, filledW)}${R}${emptyBg}${WHITE_FG}${padded.slice(filledW)}${R}`;
}

// ─── SwarmPanel ───────────────────────────────────────────────────────────────

export interface BotState {
    label: string;
    progress: number;
    snippet: string;
    status: "idle" | "working" | "done" | "error";
}

export class SwarmPanel implements Component {
    bots: BotState[];
    doneCount = 0;
    private _requestRender: (() => void) | null = null;

    constructor(labels: string[]) {
        this.bots = labels.map(label => ({
            label, progress: 0, snippet: "", status: "idle" as const,
        }));
    }

    attach(tui: TUI) {
        this._requestRender = tui.requestRender.bind(tui);
    }

    requestRender() {
        this._requestRender?.();
    }

    render(w: number): string[] {
        const lines: string[] = [];

        const overallPct = this.bots.length === 0 ? 0
            : Math.round((this.doneCount / this.bots.length) * 100);
        const overallLabel = `  ◈ swarm  ${this.doneCount}/${this.bots.length}  ${overallPct}%`;
        lines.push(bgBar(overallLabel, w, overallPct, OVERALL_FILL_BG, OVERALL_EMPTY_BG));
        lines.push("");

        const visible = this.bots.slice(0, 8);
        for (let i = 0; i < visible.length; i++) {
            const b = visible[i];
            const colorIdx = i % BOT_BG.length;
            const pctStr  = b.status !== "idle" ? `  ${String(b.progress).padStart(3)}%` : "";
            const tag     = b.status === "error" ? " ✗" : b.status === "done" ? " ✓" : "";
            const label   = `  ${b.label}${tag}`;
            const snip    = b.snippet ? `  ${b.snippet}` : (b.status === "idle" ? "  waiting" : "");
            const rightW  = pctStr.length;
            const leftMax = w - rightW;
            let left = label + snip;
            if (left.length > leftMax) left = left.slice(0, leftMax);
            const plain = left.padEnd(leftMax) + pctStr;
            lines.push(bgBar(plain, w, b.progress, BOT_BG[colorIdx], EMPTY_BG));
        }

        if (this.bots.length > 8) {
            const rest = `  … and ${this.bots.length - 8} more`;
            lines.push(EMPTY_BG + WHITE_FG + rest.padEnd(w).slice(0, w) + R);
        }

        return lines;
    }

    invalidate() {}
}

// ─── semaphore ────────────────────────────────────────────────────────────────

export function semaphore(limit: number) {
    let running = 0;
    const queue: (() => void)[] = [];
    return async function run<T>(fn: () => Promise<T>): Promise<T> {
        if (running >= limit) await new Promise<void>(res => queue.push(res));
        running++;
        try { return await fn(); }
        finally {
            running--;
            queue.shift()?.();
        }
    };
}
