# Client contracts implementation plan

**Goal:** implement the user's approved real-client test pack, strict tool
validation and two client API adapters.

**Architecture:** one validated Chat Completions engine, two wire adapters and a
separate real-client fixture pack. No local tool executor in the production proxy.

**Tech Stack:** Node 24, TypeScript/ESM, pnpm, Zod, Ajv, Vitest, existing Nitro and
fetchApp; real SDK/CLI clients with disposable Docker-backed test projects.

**Spec:** ../specs/2026-10-26-client-contracts.md

## Constraints and review focus

- Preserve the deployed def9700 benchmark and its original checkout.
- No concurrent live M365 tests, native Studio MCP work, new model defaults or
  unsupported reasoning promises. Unit/client fixture runs consume no quota.
- Client argument schemas are untrusted: no mutation/coercion, async schemas or
  remote references. Errors expose structure, not argument values.
- Test invalid second calls, rewritten writes, duplicate tool names, local refs,
  stream errors before/after text, split UTF-8, cancellation, cross-caller history,
  x-api-key precedence and forbidden browser origins.
- Run real clients against the supported subset; missing clients are explicit skips.

## Tasks

1. Build an offline real-client task pack using actual tool schemas and deterministic
   fixture responses. Own scripts/client-tests/, a top-level runner and its docs.
   Assert file bytes, execution counts, failure handling and isolated state before
   counting a pass. Do not claim a live model result from a scripted run.
2. Add failing tool-contract tests, then implement shared schema compilation and
   output validation in proxy-lib. Add Ajv/formats as direct dependencies. Validate
   requests before admission and selected output calls before JSON/SSE emission.
3. Add failing adapter tests, then Responses/Messages request translators, JSON/SSE
   response translators and bounded cancellation/error handling. Keep transport
   conversion separate from model execution.
4. Integrate both APIs with fetchApp and Nitro, sharing auth/profile/body/caller
   handling. Test x-api-key precedence, origins, errors and standalone routes.
5. Run actual SDK and Pi fixture round trips, targeted tests, full build/unit and
   installed-runtime checks. Repair concrete failures and request independent review.
6. Record supported/unsupported behavior and measured results in the API, tool,
   experiments and research docs. Leave the new build undeployed while the existing
   benchmark measures def9700; report live acceptance separately from offline checks.
