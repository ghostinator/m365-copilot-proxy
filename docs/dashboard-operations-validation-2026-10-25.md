# Dashboard operations validation — 2026-10-25

Version 0.10.0 adds host-authorized dashboard key management, filtered error groups,
page exports and Windows sign-in/startup plus drain/restart controls. Application
keys remain optional; no production keys or startup tasks are created automatically.

## Evidence

- Full Windows and WSL Ubuntu suites: 499 passed, six live tests skipped on each.
- An additional service-concurrency test was added afterward; the final 14-test
  operator/dashboard subset passed on both platforms (500 distinct passing unit
  tests in total). Startup mutations serialize and cannot race an operator restart.
- Built offline runtime: actual detached restart passed on Windows and WSL; new
  PID/instance, history preservation, optional key mode and renamed/revoked keys.
- Existing Windows runtime suite passed: success, streamed throttling, reconnect,
  cancellation, body limits, optional/required keys and guided client setup.
- Windows temporary task lifecycle passed: installed status, disabling startup while
  retaining the active process, re-enabling, child failure/watchdog restart and stop.
  The task was removed afterward. Running task state alone did not indicate whether
  its trigger was enabled; inspection now reads task Settings.Enabled.
- Browser preview: operator unlock, one-time token creation, dismiss/lock and cleared
  token input; request filters, grouped errors, and a downloaded JSON export containing
  exactly 20 saved records. No browser console errors observed. Screenshot data is
  synthetic; tokens were dismissed before capture.
- Operator endpoint rejects absent/replaced/expired grants and foreign Origins even
  if ordinary application CORS origins are configured. Application keys do not
  authorize management. Invalid bodies are bounded and close the connection.
- Export tests allowlist metadata and diagnostic fields, redact recognizable secrets
  and exclude arbitrary request headers/prompts/credentials. The UI waits for an
  active history refresh before exporting to avoid mismatched page/filter metadata.

All chat traffic in these tests used isolated offline MSAL/WebSocket fixtures with
outbound HTTP disabled. No real Microsoft model request was sent. Windows/Linux
reboot/sign-out, actual-account Linux authentication, managed-version rollback and
long-running soak remain separate validation. Restart starts the same version; it
is not an update manager. Source database schema remains 5.

The existing draft PR and its head branch remain unchanged; work continues on
`feat/unified-activity-operations`.
