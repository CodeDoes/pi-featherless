# Concurrency & Reliability

This document explains the concurrency management and reliability mechanisms in the Featherless provider.

## Concurrency Tracking
Featherless enforces a per-user concurrency limit across all models. The extension tracks this globally within the session:
1. **Per-Model Class Cost**: Each model has a "concurrency cost" defined in `models.ts` (e.g., GLM-4 Flash = 1, GLM-5 = 4).
2. **Global Registry**: A Map of active requests tracks current costs.
3. **Usage Awareness**: Status line shows `Conc: A/B` where A is current usage and B is the detected limit.

## Auto-Limit Detection
The provider automatically adapts to the user's plan:
1. **429 Interception**: If a request fails with a 429 error, the extension parses the response for "Your plan limit: X units".
2. **Dynamic Update**: The global concurrency limit is updated in real-time, adjusting the status line for future turns.

## Robustness
To prevent the concurrency counter from getting stuck (e.g., if a request fails without firing a `turn_end` event), we implement:
1. **Manual Reset**: `/featherless-reset-concurrency` command to clear the registry.
2. **Initial Reset**: Concurrency is reset on every `session_start` to ensure a clean state.
3. **Status Feedback**: Users are notified via a warning when they hit the concurrency ceiling.
