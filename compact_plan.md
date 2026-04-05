# Featherless Provider Project Map

This document serves as the implementation map for the Featherless Provider extension.

---

## 🎯 Goal
Implement accurate token counting, concurrency management, and parallel swarms for the Featherless API.

## 🧱 Project Architecture
The project is split into five main components:

| Component | Description | Reference |
|-----------|-------------|-----------|
| **Registration** | Provider configuration, OAuth, and event routing. | `index.ts` |
| **Tokenization** | API-based token counting and smart heuristics. | [docs/tokenization.md](docs/tokenization.md) |
| **Concurrency** | Tracking and adaptive limit detection. | [docs/concurrency.md](docs/concurrency.md) |
| **Compaction** | High-fidelity context window management. | [docs/compaction.md](docs/compaction.md) |
| **Swarms** | Parallel subagent orchestration (Experimental). | `swarm.ts` |

---

## 📈 Implementation Status

### Core & Safety (Phases 1-4)
- [x] **API Tokenization**: Delta-based triggers for accurate counting.
- [x] **Concurrency Tracking**: Model-class cost registry with 429 auto-detection.
- [x] **High-Fidelity Compaction**: Specialized summarizer that preserves file structures and goals.
- [x] **Custom Footer**: Accurate real-time stats including Ctx % and Model Costs.

### Featherless Swarms (Phase 5) ✅ NEW
- [x] **Beehive TUI Widget**: Live monitoring of parallel subagents.
- [x] **swarm_scan**: Parallel file retrieval using low-cost models.
- [x] **swarm_write**: Plan-driven file modification via subagents.
- [x] **Concurrency Integration**: Swarm tasks respect the global plan limit.

### Distribution (Phase 6) ✅ NEW
- [x] **pi-package manifest**: Valid `package.json` for official distribution.
- [x] **Peer Dependencies**: Clean separation from core pi packages.

---

## 📅 Next Steps
- [ ] Implement persistent token cache for faster cross-session loading.
- [ ] Add `charsPerToken` calibration command.
- [ ] Refine `swarm_write` validation logic.
