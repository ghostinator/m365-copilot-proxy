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
Automatic approval review blocked restarting the localhost runtime; the live
/dashboard still serves 0.3.1 pending that restart. The verified 0.4.0 archive is
in release/m365-proxy-0.4.0-win32-x64-1792923546268.zip.