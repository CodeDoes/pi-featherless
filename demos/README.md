# Swarm Demos

This directory contains demonstration extensions that showcase the swarm functionality.

## Available Demos

### 1. `swarm-tui.ts` - Live Swarm TUI Demo

**Purpose**: Demonstrates the actual swarm tools with real-time streaming results.

**Features**:
- Uses real swarm operations on actual files
- Shows streaming results as files are processed
- Includes TUI visualization support
- Demonstrates parallel file analysis

**Usage**:
```typescript
// Load this extension in PI coding agent
import swarmDemo from "./demos/swarm-tui.ts";

// Then use the tools:
- "swarm_tui_demo" - Full demonstration tool
- "/tui-demo" command - Quick access to the demo
```

**Parameters**:
- `question`: Question to analyze about each file
- `files`: Array of files to analyze (defaults to sample files)
- `show_tui`: Whether to show TUI visualization (default: true)

### 2. `swarm-live-demo.ts` - Extended Live Demo

**Purpose**: More comprehensive demonstration with additional test tools.

**Features**:
- "swarm_live_demo" - Full featured demonstration
- "swarm_quick_test" - Quick test on 2 files
- "/swarm-demo" command - Command-line access
- System prompt modifications to encourage swarm usage

**Usage**:
```typescript
import swarmLiveDemo from "./demos/swarm-live-demo.ts";
```

## How It Works

1. **Real Swarm Tools**: Both demos import and use the actual swarm implementation from `../src/handlers/swarm.ts`

2. **Streaming Results**: The demos forward the real-time streaming updates from the swarm operations

3. **TUI Integration**: Shows progress bars and results in the terminal UI

4. **Error Handling**: Gracefully handles errors and provides helpful messages

## Sample Files Analyzed

By default, the demos analyze these files from the codebase:
- `src/index.ts` - Main entry point
- `src/handlers/provider.ts` - Provider registration
- `src/handlers/swarm.ts` - Swarm functionality
- `src/handlers/concurrency.ts` - Concurrency tracking
- `src/handlers/context.ts` - Context management

## Running the Demos

### Important: Avoid Tool Conflicts

The demo extensions **must be run separately** from the main extension to avoid tool name conflicts:

```bash
# First uninstall the main extension if it's loaded
pi uninstall .

# Then load just the demo
pi -e demos/swarm-tui.ts
# or
pi -e demos/swarm-live-demo.ts
```

### Using the Demos

Once loaded, you can:

1. **Use the demo tools directly**:
   ```
   "Use swarm_tui_demo tool to show how parallel file analysis works"
   "Run swarm_live_demo with default files"
   "Try swarm_quick_test on src/index.ts and src/handlers/provider.ts"
   ```

2. **Use the commands**:
   ```
   /tui-demo
   /swarm-demo
   ```

3. **Then try the real swarm tool**:
   ```
   "Use swarm tool to analyze src/index.ts and src/handlers/swarm.ts"
   "What does the swarm tool do?"
   "Analyze these files in parallel: [your files]"
   ```

### Standalone Testing:
```bash
# Check TypeScript compilation
npx tsc --noEmit demos/swarm-tui.ts
npx tsc --noEmit demos/swarm-live-demo.ts
```

## Key Features Demonstrated

- ✅ **Parallel Processing**: Multiple files analyzed simultaneously
- ✅ **Streaming Results**: Real-time updates as each file completes
- ✅ **TUI Visualization**: Progress bars and status indicators
- ✅ **Error Handling**: Graceful error recovery and messages
- ✅ **Timeout Management**: 20-second limit for swarm operations
- ✅ **Featherless Integration**: Works with the Featherless AI provider

## Technical Details

- **Concurrency**: 4 parallel workers by default
- **Timeout**: 20 seconds per swarm operation
- **Chunk Size**: 50 characters for streaming updates
- **Stream Delay**: 20ms between chunks for smooth animation

The demos showcase the full power of the swarm functionality while providing a user-friendly interface for exploration and testing.