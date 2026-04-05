#!/bin/bash
# Swarm test script - spawns a new pi process to test swarm_scan tool

cd "$(dirname "$0")"

pi -e ./index.ts \
    --model featherless-ai/Qwen/Qwen3-32B \
    --no-session \
    "Use swarm_scan to analyze fileA.txt, fileB.txt, and fileC.txt in the swarm_test/ directory. Tell me what each file contains."