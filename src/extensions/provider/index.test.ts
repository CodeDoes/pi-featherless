import { describe, expect, it, vi } from "vitest";
import { parseToolCallTags } from "./index.js";
import { FEATHERLESS_MODELS } from "./models";

describe("parseToolCallTags", () => {
    // -- <tool_call> format (Qwen3, most models) --

    it("parses a single <tool_call>", () => {
        const text = `<tool_call>\n{"name": "bash", "arguments": {"command": "ls"}}\n</tool_call>`;
        const result = parseToolCallTags(text);
        expect(result.toolCalls).toHaveLength(1);
        expect(result.toolCalls[0].name).toBe("bash");
        expect(result.toolCalls[0].arguments).toEqual({ command: "ls" });
        expect(result.textBefore).toBe("");
    });

    it("preserves text before <tool_call>", () => {
        const text = `I'll list the files now.\n<tool_call>\n{"name": "bash", "arguments": {"command": "ls"}}\n</tool_call>`;
        const result = parseToolCallTags(text);
        expect(result.toolCalls).toHaveLength(1);
        expect(result.textBefore).toBe("I'll list the files now.");
    });

    it("handles multiple <tool_call> tags", () => {
        const text = `<tool_call>\n{"name": "bash", "arguments": {"command": "ls"}}\n</tool_call>\n<tool_call>\n{"name": "bash", "arguments": {"command": "pwd"}}\n</tool_call>`;
        const result = parseToolCallTags(text);
        expect(result.toolCalls).toHaveLength(2);
        expect(result.toolCalls[0].arguments).toEqual({ command: "ls" });
        expect(result.toolCalls[1].arguments).toEqual({ command: "pwd" });
    });

    it("returns empty for text without tool calls", () => {
        const text = "Hello, how can I help?";
        const result = parseToolCallTags(text);
        expect(result.toolCalls).toHaveLength(0);
        expect(result.textBefore).toBe(text);
    });

    it("handles malformed JSON in <tool_call> gracefully", () => {
        const text = `<tool_call>\n{bad json}\n</tool_call>`;
        const result = parseToolCallTags(text);
        expect(result.toolCalls).toHaveLength(0);
        expect(result.textBefore).toContain("bad json");
    });

    // -- Unclosed <tool_call> (QRWKV format) --

    it("parses <tool_call> without closing tag (QRWKV)", () => {
        const text = `<tool_call>\n{"name": "Bash", "arguments": {"command": "ls"}}`;
        const result = parseToolCallTags(text);
        expect(result.toolCalls).toHaveLength(1);
        expect(result.toolCalls[0].name).toBe("Bash");
        expect(result.toolCalls[0].arguments).toEqual({ command: "ls" });
    });

    // -- <function-call> format (RWKV6Qwen2.5) --

    it("parses <function-call> XML format", () => {
        const text = `<function-call>\n<name>bash</name>\n<arguments>\n{"command": "ls"}\n</arguments>\n</function-call>`;
        const result = parseToolCallTags(text);
        expect(result.toolCalls).toHaveLength(1);
        expect(result.toolCalls[0].name).toBe("bash");
        expect(result.toolCalls[0].arguments).toEqual({ command: "ls" });
    });

    it("parses <function-call> with </functioncall> typo closing", () => {
        const text = `<function-call>\n<name>bash</name>\n<arguments>\n{"command": "ls"}\n</arguments>\n</functioncall>`;
        const result = parseToolCallTags(text);
        expect(result.toolCalls).toHaveLength(1);
        expect(result.toolCalls[0].name).toBe("bash");
    });

    it("parses <function-call> with JSON body", () => {
        const text = `<function-call>\n{"name": "bash", "arguments": {"command": "ls"}}\n</function-call>`;
        const result = parseToolCallTags(text);
        expect(result.toolCalls).toHaveLength(1);
        expect(result.toolCalls[0].name).toBe("bash");
    });
});

describe("Featherless provider registration", () => {
    it("registers with correct provider name and config shape", async () => {
        const registerProvider = vi.fn();
        const registerCommand = vi.fn();
        const mockPi = {
            registerProvider,
            registerCommand,
            on: vi.fn(),
            registerFlag: vi.fn(),
            getFlag: vi.fn(),
        } as any;

        const { default: init } = await import("./index.js");
        init(mockPi);

        expect(registerProvider).toHaveBeenCalledOnce();
        const [name, config] = registerProvider.mock.calls[0];
        expect(name).toBe("featherless");
        expect(config.baseUrl).toBe("https://api.featherless.ai/v1");
        expect(config.apiKey).toBe("FEATHERLESS_API_KEY");
        expect(config.api).toBe("featherless-openai");
        expect(config.models).toHaveLength(FEATHERLESS_MODELS.length);
        expect(typeof config.streamSimple).toBe("function");
        expect(config.oauth).toBeDefined();
    });
});
