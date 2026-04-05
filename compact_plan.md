# Featherless Provider Compact Plan

This document serves as the project map for the Featherless Provider extension. It is a living document, updated by AI assistants as implementation progresses.

---

## 🎯 Goal
Implement accurate token counting and concurrency management for the Featherless `/v1/` API instead of pi's default `chars/4` heuristic and single-request model.

## 🧱 Project Architecture
The project is split into four main components for clarity and maintenance:

| Component | Description | Reference |
|-----------|-------------|-----------|
| **Registration** | Provider configuration, OAuth, and event routing. | `index.ts` |
| **Tokenization** | API-based token counting and smart heuristics. | [docs/tokenization.md](docs/tokenization.md) |
| **Concurrency** | Tracking and adaptive limit detection. | [docs/concurrency.md](docs/concurrency.md) |
| **Compaction** | Context window management and safety margins. | [docs/compaction.md](docs/compaction.md) |

---

## 📈 Implementation Status

### Core Features (Phase 1)
- [x] **Provider Registration**: Full OAuth support and model catalog.
- [x] **Heuristic Refinement**: Smart fallback to 3.2 chars/token for code.
- [x] **API Tokenization**: Delta-based triggers (10k chars) for accurate counting.
- [x] **LRU Cache**: Token count caching (10k entries) for performance.

### Visibility & Safety (Phase 2)
- [x] **Context Safety Margin**: 0.75 safety factor to prevent silent overflow.
- [x] **Status Line**: `Ctx: X% | Cache: Y | Conc: A/B` (Themed & Model-Aware).
- [x] **Concurrency Tracking**: Per-model class cost and 429 auto-detection.
- [x] **Commands**: `/featherless-tokens`, `/featherless-concurrency`, `/featherless-reset-concurrency`.

### Validation & Long Context (Phase 3)
- [x] **Compaction Verification**: Validated with GLM-5 (32k limit).
- [x] **Long-Context Behavior**: Confirmed stable tracking at 24k+ tokens.
- [x] **Heuristic Calibration**: Verified `chars/4` vs API across multiple code files.

---

## 🛠️ Maintenance & Development

### Adding New Models
1.  Update `models.ts` with model ID and `model_class`.
2.  Define `context_limit` and `concurrency_use` in `MODEL_CLASSES`.
3.  The safety margin (0.75) is applied automatically in `getModelConfig`.

### Troubleshooting
- **Concurrency stuck?** Run `/featherless-reset-concurrency`.
- **Token counts look off?** Run `/featherless-tokens` for a manual API check.
- **Cache issues?** Run `/featherless-clear-cache`.

---

## 📅 Next Steps
- [ ] **Phase 4: High-Fidelity & Reliability**:
    - [ ] **Custom High-Fidelity Compaction**: Implement a specialized summarizer via `session_before_compact` that preserves file structures, progress logs, and active goals.
    - [ ] **Accurate Cut-Point Detection**: Use API-based token counts to find the optimal conversation cut-point, overriding pi's heuristic.
    - [ ] **Early Compaction Trigger**: Trigger compaction at 22k/32k to ensure constant "reasoning headroom".
    - [ ] **Footer Stats Fix**: Implement a custom footer via `ctx.ui.setFooter()` to show accurate token usage and costs (since Featherless is flat-rate/sub-based).
- [ ] Implement persistent token cache (to survive `/reload`).
- [ ] Add `charsPerToken` calibration command for custom model tuning.
- [ ] Propose upstream hooks for provider-specific token estimation.
