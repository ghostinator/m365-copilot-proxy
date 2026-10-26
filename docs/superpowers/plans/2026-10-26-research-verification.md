# Research verification implementation plan

Goal: complete the research-follow-up checks with measured outcomes before any GitHub push.

Scope: preserve the current research edits in place. Do not push, publish, restart
the installed proxy, weaken protection policies, or change model defaults based
on a single browser result. All upstream turns remain sequential and paced.

- [x] Add failing parser regressions for typed bodies, object headers and malformed
  arrays in packages/core/src/fenced.test.ts; verify the failures before changing code.
- [x] Fix the shared coercion/parser path in packages/core/src/fenced.ts, preserving
  string bodies, valid YAML, scalar-array shorthand and truncation safeguards.
- [x] Rebuild core/proxy-lib, rerun the handler probe, targeted tests, then unit checks.
- [x] Validate real local-client CRUD using actual schemas/parser and a disposable
  fixture; verify the resulting files independently and clean up owned fixtures.
- [x] Verify native execution/cancellation/reconnect distinctions with fixtures and
  a bounded live check. Keep remote tools distinct from local client execution.
- [x] Test fresh nonce/context isolation in paced normal/temporary conditions.
- [x] Probe DeepWork on the real proxy route without adding a default/model mapping;
  record accepted routing, model evidence and any explicit budget observations.
- [x] Update research-follow-up.md and reports with pass/fail/inconclusive evidence,
  including limitations. No item is checked off from a model's own claim alone.

Validation: parser regressions, offline-handler-contract-probe.mjs, relevant unit
tests, real harness evidence, direct fixture inspection, Markdown links and diff checks.
Publication was held for research review. The user subsequently authorized
committing, pushing and updating the existing draft PR #90 with the findings.

Outcome: all bounded checks have recorded evidence in
[research-verification-2026-10-26.md](../../research-verification-2026-10-26.md).
Two source fixes have red/green regressions and live repeats. Full build and 625
unit tests passed (bounded workers/timeouts; six live tests skipped). Independent
read-only review found no blocking findings. Publication follows the user's
subsequent authorization; no installed runtime replacement is part of this plan.
