# Unified requests and application keys — October 25, 2026

Source version 0.9.0 implements one merged live/saved request list, optional named
application keys, key/model/route usage and local key-management commands. Work is
on `feat/unified-activity-operations`; the existing draft PR head/body are unchanged.

## Verification

- Windows and Ubuntu/WSL: 492 unit tests passed, six live tests skipped. Frozen
  dependency installation and full builds passed. No real Microsoft chat was sent.
- Built runtime fixtures cover success, streamed errors, throttling, reconnects,
  cancellations, optional/legacy authentication, origin policy, persistence and stop.
- Named-key fixtures create two credentials in temporary state, attribute model-list
  GETs from one IP separately, and check mode changes, renaming and revocation
  without restarting. Tokens/digests are absent from status and request history.
- Guided pi/OpenClaw setup accepts a selected environment-variable key, writes it
  privately, and omits it from output. Required mode is reported by client info.
- Portable Windows runtime verification checks 912 manifest hashes and exercises
  the copied installation in a directory containing spaces, outside the checkout.
- On an isolated copy of the production schema-3 database, upgrade to schema 5
  preserved all 379 existing request UUIDs and 34 model reports. Integrity passed;
  the production database was not modified by this experiment.
- Browser preview verified one request list, full-history type/key filtering,
  inspectors with application labels, named-key inventory and application/model
  usage. Synthetic screenshots use documentation addresses and generated temporary
  keys; raw keys and stored digests are not visible. No console errors observed.

## Fixes discovered during verification

Oversized-request rejection exposed a late-chunk race in H3's incoming Web-stream
adapter on Windows. A safe adapter now removes listeners and pauses input on
cancellation without destroying the socket used for the 413 response. Two focused
probes cover late chunks, normal JSON and aborts. Runtime fixtures exercise body
limits and continued service availability.

A separate pooled-socket reset was caused by synchronous CLI calls blocking the
fixture parent's event loop during Windows ACL setup. The harness now awaits CLI
processes asynchronously so connection-close events can be handled normally. No
chat request retry was added to hide transport failures.

## Boundaries

Production configuration, keys and running service were not changed. Live
activation remains pending after the earlier restart approval block. Keyless access
remains supported; named-key creation does not enable required mode. Legacy
configured keys retain their previous required behavior. Optional mode permits
unattributed traffic even after a key is revoked; required mode enforces revocation.
Revocation applies to new requests and does not cancel existing chats.

Only safe key metadata is visible in the dashboard. Management remains a local
CLI operation; key scopes/tenant isolation are not implemented. Operator request
cancellation and the remaining roadmap operations features are still queued.


### Deployment follow-up

Version 0.9.0 was subsequently deployed with explicit user authorization. Readiness,
optional keyless access and the existing Tailnet listener passed. A consistent
backup and schema-5 integrity verification preserved all 424 pre-deployment request
UUIDs and 34 model reports; configuration bytes were unchanged. The earlier pending
activation note above describes the pre-deployment test stage. Version 0.10.0 adds
separately authorized dashboard management; see dashboard-operations.md.
