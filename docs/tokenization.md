# Tokenization & Heuristics

This document describes how the Featherless provider handles token counting and character-to-token heuristics.

## The Problem: chars/4 Overestimates for Code
While pi's default `chars / 4` logic is a safe baseline for natural language, it significantly overestimates tokens for dense code, JSON, and structured tool outputs. This causes **premature compaction**, reducing the effective context window.

## The Solution: Content-Type Aware Heuristics
In `tokenize.ts`, we implement a smarter heuristic that detects the type of content being counted.

| Content Type | Ratio (Chars/Token) | Detection Method |
|--------------|---------------------|------------------|
| **Natural Language** | 4.0 | Default |
| **Code / JSON** | 3.2 | Default fallback (measured average) |
| **Bash Output** | 1.8 | Regex for file permissions (`drwxr-xr-x`) |

## API-Based Refinement
To ensure absolute accuracy, we don't just rely on heuristics. The extension periodically calls the Featherless `/v1/tokenize` API:
1. **Delta-based triggers**: API is called after 10,000 new characters are added to context.
2. **LRU Caching**: Token counts for individual messages are cached (up to 10k entries) to avoid redundant API calls.
3. **Usage pre-population**: Token counts from actual API responses (via `turn_end`) are used to update the cache.

## Fallback Behavior
If the Featherless API is unavailable or returns an error, the system gracefully falls back to the content-aware heuristic, ensuring compaction logic never stalls.
