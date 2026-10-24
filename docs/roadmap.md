# Feature roadmap

Requested October 24, 2026. This list covers product features beyond the completed
service-readiness fixes. Checked entries indicate implemented and verified scope,
not completion of the entire feature group.

## 1. Local dashboard and tray controls — in progress

- [x] Browser dashboard: readiness, authentication expiry, uptime and admitted requests.
- [x] Display available models and known quota exhaustion without sending chat probes.
- [ ] Recent sanitized error summaries, with bounded retention.
- [ ] Start/stop/restart and sign-in recovery controls with explicit local authorization.
- [ ] Optional Windows tray icon, including offline/stopped status.

## 2. Guided client setup — in progress

- [x] `client setup pi`: current model registry, proxy key and endpoint configuration.
- [x] Preserve other providers; validate before writing; private backup and dry-run.
- [ ] Integrate existing OpenClaw config generator into the standalone CLI.
- [ ] Export connection instructions for other OpenAI-compatible clients.
- [ ] Optional end-to-end verification, clearly separated from quota-free setup.

## 3. Quota and routing visibility

- [ ] Show last observed daily/weekly allowances, with observation timestamps.
- [ ] Label unavailable data as unknown and estimated turn budgets as estimates.
- [x] Show known exhaustion/reset times and configured fallback models.
- [ ] Explain the served model when a fallback was used.
- [ ] Persist observations safely across restarts, expiring stale information.

## 4. Update manager

- [ ] Discover published versions and show release notes without installing.
- [ ] Download and verify platform archives from an explicitly trusted source.
- [ ] Stage, validate, drain, switch and check readiness.
- [ ] Expose the existing rollback mechanism through the CLI.
- [ ] Preserve account state; recover the previous version after failed updates.
- [ ] Optional notifications; automatic installation remains opt-in.

## 5. Standard Linux service installer

- [ ] Generate/install a systemd user unit for the portable runtime.
- [ ] Start/stop/status/uninstall parity with Windows commands.
- [ ] Document user-session startup versus explicitly enabled lingering.
- [ ] Private environment/configuration and bounded journal/log behavior.
- [ ] Verify restart, auth-required behavior and graceful shutdown on Linux.

## Validation

- [ ] WSL Ubuntu build, offline unit tests and installed-package tests.
- [ ] WSL Linux portable-release manifest/startup verification.
- [ ] Actual-account sign-in/reboot and 24–72-hour soak (separate host checks).

Native MCP/Dataverse tool calling remains out of scope per AGENTS.md.
