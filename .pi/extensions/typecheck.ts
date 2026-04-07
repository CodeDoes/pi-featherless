/**
 * Typecheck Extension
 *
 * Provides a /typecheck command to run TypeScript type checking on the project.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { spawn } from "node:child_process";

export default function typecheckExtension(pi: ExtensionAPI) {
    pi.registerCommand("typecheck", {
        description: "Run TypeScript type checking",
        handler: async (_args, ctx) => {
            ctx.ui.setStatus("typecheck", "🔍 Type checking...");
            
            return new Promise((resolve) => {
                const tsc = spawn("pnpm", ["tsc", "--noEmit"], {
                    cwd: ctx.cwd,
                    shell: true,
                });
                
                let stdout = "";
                let stderr = "";
                
                tsc.stdout.on("data", (data) => {
                    stdout += data.toString();
                });
                
                tsc.stderr.on("data", (data) => {
                    stderr += data.toString();
                });
                
                tsc.on("close", (code) => {
                    ctx.ui.setStatus("typecheck", undefined);
                    
                    if (code === 0) {
                        ctx.ui.notify("✅ Type checking passed", "success");
                    } else {
                        const output = stdout || stderr;
                        ctx.ui.notify(`❌ Type errors found:\n${output.slice(0, 500)}`, "error");
                    }
                    
                    resolve(undefined);
                });
            });
        },
    });
}