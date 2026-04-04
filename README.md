# Pi Featherless Extension

A [Pi](https://buildwithpi.ai/) extension that adds [Featherless.ai](https://featherless.ai) as a model provider, giving you access to open-source models through an OpenAI-compatible API.

## Features

- **Native tool calling** for models that support it (Qwen3, Kimi-K2) via OpenAI-compatible `tool_calls` format
- **Text tag fallback** for models that emit `<tool_call>` or `<function-call>` tags in content (QRWKV, RWKV6, older models)
- **Real-time streaming** with dual-path detection: prefers native `delta.tool_calls`, falls back to text tag parsing automatically
- **Qwen3 thinking mode** with `enable_thinking` support
- **OAuth login** flow for API key management
- **/featherless-status** command showing error rates and concurrency usage
- **Curated model list** with context window and concurrency cost metadata

## Supported Models

| Family | Models | Tool Calling | Reasoning |
|--------|--------|-------------|-----------|
| Qwen3 | 8B, 14B, 32B | Native | Yes |
| Qwen 2.5 | 72B Instruct | Native | No |
| DeepSeek R1 | 0528-Qwen3-8B | Text tags | Yes |
| QRWKV | 72B | Text tags | No |
| RWKV6 | Qwen2.5-32B QwQ | Text tags | No |
| Llama 3 | 8B Instruct (abliterated) | Text tags | No |

## Installation

### Get API Key

Sign up at [featherless.ai](https://featherless.ai/account/api-keys) to get an API key.

### Install Extension

```bash
# From git
pi install git:github.com/CodeDoes/pi-featherless

# Local development
pi -e ./src/extensions/provider/index.ts
```

### Login

Use the built-in login command to provide your API key:

```bash
/login
```

Select **Featherless AI** from the menu and enter your key.

## Usage

Once installed, select `featherless` as your provider and choose from available models:

```
/model featherless Qwen/Qwen3-32B
```

### Concurrency Slots

Featherless has per-plan concurrency limits with weighted costs per model size:

| Model Size | Concurrency Cost |
|-----------|-----------------|
| 7B-15B | 1 |
| 24B-34B | 2 |
| 70B-72B | 4 |

Set a dedicated concurrency slot via environment variable:

```bash
export FEATHERLESS_CONCURRENCY_SLOT=your-slot-id
```

## Tool Use Benchmark

A standalone benchmark (`bench.ts`) tests tool calling across model families:

```bash
# Run all models (reads .env for FEATHERLESS_API_KEY)
npx tsx bench.ts

# Filter by model family
npx tsx bench.ts qwen3

# Control batch size (model switch limit) and delay
npx tsx bench.ts --batch 4 --delay 30
```

5 test scenarios: Hello World, Right Tool, JSON Inception, Self Control, Pipeline.

## Development

### Setup

```bash
git clone https://github.com/CodeDoes/pi-featherless.git
cd pi-featherless
pnpm install && pnpm prepare
```

### Commands

```bash
pnpm run typecheck   # TypeScript type checking
pnpm run lint        # Biome linting
pnpm run format      # Biome formatting with auto-fix
pnpm run test        # Vitest unit tests
```

### Project Structure

```
src/extensions/provider/
  index.ts          # Main provider: streaming, message conversion, tool parsing
  index.test.ts     # Tests for parseToolCallTags + provider registration
  models.ts         # Curated model list + concurrency metadata
  models.test.ts    # Model config validation tests
bench.ts            # Standalone tool use benchmark
```

### Pre-commit Hooks

Runs on every commit: typecheck, lint, format, test.

## Requirements

- Pi coding agent v0.65.0+

## Links

- [Featherless.ai](https://featherless.ai)
- [Featherless API Docs](https://featherless.ai/docs)
- [Pi Documentation](https://buildwithpi.ai/)
