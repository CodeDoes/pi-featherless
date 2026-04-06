// Minimal test to isolate the syntax error
try {
    throw new Error(
        `Swarm operation stalled after ${20000 / 1000} seconds without progress. This might indicate performance issues or files that are too large.`,
    );
} catch (error) {
    console.log("Error caught:", error.message);
}
