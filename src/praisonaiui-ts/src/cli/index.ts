#!/usr/bin/env node

/**
 * PraisonAIUI CLI (Node.js wrapper)
 * Primary CLI is Python, this is for npm-only users
 */

import { spawn } from "child_process";

const args = process.argv.slice(2);

// Try to run Python CLI first
const pythonProcess = spawn("aiui", args, {
    stdio: "inherit",
    shell: true,
});

pythonProcess.on("error", () => {
    console.error(
        "Error: Python CLI not found. Please install the Python package:",
        "\n  pip install praisonaiui"
    );
    process.exit(1);
});

pythonProcess.on("close", (code) => {
    process.exit(code || 0);
});
