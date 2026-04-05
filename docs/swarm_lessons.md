# Swarm Intelligence & Orchestration Lessons

This document captures the logic, architectural decisions, and "hard-won" lessons from implementing Featherless Swarms.

## 🧠 The Architect-Scout Pattern
Large, smart models (GLM-5) have high concurrency costs and broad contexts. To keep them efficient:
1.  **Main Agent (Architect)**: Focuses on goal-setting, logic synthesis, and final decisions.
2.  **Subagents (Scouts)**: Small, fast models (GLM-4-9B) with cost 1. Used to analyze raw data (scanning files) and return concise intelligence.
3.  **Data Flow**: Scouts must report only high-signal information back. The Architect receives labeled `### SUBAGENT REPORT [X]` blocks to maintain clear provenance.

## 🐝 Swarm Observability
Observing a swarm is critical to prevent the "Black Box" feeling during parallel execution.
*   **Live Timers**: Every subagent should have a real-time elapsed counter. This allows the user to identify "Stuck" agents vs. "Hard" queries.
*   **Event Bubbling**: Subagent event streams (thinking, using tools) should be parsed and displayed in the main TUI (e.g., the Beehive Widget).
*   **Tmux Viewports**: For deep auditing, subagents should run in named tmux windows (`scan-0`, `scan-1`) so the user can literally "step inside" a subagent's mind.

## ⚙️ Concurrency Management
In a fixed-concurrency environment (4 units):
*   **Model Cost Weights**: Models must have weight-awareness. GLM-5 (4) vs GLM-4-9B (1).
*   **The Wait State**: When the Architect (4) calls the Swarm, the Architect process essentially yields its "slot" to the Scouts.
*   **Serialization**: If a swarm query exceeds the limit (e.g., scanning 8 files with 4 units), the runner must handle the back-pressure or batching to avoid API 429s.

## 🛠️ Implementation Gotchas
1.  **Scope/Signal Propagation**: Always pass the `AbortSignal` through all levels of the runner. Without it, the "ESC" key won't stop the sub-processes.
2.  **JSON Stream Integrity**: `pi` in `-p` mode emits ANSI codes. For data extraction, always use `--mode json` and a strict regex-based parser to isolate events from noise.
3.  **UI Blocking**: Run the TUI update loop on a separate interval (`100ms`) from the process spawning to ensure the timers feel "smooth."

## 🚀 Future Ideas
*   **Swarm Self-Correction**: If a Scout fails a scan, the Architect should be able to re-task it with a different model or prompt.
*   **Recursive Swarms**: Scouts spawning their own scouts for sub-file analysis (e.g., scanning a massive minified JS file).
