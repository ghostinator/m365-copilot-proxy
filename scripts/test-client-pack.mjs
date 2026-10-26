import { runPiPack } from "./client-tests/pi-pack.mjs";
let result;
try { result = await runPiPack(); }
catch (error) { result = { passed: 0, failed: 1, skipped: 0,
  results: [{ case: "client-pack-startup-or-cleanup", status: "failed", reason: error.message }] }; }
console.log(JSON.stringify(result, null, 2));
if (result.failed) process.exitCode = 1;
