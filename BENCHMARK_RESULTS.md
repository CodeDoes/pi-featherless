# Tool Use Benchmark Results

## Summary

**Winner: zai-org/GLM-4.7-Flash** - 100% pass rate, 3.6s avg, cc:2

## All Models Tested

| Model | Pass | Rate | Avg Time | CC | Status |
|-------|------|------|----------|----|--------|
| **GLM-4.7-Flash** | 6/6 | **100%** | 3.6s | 2 | ✅ Use this |
| slf-dstl-1.5B | 5/6 | 83% | ~5s | 1 | ⚠️ Alternative cheap option |
| Tiny-Agent-1.5B | 5/6 | 83% | ~8s | 1 | ⚠️ Alternative cheap option |
| QwQ-32B | 4/6 | 67% | ~8s | 4 | ❌ Inconsistent |
| Qwen3-32B | 2/6 | 33% | ~8s | 2 | ❌ Uses `<tool_call>` XML |
| Qwen2.5-Coder-7B | 1/6 | 17% | varies | 1 | ❌ Wrong XML format |
| Llama3-Groq-8B-Tool | 1/6 | 17% | varies | 1 | ❌ Refuses tools |
| SWE-agent-7B | 1/6 | 17% | varies | 1 | ❌ Wrong JSON format |

## Why Models Fail

### Qwen2.5-Coder-7B
- Wraps output in markdown code blocks
- Uses wrong quote style: `'{"command":...}'` instead of JSON

### Llama3-Groq-8B-Tool
- Says "I don't have the capability" when asked to use tools
- Trained to refuse tool calls

### QwQ-32B
- Thinking model - sometimes ignores tools during reasoning
- Inconsistent across scenarios

### Qwen3-32B
- Uses `<tool_call>{"name": ...}</tool_call>` XML format
- Not native tool_calls API

### SWE-agent-7B
- Uses wrong JSON format: `{"function": "bash", ...}` instead of `{"name": "bash", ...}`

## What Works

### GLM-4.7-Flash (Winner)
- Native `tool_calls` API
- Correct JSON format
- No markdown wrapping
- Fast (3.6s avg)
- Cheap (cc:2)

### slf-dstl-1.5B / Tiny-Agent-1.5B
- Native `tool_calls` API
- Cheapest (cc:1)
- 83% pass rate - good for non-critical tasks

## XML Parsing Support Added

Models using `<function>` or `<tool_call>` XML tags:
- QRWKV models: `qrwkv-72b-32k`, `qrwkv-32b-32k`
- Qwen3-32B: `qwen3-32b` (uses `<tool_call>`)

## Recommendation

**Primary: zai-org/GLM-4.7-Flash**
- Best quality, reliable, fast, affordable

**Cheap fallback: driaforall/Tiny-Agent-a-1.5B or RyanYr/slf-dstl_Q2.5-1.5B-It_tooluse_SFT**
- For non-critical simple tasks
- cc:1 = cheapest

---

*Benchmarked: 2026-04-08*
