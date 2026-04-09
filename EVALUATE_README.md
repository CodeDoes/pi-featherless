# Model Evaluator

Evaluates tool calling capability of Featherless AI models.

## Quick Start

```bash
# Evaluate a single model (by ID or URL)
npx tsx evaluate-models.ts "zai-org/GLM-4.7-Flash"

# Evaluate multiple models
npx tsx evaluate-models.ts "zai-org/GLM-4.7-Flash" "Qwen/QwQ-32B"

# Use a config file (JSON)
npx tsx evaluate-models.ts --config models.json

# Run specific scenarios only (requires --config)
npx tsx evaluate-models.ts --config models.json --scenarios hello,read,j

ge scenarios:
  - hello: must call bash with "echo hello"
  - read: must call read_file with path="/etc/hostname"
  - json: must call write_file creating config.json
  - selfcontrol: must NOT call calculator on "2+2"
  - pipeline: must call bash with "wc -l"
  - calc: must call calculator

## Output

Results are saved to `results/` (or custom `outputDir`):
- `bench-<timestamp>.json` - full data
- `bench-<timestamp>.md` - human-readable report

## Config File Format

```json
{
  "models": [
    { "id": "org/model-name", "label": "Display Name", "params": { "temperature": 0.7, "top_p": 0.95 } }
  ],
  "scenarios": ["hello", "read", "json", "selfcontrol", "pipeline", "calc"],
  "outputDir": "results",
  "verbose": false
}
```

- `id`: Model ID (without org/) or full URL
- `label`: Friendly name (optional)
- `params`: Override default generation parameters
- `scenarios`: Omit to run all 6; subset filters which to test
- `outputDir`: Where to save results (default: "results")

## Requirements

- Node.js 18+
- `FEATHERLESS_API_KEY` in .env or environment
- Dependencies: `openai`, `dotenv` (installed)
