# Offline real-client fixture pack

Build the libraries first, then run `node scripts/test-client-pack.mjs` (or
`pnpm test:clients`). These are **scripted model conformance tests**, not a live
model benchmark. No Microsoft/vendor service, login or deployed proxy is used.

The Pi pack imports the installed Pi agent loop, native read/write/edit/bash tool
factories and Pi's actual OpenAI provider. Its provider serializes real requests
and parses streaming responses from the production Chat Completions handler.
Only the upstream M365 session is scripted. A guarded in-process fetch transport
permits only the fixture endpoint; it performs no real HTTP requests. This checks
Pi provider/handler/tool integration, rather than Pi CLI startup or installation.

Each task creates an unmounted disposable Docker container with `--network=none`,
a read-only root, an unprivileged user, capability removal, bounded memory/CPU/PIDs
and writable temporary project space. All native Pi file operations are injected
Docker operations. Generated shell commands run only inside that container and
have a 15-second limit. File paths outside the task are rejected. Final file-byte
checks use independent Python reads, and assertions check action counts, shell
counts, errors, provider turns and admission release. Containers and isolated
temporary configuration are removed after every run, including failures.

Fixtures cover:

- Multi-file repair, native structured edits, a real Python test and exact files.
- YAML structured edits plus Unicode, tabs, leading/trailing whitespace and an
  exact write body.
- Failed edits followed by a successful repair, with exactly one tool error.
- Invalid generated arguments rejected before any native tool executes.
- Aborted upstream work followed by a safe retry, without an aborted tool call.

The runner clears inherited provider keys/tokens and points account/config paths
at absent files in a new temporary directory before loading the proxy/client.
It restores its environment afterward. Pi is loaded from the managed installation
at `~/.pi/agent/install/releases/<current-version>/node_modules`; an alternate
module directory can be supplied with `CLIENT_TEST_PI_MODULES`. This uses Pi SDK
APIs and will fail explicitly if an incompatible installed version changes them.

Docker Desktop's usual Windows installation is found automatically; use
`CLIENT_TEST_DOCKER` for another Docker binary. The cached image defaults to
`python:3-slim` (`CLIENT_TEST_IMAGE` overrides it). Images are never pulled or
installed by this runner. Missing/broken Docker is a failed fixture, not a pass.
Missing Pi is reported as skipped. OpenClaw is an explicit skip; this pack does
not claim OpenClaw, full Codex or Claude Code CLI compatibility. The summary
separates passed, failed and skipped cases and exits nonzero on any failure.

On 2026-10-26, the Windows run with managed Pi 1.0.2 and the rebuilt validation
boundary passed all five Pi fixtures twice; OpenClaw was skipped and external
fetch attempts were zero. The final run additionally asserted the complete file
list, path-escape rejection and actual tool-result history. These results apply
to the local build used for the run, not the deployed def9700 benchmark service.

The SDK protocol round trips accompanying this work separately exercise the
OpenAI/Anthropic wire adapters. Neither those tests nor scripted Pi fixtures
measure live tool compliance, account entitlement, quota or model performance.
