# Activity validation — October 25, 2026

Version 0.4.0, source commit 016d42a, Windows x64 archive built locally.

- Windows and WSL Ubuntu: 453 unit tests passed; six live tests skipped.
- Both operating systems passed built-server success (keyed/unkeyed), throttling,
  reconnect and cancellation fixtures, including exact Unicode body-byte counts.
- Local check endpoint/instance identity and separate self-check counts passed on
  both operating systems. Outbound HTTP is disabled in these test processes.
- Distributed Windows archive passed all 910 manifest hashes and isolated startup,
  policy, chat and client-configuration checks from a temporary path with spaces.
- The new UI was inspected using an isolated offline fixture on port 44141.
  These fixture chats are not Microsoft requests or evidence about model quality.

Actual routing remains unresolved: 127.0.0.1:4141 and the Tailnet address:4141
belong to different Node processes. The user's application/base URL is needed
before changing that routing. No application settings or remote listener changed.
Initial automatic review blocked the restart. After the user explicitly approved,
the idle localhost instance was stopped gracefully and replaced with verified
0.4.0 (PID 14528). Authentication and local health/model checks passed. The
Tailnet process (PID 344) remains running. The verified 0.4.0 archive is
in release/m365-proxy-0.4.0-win32-x64-1792923546268.zip.

Available local startup logs confirm earlier use of the Tailnet bind address, but
contain no per-request access records or client identities. No claim about which
application made the reported successful chat can be recovered from those logs.
Live socket inspection succeeded; one subsequent OS inventory timed out and was
reported as unavailable. Liveness/readiness/model-list checks passed without chat.
