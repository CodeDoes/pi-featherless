export class SwarmLogger {
    private static prefix = "[SWARM]";

    static log(ctx: any, message: string, data?: Record<string, any>): void {
        try {
            const logMessage = `${this.prefix} ${message}${data ? ` - ${JSON.stringify(data)}` : ''}`;

            if (ctx?.log) {
                ctx.log(logMessage);
            } else {
                console.log(logMessage);
            }
        } catch (error) {
            console.error(`${this.prefix} Logging failed:`, error.message);
        }
    }

    static startOperation(ctx: any, files: string[]): void {
        this.log(ctx, `Starting swarm operation`, {
            fileCount: files.length,
            timestamp: new Date().toISOString()
        });
    }

    static fileProcessing(ctx: any, filePath: string, status: 'start' | 'success' | 'error'): void {
        this.log(ctx, `File ${status}`, {
            file: filePath,
            status
        });
    }

    static llmCall(ctx: any, filePath: string, instruction: string): void {
        this.log(ctx, `LLM analysis`, {
            file: filePath,
            instruction: instruction.substring(0, 50) + (instruction.length > 50 ? "..." : "")
        });
    }

    static completeOperation(ctx: any, results: any[]): void {
        const successful = results.filter(r => !r.error).length;
        const failed = results.filter(r => r.error).length;

        this.log(ctx, `Operation completed`, {
            totalFiles: results.length,
            successful,
            failed,
            processingTime: `${Date.now() - results.startTime}ms`
        });
    }
}
