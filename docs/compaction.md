# Compaction & Context Management

This document describes how the Featherless provider manages context window limits and compaction behavior.

## The Problem: Chars/4 Underestimates for Code
While pi's default `chars / 4` logic is a safe baseline for natural language, it significantly **underestimates** tokens for code-heavy contexts. This can lead to context overflow:
1. **Actual Tokens** > 32,000 (real limit)
2. **Estimated Tokens** (chars / 4) < 24,000
3. **Result**: The agent thinks it has room, but the model crashes or truncates.

## The Solution: Safety Margin (0.75 Factor)
In `models.ts`, we implement a `SAFETY_FACTOR` that reduces the **reported** context window to pi:
1. **Reported Context** = Real Context * 0.75 (e.g., 24k for a 32k model).
2. **Compaction Trigger**: Pi triggers compaction at ~24k estimated tokens.
3. **Reality Check**: At 24k estimated tokens, the **actual** count (measured by our API) is typically ~31k-32k.

## Custom Compaction Integration
The provider intercepts the `session_before_compact` event to:
1. **Log Accurate Count**: Fetch an accurate token count from the API right before compaction.
2. **Notify User**: Show a notification with the actual context usage percentage.
3. **Log Preparation**: Log the `tokensBefore` (estimated) vs `accurateCount` (actual) for debugging.

## Status Line Monitoring
The status line (`Ctx: X%`) is updated in real-time using:
1. **Initial Model Select**: `model_select` event.
2. **Turn End**: `turn_end` event (actual usage from API).
3. **Tool Result Delta**: `tool_result` event (heuristic delta until next API check).
