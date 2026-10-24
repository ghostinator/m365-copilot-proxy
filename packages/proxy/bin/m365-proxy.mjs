#!/usr/bin/env node
// Thin launcher for the built Nitro server.
// Usage: m365-proxy [port]   (default 4141, or $PORT)
import { main } from "./cli.mjs";
try { await main(process.argv.slice(2)); }
catch (error) { console.error(`m365-proxy: ${error.message}`); process.exitCode = 1; }
