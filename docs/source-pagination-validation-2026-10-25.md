# Request sources and pagination validation — October 25, 2026

Version 0.5.0; source commit 4751407.

Windows and WSL Ubuntu each passed 460 unit tests (six live tests skipped).
Built Nitro runtime checks passed on both operating systems, including real local
socket attribution, rejection of forged forwarding headers, and saved history
written at graceful shutdown. Existing offline success/streaming/throttling,
reconnect/cancellation and client-configuration checks also passed. All upstream
WebSocket traffic in these tests is simulated; outbound HTTP is disabled.

RequestSources tests cover reload after persistence, IPv4/IPv6 normalization,
self-check exclusion from application rankings, bounded retention, idle expiry,
corrupt data and storage failure. The UI test checks default 20-row pagination,
page boundaries, page-size changes and filter resets.

No incoming proxy API key is configured. The deployment keeps the existing
100.102.206.65:4141 endpoint. Source collection starts when the new build is
activated; earlier versions did not retain source addresses and cannot reconstruct
them. No existing request is assigned an inferred client address.
Activated the verified Windows portable runtime on the existing keyless Tailnet
endpoint. All 910 package hashes and isolated release runtime tests passed.
Live browser verification: 20 displayed rows by default, Next shows records 21–27,
50-row mode shows all 27, and the scroll container stays 480 pixels high while
its content exceeds that height. Restored the default to 20.

Live source telemetry observed successful application chats from 100.119.206.22.
This host's 25 sequential no-chat health probes were explicitly labeled self-checks
and did not increase its application ranking. The saved file contains both source
rows and completed request records. No source identity was inferred from headers.
