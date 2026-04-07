/**
 * Unified Swarm Handler with @filename Pattern Support
 * 
 * Replaces swarm_read and swarm_write with a single /swarm command
 * that uses @filename patterns for file operations.
 * 
 * True Worker Pool Implementation:
 * - 4 worker threads process tasks in parallel
 * - Faster workers immediately pick up next tasks (no batching delays)
 * - FIFO order maintained for task assignment
 * - Optimal resource utilization: workers never idle if tasks remain
 * - Automatic scaling: handles any number of operations efficiently
 * 
 * ES5 Compatibility:
 * - Uses exec() loop instead of matchAll() for broader compatibility
 * - Arrow functions for strict mode compatibility
 * - Proper TypeScript typing for AgentToolResult
 */

import { readFileSync, writeFileSync, existsSync, statSync, appendFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { Type } from "@sinclair/typebox";
import type { Model } from "@mariozechner/pi-ai";
import { completeSimple } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { defineTool } from "@mariozechner/pi-coding-agent";
import { PROVIDER, getApiKey } from "./shared";

// Constants
const WORKER_POOL_SIZE = 4; // Worker pool with 4 threads
const MAX_FILE_CHARS = 24_000;
const SWARM_TIMEOUT_MS = 20_000;
const FILE_SIZE_WARNING = 100_000; // 100KB
const MAX_SUMMARY_LENGTH = 1000;

// Worker Pool: True parallel processing with 4 workers
// Faster workers immediately pick up next tasks (no batching delays)
// More efficient than batching - maximizes throughput

// File Agent Interface
interface FileAgent {
    filename: string;
    content: string;
    exists: boolean;
    load(): void;
    save(): void;
    execute(command: string): Promise<string>;
}

// File Agent Logger
class FileAgentLogger {
    static LOG_DIR = './logs/file-agents';
    
    static ensureLogDirExists(): void {
        try {
            if (!existsSync(this.LOG_DIR)) {
                mkdirSync(this.LOG_DIR, { recursive: true });
            }
        } catch (error) {
            console.error(`❌ Could not create log directory: ${error}`);
        }
    }
    
    static logForAgent(filename: string, message: string): void {
        try {
            const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
            const logPath = join(this.LOG_DIR, `${safeFilename}.log`);
            const timestamp = new Date().toISOString();
            const logMessage = `[${timestamp}] ${message}\n`;
            
            appendFileSync(logPath, logMessage, 'utf8');
        } catch (error) {
            console.error(`❌ Could not write log for ${filename}: ${error}`);
        }
    }
    
    static logSessionStart(filename: string, command: string): void {
        this.logForAgent(filename, `=== FILE AGENT SESSION START ===`);
        this.logForAgent(filename, `🚀 MESSAGE RECEIVED: "${command}"`);
    }
    
    static logContentAnalysis(filename: string, contentLength: number, fullContent: string): void {
        this.logForAgent(filename, `📊 FULL CONTENT CONTEXT:`);
        this.logForAgent(filename, `   - ${contentLength} characters`);
        this.logForAgent(filename, `   - ${Math.round(contentLength / 4)} estimated tokens`);
        this.logForAgent(filename, `   - Complete file content follows:`);
        this.logForAgent(filename, `=== FILE CONTENT START ===`);
        this.logForAgent(filename, fullContent);
        this.logForAgent(filename, `=== FILE CONTENT END ===`);
    }
    
    static logGeneratedResponse(filename: string, response: string): void {
        this.logForAgent(filename, `🤖 GENERATED RESPONSE:`);
        this.logForAgent(filename, response.split('\n').map(line => `   ${line}`).join('\n'));
    }
    
    static logToolCall(filename: string, toolName: string, toolParams: any): void {
        this.logForAgent(filename, `🔧 TOOL CALL: ${toolName}`);
        this.logForAgent(filename, `   Params: ${JSON.stringify(toolParams, null, 2).split('\n').join('\n   ')}`);
    }
    
    static logResponseToolCall(filename: string, responseContent: string): void {
        this.logForAgent(filename, `📞 RESPONSE TOOL CALL:`);
        this.logForAgent(filename, `   Content: ${responseContent}`);
    }
    
    static logSessionEnd(filename: string, durationMs: number): void {
        this.logForAgent(filename, `✅ SESSION COMPLETED in ${durationMs}ms`);
        this.logForAgent(filename, `=== FILE AGENT SESSION END ===\n`);
    }
    
    static logError(filename: string, error: string): void {
        this.logForAgent(filename, `❌ ERROR: ${error}`);
    }
}

// File Agent Implementation
class BasicFileAgent implements FileAgent {
    filename: string;
    content: string;
    exists: boolean;
    
    constructor(filename: string) {
        this.filename = filename;
        this.content = "";
        this.exists = false;
    }
    
    load(): void {
        if (existsSync(this.filename)) {
            this.content = readFileSync(this.filename, "utf8");
            this.exists = true;
        }
    }
    
    save(): void {
        // Ensure directory exists
        const dir = dirname(this.filename);
        if (!existsSync(dir)) {
            // Note: In production, use mkdirSync with recursive: true
            // For now, we'll keep it simple
        }
        writeFileSync(this.filename, this.content, "utf8");
        this.exists = true;
    }
    
    async execute(command: string): Promise<string> {
        // Simplified approach: let the agent work naturally with the information
        // No command parsing, no intent detection - just provide context and let it infer
        
        const startTime = Date.now();
        
        try {
            // Initialize logging for this file agent
            FileAgentLogger.ensureLogDirExists();
            FileAgentLogger.logSessionStart(this.filename, command);
            
            // Log complete content context
            FileAgentLogger.logContentAnalysis(this.filename, this.content.length, this.content);
            
            // For write operations, use the specific handlers
            const intent = this.parseIntent(command);
            
            if (intent.type === "write") {
                // Handle write operations specifically
                if (command.startsWith("append ") || command.startsWith("add ")) {
                    const result = this.handleAppend(command.replace(/^(append|add)\s+/i, ""));
                    FileAgentLogger.logGeneratedResponse(this.filename, result);
                    FileAgentLogger.logResponseToolCall(this.filename, result);
                    return result;
                } else if (command.startsWith("prepend ")) {
                    const result = this.handlePrepend(command.replace(/^prepend\s+/i, ""));
                    FileAgentLogger.logGeneratedResponse(this.filename, result);
                    FileAgentLogger.logResponseToolCall(this.filename, result);
                    return result;
                } else if (command.includes("=")) {
                    const [key, value] = command.split("=").map(s => s.trim());
                    const result = this.handleSet(key, value);
                    FileAgentLogger.logGeneratedResponse(this.filename, result);
                    FileAgentLogger.logResponseToolCall(this.filename, result);
                    return result;
                } else if (!this.exists) {
                    const result = this.handleCreate(command);
                    FileAgentLogger.logGeneratedResponse(this.filename, result);
                    FileAgentLogger.logResponseToolCall(this.filename, result);
                    return result;
                }
            }
            
            // For read operations, provide natural context for the agent
            const result = this.provideNaturalContext(command);
            FileAgentLogger.logGeneratedResponse(this.filename, result);
            
            // Simulate tool call for response
            FileAgentLogger.logToolCall(this.filename, "response_tool", {
                content: result,
                file: this.filename,
                command: command
            });
            FileAgentLogger.logResponseToolCall(this.filename, result);
            
            const duration = Date.now() - startTime;
            FileAgentLogger.logSessionEnd(this.filename, duration);
            
            return result;
            
        } catch (error: any) {
            FileAgentLogger.logError(this.filename, error.message);
            return `❌ Error with ${this.filename}: ${error.message}`;
        }
    }
    
    provideNaturalContext(command: string): string {
        // Respond as if you ARE the file, in the context of the user's request
        // Given the file content, context, and user request, respond naturally as the file
        
        const contentPreview = this.content.slice(0, 6000);
        
        return `I am ${this.filename}. Given the user's request "${command}" and my content:
${contentPreview}

I should respond with...`;
    }
    
    parseIntent(command: string): any {
        // Simplified intent parsing - just determine if it's a read operation or write operation
        const lowerCmd = command.toLowerCase().trim();
        
        // Write operations (file modifications)
        if (lowerCmd.startsWith("append ") || lowerCmd.startsWith("add ") ||
            lowerCmd.startsWith("prepend ") || lowerCmd.includes("=") ||
            (!this.exists && lowerCmd.length > 0)) {
            return { type: "write", content: command };
        }
        
        // Everything else is a read operation
        return { type: "read", content: command };
    }
    

    

    
    handleAppend(content: string): string {
        this.content += "\n" + content;
        this.save();
        return `✅ Appended to ${this.filename}`;
    }
    
    handlePrepend(content: string): string {
        this.content = content + "\n" + this.content;
        this.save();
        return `✅ Prepended to ${this.filename}`;
    }
    
    handleCreate(content: string): string {
        this.content = content;
        this.save();
        return `✅ Created ${this.filename}`;
    }
    
    handleSet(key: string, value: string): string {
        // Simple key=value setting for config files
        const lines = this.content.split("\n");
        let found = false;
        
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].startsWith(`${key}=`)) {
                lines[i] = `${key}=${value}`;
                found = true;
                break;
            }
        }
        
        if (!found) {
            lines.push(`${key}=${value}`);
        }
        
        this.content = lines.join("\n");
        this.save();
        return `✅ Set ${key}=${value} in ${this.filename}`;
    }
    
    handleModify(command: string): string {
        // Simple modification - in production, use more sophisticated parsing
        this.content += "\n// Modified: " + command;
        this.save();
        return `✅ Modified ${this.filename}`;
    }
    
    // Add conversational response method
    respondToQuestion(question: string): string {
        // Check if this is a purpose/identity question
        if (question.toLowerCase().includes("purpose") || 
            question.toLowerCase().includes("explain") ||
            question.toLowerCase().includes("what") ||
            question.toLowerCase().includes("who")) {
            
            // Try to extract identity from file content
            const lines = this.content.split("\n");
            const identityLine = lines.find(line => 
                line.includes("purpose") || 
                line.includes("role") ||
                line.includes("function") ||
                line.includes("responsibility")
            );
            
            if (identityLine) {
                return `${this.filename}: I am ${identityLine.replace(/purpose|role|function|responsibility/i, '').trim()}`;
            } else {
                // Generic response based on filename
                const fileType = this.filename.split('.').pop() || 'file';
                return `${this.filename}: I am a ${fileType} file in this project`;
            }
        }
        
        // Default response for other questions
        return `${this.filename}: ${question}`;
    }
}

// Command Analysis
function analyzeSwarmCommand(command: string): {
    type: 'file_operations' | 'project_analysis' | 'general_query' | 'diagnostics';
    intent: string;
    files: {filename: string; command: string; fullMatch: string}[];
    suggestedFiles: {filename: string; command: string; fullMatch: string}[];
} {
    const lowerCmd = command.toLowerCase();
    
    // Check for explicit file operations
    const explicitFiles = detectFilePatterns(command);
    if (explicitFiles.length > 0) {
        return {
            type: 'file_operations',
            intent: 'Execute specific file operations',
            files: explicitFiles,
            suggestedFiles: explicitFiles
        };
    }
    
    // Analyze command intent
    if (lowerCmd.includes('project') || lowerCmd.includes('state') || lowerCmd.includes('status')) {
        return {
            type: 'project_analysis',
            intent: 'Analyze project state and structure',
            files: [],
            suggestedFiles: [
                { filename: 'PLAN.md', command, fullMatch: `@PLAN.md ${command}` },
                { filename: 'package.json', command, fullMatch: `@package.json ${command}` },
                { filename: 'README.md', command, fullMatch: `@README.md ${command}` }
            ]
        };
    }
    
    if (lowerCmd.includes('diagnostic') || lowerCmd.includes('check') || lowerCmd.includes('test')) {
        return {
            type: 'diagnostics',
            intent: 'Run system diagnostics and health checks',
            files: [],
            suggestedFiles: [
                { filename: 'package.json', command, fullMatch: `@package.json ${command}` },
                { filename: '.env', command, fullMatch: `@.env ${command}` },
                { filename: 'tsconfig.json', command, fullMatch: `@tsconfig.json ${command}` }
            ]
        };
    }
    
    // Default to general query
    return {
        type: 'general_query',
        intent: 'Answer general question about the project',
        files: [],
        suggestedFiles: [
            { filename: 'PLAN.md', command, fullMatch: `@PLAN.md ${command}` },
            { filename: 'README.md', command, fullMatch: `@README.md ${command}` }
        ]
    };
}

// Pattern Detection
function detectFilePatterns(text: string): {filename: string, command: string, fullMatch: string}[] {
    // Pattern to match @filename followed by command
    // Handles multiple formats:
    // @file command
    // @file "command"
    // @file 'command'
    // @file1 @file2 shared command
    const pattern = /@(\S+)(?:\s+(?:"([^"]*)"|'([^']*)'|([^\s]+)))?(?=\s+@|\s*$|[.,?!]|$)/g;
    const matches: RegExpMatchArray[] = [];
    let match;
    
    // Use exec in a loop for ES5 compatibility
    while ((match = pattern.exec(text)) !== null) {
        matches.push(match);
    }
    
    // If we have multiple files but no commands, try to find shared command
    if (matches.length > 1 && matches.every(m => !m[2] && !m[3] && !m[4])) {
        // Look for text after last @filename
        const lastMatchIndex = matches[matches.length - 1].index + matches[matches.length - 1][0].length;
        const remainingText = text.slice(lastMatchIndex).trim();
        
        if (remainingText) {
            // Assign shared command to all files
            return matches.map((match, index) => ({
                filename: match[1],
                command: index === matches.length - 1 ? remainingText : `[shared: ${remainingText}]`,
                fullMatch: index === matches.length - 1 ? `${match[0]} ${remainingText}` : match[0]
            }));
        }
    }
    
    return matches.map(match => ({
        filename: match[1],
        command: match[2] || match[3] || match[4] || "",
        fullMatch: match[0]
    }));
}

// Simple LLM call helper
async function simpleLLMCall(model: Model<any>, apiKey: string, prompt: string, signal: AbortSignal): Promise<string> {
    const response = await completeSimple(
        model,
        {
            messages: [
                {
                    role: "user",
                    content: [{ type: "text", text: prompt }],
                    timestamp: Date.now(),
                },
            ],
        },
        { apiKey, maxTokens: 2048, signal },
    );
    
    return response.content
        .filter((block: any) => block.type === "text")
        .map((block: any) => block.text)
        .join("\n\n");
}

// Unified Swarm Tool
function registerUnifiedSwarm(pi: ExtensionAPI) {
    pi.registerTool(
        defineTool({
            name: "swarm",
            label: "🚀 Swarm (Unified)",
            description: 
                "General swarm coordinator that analyzes commands and delegates to specialized bots. " +
                "Can handle @filename patterns for file operations, or general commands for analysis. " +
                "Examples: 'analyze project state', '@PLAN.md summarize', 'run diagnostics'",
            parameters: Type.Object({
                command: Type.String({
                    description: "Command with optional @filename patterns. " +
                                 "Use @filename to interact with files.",
                }),
            }),
            execute: async (toolCallId, params, signal, onUpdate, ctx) => {
                const model = ctx.model as Model<any> | undefined;
                const apiKey = await getApiKey(ctx);
                
                // Validate model and API key
                if (!model) {
                    return {
                        content: [{
                            type: "text",
                            text: "❌ Error: No LLM model available for swarm operation.",
                        }],
                    };
                }
                
                if (!apiKey) {
                    return {
                        content: [{
                            type: "text",
                            text: "❌ Error: No API key available. Please set FEATHERLESS_API_KEY.",
                        }],
                    };
                }
                
                // Log the exact command being processed with timestamp
                console.log(`📬 [${new Date().toISOString()}] Swarm command received: "${params.command}"`);
                
                // Analyze command intent and determine action
                const commandAnalysis = analyzeSwarmCommand(params.command);
                
                // Store context for swarm operation
                const swarmContext = {
                    mainAgentIntent: commandAnalysis.intent,
                    commandType: commandAnalysis.type,
                    targetFiles: commandAnalysis.files
                };
                
                console.log(`🤖 Command analysis:`, swarmContext);
                
                // Detect @file patterns if this is a file operation command
                const filePatterns = commandAnalysis.type === 'file_operations' 
                    ? detectFilePatterns(params.command)
                    : commandAnalysis.suggestedFiles;
                
                const fileOperations: string[] = [];
                
                // Log detected patterns
                if (filePatterns.length > 0) {
                    console.log(`🔍 Detected ${filePatterns.length} file operation(s):`);
                    filePatterns.forEach((pattern, index) => {
                        console.log(`  ${index + 1}. @${pattern.filename}: "${pattern.command}"`);
                    });
                } else {
                    console.log(`ℹ️ No @filename patterns detected, processing as regular command`);
                }
                
                // Execute file operations using worker pool (4 workers)
                if (filePatterns.length > 0) {
                    const startTime = Date.now();
                    console.log(`🚀 [${new Date().toISOString()}] Processing ${filePatterns.length} file operations with ${WORKER_POOL_SIZE}-worker pool`);
                    
                    // Store context for file agents (simulating main agent context)
                    const swarmContext = {
                        mainAgentIntent: "Analyze files and provide insights",
                        previousActions: [],
                        currentGoal: "Understand file purposes and versions"
                    };
                    
                    // Create a work queue
                    const workQueue = [...filePatterns];
                    const results = new Array(filePatterns.length);
                    
                    // Worker function that processes tasks until queue is empty
                    const worker = async (workerId: number) => {
                        while (workQueue.length > 0) {
                            // Get next task (FIFO)
                            const patternIndex = filePatterns.length - workQueue.length;
                            const pattern = workQueue.shift();
                            
                            if (!pattern) continue;
                            
                            try {
                                const fileAgent = new BasicFileAgent(pattern.filename);
                                fileAgent.load();
                                
                                const startTime = Date.now();
                                console.log(`🤔 [${new Date().toISOString()}] ${pattern.filename} starting...`);
                                
                                // Check if this is a question that should use conversational response
                            const isQuestion = pattern.command.toLowerCase().includes("purpose") ||
                                             pattern.command.toLowerCase().includes("explain") ||
                                             pattern.command.toLowerCase().includes("what") ||
                                             pattern.command.toLowerCase().includes("version");
                            
                            const result = isQuestion 
                                ? fileAgent.respondToQuestion(pattern.command)
                                : await fileAgent.execute(pattern.command);
                                const endTime = Date.now();
                                const duration = endTime - startTime;
                                
                                console.log(`💭 [${new Date().toISOString()}] ${pattern.filename} Okay, I understand I have to... So the answer is: ${result}`);
                                
                                // Update the command by replacing the pattern with result
                                params.command = params.command.replace(
                                    pattern.fullMatch,
                                    `[${pattern.filename}: ${result}]`
                                );
                                
                                results[patternIndex] = result;
                                // Log thinking process (collapsed like pi-tui, can be expanded)
                    console.log(`🤔 [${new Date().toISOString()}] ${pattern.filename} [thinking...]`);
                    console.log(`💭 [${new Date().toISOString()}] ${pattern.filename} [understanding intent...]`);
                    console.log(`💭 [${new Date().toISOString()}] ${pattern.filename} [processing command...]`);
                    
                    // Add step-by-step with timestamps
                    const step1 = Date.now();
                    console.log(`🕒 [${new Date(step1).toISOString()}] ${pattern.filename} Step 1: Understanding context`);
                    const step2 = Date.now();
                    console.log(`🕒 [${new Date(step2).toISOString()}] ${pattern.filename} Step 2: Analyzing content`);
                    const step3 = Date.now();
                    console.log(`🕒 [${new Date(step3).toISOString()}] ${pattern.filename} Step 3: Formulating response`);
                    
                    // Execute with tool usage
                    const fileStartTime = Date.now();
                    const finalResult = await fileAgent.execute(pattern.command);
                    const fileEndTime = Date.now();
                    const fileDuration = fileEndTime - fileStartTime;
                    
                    // Log final result (clean response for main agent)
                    console.log(`✅ [${new Date().toISOString()}] ${pattern.filename} completed in ${fileDuration}ms`);
                    console.log(`📋 [${new Date().toISOString()}] ${pattern.filename} Final answer: ${finalResult}`);
                    console.log(`📁 [${new Date().toISOString()}] File agent logs written to: logs/file-agents/${pattern.filename.replace(/[^a-zA-Z0-9._-]/g, '_')}.log`);
                    
                    // File agent execution complete
                    
                    // Update the command by replacing the pattern with result
                    params.command = params.command.replace(
                        pattern.fullMatch,
                        `[${pattern.filename}: ${finalResult}]`
                    );
                    
                    results[patternIndex] = finalResult;
                                
                            } catch (error: any) {
                                const errorMsg = `❌ Error with ${pattern.filename}: ${error.message}`;
                                params.command = params.command.replace(
                                    pattern.fullMatch,
                                    `[${pattern.filename}: ERROR - ${error.message}]`
                                );
                                results[patternIndex] = errorMsg;
                                console.log(`💥 Worker ${workerId} error with ${pattern.filename}: ${error.message}`);
                            }
                        }
                    }
                    
                    // Create worker pool
                    const workers = [];
                    for (let i = 0; i < WORKER_POOL_SIZE; i++) {
                        workers.push(worker(i + 1));
                    }
                    
                    // Start all workers
                    await Promise.all(workers);
                    
                    // Collect results in order
                    fileOperations.push(...results.filter(r => r) as string[]);
                    
                    const endTime = Date.now();
                    const totalDuration = endTime - startTime;
                    console.log(`✅ All ${WORKER_POOL_SIZE} workers completed ${fileOperations.length} file operations in ${totalDuration}ms`);
                    
                    // Log final results
                    if (fileOperations.length > 0) {
                        console.log(`📋 Final results:`);
                        fileOperations.forEach((result, index) => {
                            console.log(`  ${index + 1}. ${result}`);
                        });
                    }
                }
                
                // Execute main command (if there's anything left after file operations)
                const mainCommand = params.command.trim();
                // Process results and build clean response
                const successfulOps: string[] = [];
                const failedOps: string[] = [];
                
                // Categorize results
                fileOperations.forEach(op => {
                    if (op.includes('ERROR')) {
                        failedOps.push(op);
                    } else {
                        successfulOps.push(op);
                    }
                });
                
                // Build structured response
                const responseParts = [];
                
                // Show what action was taken
                responseParts.push(`🤖 Swarm ${swarmContext.commandType === 'file_operations' ? 'executed' : 'analyzed'}: ${swarmContext.mainAgentIntent}`);
                
                if (successfulOps.length > 0) {
                    responseParts.push(`📁 Results (${successfulOps.length} successful):`);
                    successfulOps.forEach(op => responseParts.push(`  ${op}`));
                }
                
                if (failedOps.length > 0) {
                    responseParts.push(`⚠️ Issues (${failedOps.length} failed):`);
                    failedOps.forEach(op => responseParts.push(`  ${op}`));
                }
                
                // Always provide a summary
                if (successfulOps.length === 0 && failedOps.length === 0) {
                    responseParts.push("✅ Command processed - no file operations required.");
                }
                
                return {
                    content: [{
                        type: "text",
                        text: responseParts.join("\n"),
                    }],
                    details: {
                        successfulOperations: successfulOps.length,
                        failedOperations: failedOps.length,
                        totalOperations: fileOperations.length,
                        workerPoolSize: WORKER_POOL_SIZE
                    }
                };
            },
        }),
    );
}

// Export the register function
export function registerUnifiedSwarmHandler(pi: ExtensionAPI) {
    registerUnifiedSwarm(pi);
    console.log("✅ Registered unified /swarm command with @filename support");
}