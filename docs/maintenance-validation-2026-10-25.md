# Release maintenance validation — October 25, 2026

Version 0.24.0 adds Windows managed updates, Linux user-unit commands, named-key
model defaults, optional fair admission and dashboard clarity improvements.

- Build completed; 609 offline unit tests passed with two workers, six live tests
  skipped. A fully parallel run exceeded an existing five-second subprocess test
  timeout; the bounded rerun passed without changing its timeout.
- The extracted portable package verified 1,097 manifest hashes and ran outside
  the checkout in a path containing spaces. Offline startup, authentication failure
  exit 78, named keys, streaming/error/cancellation activity, client setup,
  administrator sessions, profiles through the HTTP parser, notification queues,
  exports, backup/download/restore, scheduled backups and storage history passed.
- `scripts/test-update-runtime.mjs` passed apply and rollback handoffs with new
  process IDs, versioned readiness and preserved data. Its forced-startup-failure
  case recovered the preceding runtime and cleared pending/lock state. A 45-second
  staging bound in the first harness run was too short under host load; the
  harness now allows 180 seconds. Production CLI-help validation remains bounded.
- `scripts/test-release-extraction.ps1` accepted a normal ZIP and rejected
  traversal, case-duplicate names and symlinks before creating extraction targets.
- VM dashboard checks cover axes/units/ticks, interval details, profile locking,
  selected destination state, save selection, removal acknowledgement, busy
  feedback and removal success. No browser screenshot capture was available;
  README and `docs/screenshots.md` retain explicit capture placeholders.
- One user-authorized Teams webhook test was accepted and its arrival confirmed
  by the user. This is one endpoint sample, not general Teams/provider validation.

Linux service generation/install/disable/uninstall was tested with a mocked
systemd controller. Real WSL command execution repeatedly timed out; actual user
manager restart/auth-required/graceful-stop behavior remains unverified. No real
M365 chats, account reboot/sign-in or long soak were run for this release. External
whole-process monitoring remains deferred at the user's request.
