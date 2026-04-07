---
name: audit-quick
description: Quick project health checks including linting, testing status, type checking, and code quality analysis. Use when starting a session or after making changes.
---

# Quick Audit

Run comprehensive but fast health checks on the project.

## Usage

Use `/audit-quick` to run all checks. Use subcommands for specific actions:

```bash
/audit-quick                    # Run all checks
/audit-quick lint               # Lint code
/audit-quick test               # Run tests
/audit-quick types              # Type check
/audit-quick format             # Check formatting
/audit-quick all                # All checks combined
```

## Scripts

Quick checks via the directory scripts:
- `.pi/skills/audit-quick/scripts/lint.sh` - Run linting
- `.pi/skills/audit-quick/scripts/test.sh` - Run test suite
- `.pi/skills/audit-quick/scripts/types.sh` - Type check with TypeScript/JS
- `.pi/skills/audit-quick/scripts/format.sh` - Check code formatting
- `.pi/skills/audit-quick/scripts/run-all.sh` - Run all checks sequentially

## Output

Checks produce summarized output highlighting:
- Any errors or failures
- Lint warnings/critical issues
- Test coverage/status
- Type errors (if any)
- Formatting violations

## What It Checks

- ESLint/JSHint for style and semantic errors
- Unit/integration test suite status
- TypeScript/JS compilation types
- Prettier/ESLint formatter compliance
- Project health metrics (dependencies health, etc.)