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

    // -- Qwen3-only: Unclosed <tool_call> treated as text --

    it("treats unclosed <tool_call> as regular text (Qwen3-only)", () => {
        const text = `<tool_call>\n{"name": "Bash", "arguments": {"command": "ls"}}`;
        const result = parseToolCallTags(text);
        // Qwen3 format requires proper closing tags
        expect(result.toolCalls).toHaveLength(0);
        expect(result.textBefore).toContain("<tool_call>");
    });
});

describe("Featherless provider registration", () => {
    it("registers with correct provider name and config shape", async () => {
        const registerProvider = vi.fn();
        const registerCommand = vi.fn();
        const mockPi = {
            models: {
                getProviderModels: vi.fn(() => []),
                registerProvider,
            },
            auth: {
                registerOAuth: vi.fn(),
            },
            registerCommand,
            on: vi.fn(),
            registerFlag: vi.fn(),
            getFlag: vi.fn(() => "test-api-key"),
        } as any;

        const { default: init } = await import("./index.js");
        await init(mockPi);

        expect(registerProvider).toHaveBeenCalledOnce();
        const [config] = registerProvider.mock.calls[0];
        expect(config.id).toBe("featherless");
        expect(config.name).toBe("Featherless AI");
        expect(config.models).toHaveLength(FEATHERLESS_MODELS.length);
        expect(typeof config.models[0].streamSimple).toBe("function");
    });
});
