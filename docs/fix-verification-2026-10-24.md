# Fix verification — October 24, 2026

Implemented on `fix/service-readiness-packaging`, version 0.2.1. The original source snapshot and actual M365 account state were preserved. Nothing was pushed or published, and no permanent startup task was activated for the account.

## Changes

| Review finding | Implemented remedy |
| --- | --- |
| Failed startup auth still reports healthy | Explicit configuration exit 78, separate liveness/readiness, silent idle token renewal without browser retries |
| Wildcard unauthenticated listener | Loopback default, required key for other binds, common bearer/origin policy in Nitro and embedded app |
| Independent chats share state | SHA-256 message digests, exact acknowledged-prefix/reply matching, client/caller/tool-schema scope and serialized complete turns |
| Handshake close hangs forever | Pre-handshake rejection, connection/idle/turn deadlines, bounded output, cancellation and shutdown propagation |
| Publish failure deletes shared agent | Preserve discovered bots; mocked publication-failure test confirms no DELETE |
| Detached Windows launcher cannot supervise Node | Attached watchdog, bounded unexpected-failure restarts, hidden sign-in task, readiness wait and verified graceful stop |
| Windows drive paths split at colon | Native path delimiter and regression coverage |
| Invalid OpenClaw config overwritten | Fail before writing, validated merge, exact backup, atomic replacement and dry-run |
| Windows tests fail / publication lacks gates | Native-path fixtures; Windows/Linux validation, installed-runtime/npm/release checks and publication dependency on validation |
| Operational issues | Atomic private cache/state writes, browser ownership locking, bounded/redacted operational logs, bounded image/request bodies, unified capability hints and diagnostics |
| Setup/packaging burden | Setup/login/doctor/serve/service CLI; bundled runtime archives; matching Playwright CLI/browser registry; Windows installer/update/rollback and preserved legacy data root |

The protocol's measured model routes, tool framing and parser safeguards remain intact. Native MCP/Dataverse tool calling was not reopened.

## Evidence

- `pnpm test`: build passes; **434 tests passed, 6 live tests skipped** (27 files, one skipped).
- Installed-server offline probes pass for missing-credential exit 78, loopback binding, readiness, origin/key enforcement, oversized/malformed request rejection and graceful shutdown.
- The extracted npm package runs outside the workspace with an explicit offline authentication fixture. No registry install or real account credentials are required for that test.
- Release verification checks every manifest hash, copies the runtime outside the checkout into a path containing spaces, exercises setup/doctor, and runs the built-server fixture tests there.
- Windows task-definition and runner checks pass, including propagation of exit 17 from a Node child. These checks do not register a task.
- A separate integration test registered a uniquely named temporary task with a local fake server, observed a terminated Node child restart under the watchdog, verified graceful stop, and removed the task. No M365 API was used. A prior run showed that relying on Task Scheduler's retry setting alone did not restart the child within the test window; the attached watchdog now owns those immediate restarts.
- Isolated Windows installation, update and rollback preserve a sentinel in the selected account-state directory and restore the previous application selection. The stable launcher keeps an explicitly chosen data directory.
- The baseline pre-handshake reproduction was moved into the core package to resolve `ws` correctly; its mock construction is now asserted. Current fake-socket tests also verify handshake and idle deadline cleanup.

Runnable probes live under `scripts/test-*.mjs`, `scripts/test-windows-*.ps1` and `scripts/review/`. The original baseline inventory/evidence files remain available alongside the post-fix evidence.

## Remaining validation boundaries

The user authorized one Windows-native exception to AGENTS.md's Nix-shell rule. The finished Windows package authenticated with the existing account, became ready, advertised 34 models, and served one isolated pi conversation using `claude-sonnet`. The requested unique sentinel file exists with the exact expected content; pi reported reading it back. This is one successful file-write smoke sample, not a model-quality benchmark or proof of broader compatibility. Sanitized evidence: `live-smoke-evidence-2026-10-24.json`.

The smoke wrapper initially reported failure despite the real file write: Windows PowerShell exposed a null child ExitCode after waiting. The wrapper now retains the process handle before waiting. Local children returning 0 and 17 verified the correction without another M365 conversation. The packaged server was stopped gracefully afterward; no startup task was installed.

Linux/Nix execution, actual-account sign-in startup, reboot/logoff behavior and a 24–72-hour soak have not been exercised locally. CI is configured for Windows/Linux; its remote execution/publication has not been triggered here. A true pre-login Windows service and a GUI remain optional future work; the user selected startup at sign-in.
