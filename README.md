# Pi Featherless Extension

A cool Pi extension that adds [Featherless.ai](https://featherless.ai) as a model provider, giving you access to open-source models through an OpenAI-compatible API.

This project is a fork of `pi-synthetic` by Aliou, adapted specifically for Featherless AI.

## Installation

### Get API Key

Sign up at [featherless.ai](https://featherless.ai) to get an API key.

### Login

You can use the built-in login command to securely provide your API key:

```bash
/login
```

Select **Featherless AI** from the menu and enter your key.

### Set Environment Variables (Optional)

Alternatively, you can use environment variables:

```bash
export FEATHERLESS_API_KEY="your-api-key-here"
# Optional: Set concurrency slot for priority access
export FEATHERLESS_CONCURRENCY_SLOT="your-slot-id"
```

## Concurrency Slots

This extension supports the `X-Featherless-Concurrency-Slot` header. If you have a dedicated or shared concurrency slot, set the `FEATHERLESS_CONCURRENCY_SLOT` environment variable. The extension will automatically inject this into all outgoing requests to ensure your traffic is routed to the correct compute lane.

### Install Extension

```bash
# From git
pi install git:github.com/Codedoes/pi-featherless

# Local development
pi -e ./src/extensions/provider/index.ts
```

## Usage

Once installed, select `featherless` as your provider and choose from available models:

```
/model featherless featherless:gpt-oss-20b
```

## Adding or Updating Models

Models are hardcoded in `src/providers/models.ts`. To add or update models:

1. Edit `src/providers/models.ts`
2. Add the model configuration following the `FeatherlessModelConfig` interface
3. Run `pnpm run typecheck` to verify

## Development

### Setup

```bash
git clone https://github.com/Codedoes/pi-featherless.git
cd pi-featherless

# Install dependencies (sets up pre-commit hooks)
pnpm install && pnpm prepare
```

Pre-commit hooks run on every commit:
- TypeScript type checking
- Biome linting
- Biome formatting with auto-fix

### Commands

```bash
# Type check
pnpm run typecheck

# Lint
pnpm run lint

# Format
pnpm run format

# Test
pnpm run test
```

### Test Locally

```bash
pi -e ./src/index.ts
```

## Release

This repository uses [Changesets](https://github.com/changesets/changesets) for versioning.

**Note:** Automatic NPM publishing is currently disabled. To publish manually:

1. Create a changeset: `pnpm changeset`
2. Version packages: `pnpm version`
3. Publish (when ready): Uncomment the publish job in `.github/workflows/publish.yml`

## Requirements

- Pi coding agent v0.50.0+
- FEATHERLESS_API_KEY environment variable

## Links</parameter

- [Featherless.ai](https://featherless.ai)
- [Featherless API Docs](https://featherless.ai/docs)
- [Pi Documentation](https://buildwithpi.ai/)
---

*This project was developed with the assistance of GitHub Copilot.*
