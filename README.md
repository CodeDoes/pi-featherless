# Pi Featherless Extension

A cool Pi extension that adds [Featherless.ai](https://featherless.ai) as a model provider, giving you access to open-source models through an OpenAI-compatible API.

## Installation

### Get API Key

Sign up at [featherless.ai](https://featherless.ai) to get an API key.

### Set Environment Variable

```bash
export FEATHERLESS_API_KEY="your-api-key-here"
```

Add to shell profile for persistence:

```bash
echo 'export FEATHERLESS_API_KEY="your-api-key-here"' >> ~/.zshrc
```

### Install Extension

```bash
# From npm
pi install npm:@aliou/pi-featherless

# From git
pi install git:github.com/aliou/pi-featherless

# Local development
pi -e ./src/index.ts
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
git clone https://github.com/aliou/pi-featherless.git
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

## Links

- [Featherless.ai](https://featherless.ai)
- [Featherless API Docs](https://featherless.ai/docs)
- [Pi Documentation](https://buildwithpi.ai/)