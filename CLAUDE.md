# CLAUDE.md

Working guidance for this repo lives in **[AGENTS.md](AGENTS.md)** — read it first.

The later [October 26 implementation/live verification](docs/research-verification-2026-10-26.md)
supersedes pre-fix status in the earlier research reports. No DeepWork public ID,
model-default change or new reasoning-effort control was added.

For the October 26 browser investigation, read the linked reports and parser
correction in AGENTS.md; the [research checklist](docs/research-follow-up.md)
tracks checks that remain unverified. Remote CRUD and manual relay cooperation
must not be described as successful local proxy/client execution.
The [offline parser findings](docs/parser-boundaries-2026-10-26.md) add concrete
type-conversion concerns, not a landed fix or permission to weaken truncation guards.
The [handler follow-up](docs/handler-contract-2026-10-26.md) adds rebuilt-library
API-output and client-surface evidence; real local-client execution is still unverified.

Start with the **Operating principles (read first)** and **How we work —
hypothesis-driven** sections. In short:

1. Always run sequentially — one thread at a time; the rate limit tracks
   threads-started, not messages, and masquerades as `Disengaged`.
2. Chase all hunches — tangents to test any idea are encouraged; test, don't guess.
3. The end goal is always a usable agent in **pi or openclaw**.
4. Be scientific: hypothesize → predict → test → conclude (log it in
   `docs/hypotheses.md`).
5. Prompt tinkering: try **N wildly different** strategies at once, A/B them in one
   bench sweep, and let the data pick the direction — never iterate on the first idea.

Protocol source of truth: [`docs/m365-copilot-api.md`](docs/m365-copilot-api.md).
Open-questions notebook: [`docs/hypotheses.md`](docs/hypotheses.md).
