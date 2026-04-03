# pi-featherless

Pi extension providing models available through the Featherless provider.

## Stack

- TypeScript (strict mode)
- pnpm 10.26.1
- Biome for linting/formatting
- Changesets for versioning
- Vitest for testing

## Scripts

```bash
pnpm typecheck    # Type check
pnpm lint         # Lint (runs on pre-commit)
pnpm format       # Format
pnpm test         # Run tests
pnpm changeset    # Create changeset for versioning
```

## Structure

```
src/
  extensions/
    provider/
      index.ts                  # Provider extension entry point
      models.ts                 # Hardcoded model definitions
      models.test.ts            # Model config tests
    command-quotas/
      index.ts                  # Quotas command extension entry point
      command.ts                # `featherless:quotas` command for usage display
      sub-integration.ts        # Integration with pi-sub-core for usage display
      components/
        quotas-display.ts       # TUI component for quotas display (all states)
  lib/
    env.ts                      # API key helpers
    init.ts                     # Readiness guard
  types/
    quotas.ts                   # Quotas API response types
  utils/
    quotas.ts                   # Quotas fetching and formatting utilities
```

## Conventions

- API key comes from environment (``)
- Provider uses OpenAI-compatible API at `https://api.featherless.ai/v1`
- Models are hardcoded in `src/extensions/provider/models.ts`
- Quotas command only registered when `` is present

## Model Configuration

Models are defined in `src/extensions/provider/models.ts` with the following structure:

```typescript
{
  id: "vendor/model-name",
  name: "vendor/model-name",
  reasoning: true/false,
  input: ["text"] or ["text", "image"],
  cost: {
    input: 0.55,      // $ per million tokens
    output: 2.19,
    cacheRead: 0.55,
    cacheWrite: 0
  },
  contextWindow: 202752,
  maxTokens: 65536,
  compat?: {        // Optional provider-specific compatibility flags
    supportsDeveloperRole?: boolean,
    supportsReasoningEffort?: boolean,
    maxTokensField?: "max_completion_tokens" | "max_tokens",
    requiresToolResultName?: boolean,
    requiresMistralToolIds?: boolean
  }
}
```

Get pricing from `https://api.featherless.ai/v1/models`.

## Adding Models

Edit `src/extensions/provider/models.ts` and append to `FEATHERLESS_MODELS` array.

## Versioning

Uses changesets. Run `pnpm changeset` before committing user-facing changes.

- `patch`: bug fixes, model updates
- `minor`: new models, features
- `major`: breaking changes

## Key Features

1. **Provider**: OpenAI-compatible chat completions with multiple open-source models
2. **Quotas Command**: Interactive TUI for viewing API usage limits
3. **Sub Integration**: Real-time usage tracking when used with pi-sub-core
