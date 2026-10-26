# Offline tool-parser boundary investigation — October 26, 2026

Historical pre-fix observations follow. The same-day [implementation/live follow-up](research-verification-2026-10-26.md)
records the local fix, eleven regressions and zero incompatible rebuilt-handler responses.

**Subsequent validation:** the [handler/client-surface follow-up](handler-contract-2026-10-26.md)
rebuilt core/proxy-lib and confirmed the object-body, inline-object-header and
truncated-array concerns in both JSON and SSE API output. Its twelve scripted
requests are separate from the eighteen parser cases below. Client application
behavior and an implementation fix remain unverified.

## Scope and result

Eighteen synthetic cases exercised the existing core dist exports
`formatToolDefinitions` and `parseToolCalls` in two read-only Node probes. No model
request, local/remote tool execution, credential access or file mutation occurred.
This follows the separate [browser settings study](browser-settings-2026-10-26.md)
and [model/tool comparison](browser-model-tools-2026-10-26.md); these cases are not
additional live turns or a new full-suite test result.

Nine cases matched their original argument/rejection expectations. Two further
negative controls confirmed the known path-header mismatch and intentional
unclosed-fence rejection. Seven other observations identify three schema/type
compatibility concerns below. This is not a claim of seven independent bugs.

The inspected dist file was newer than fenced.ts/tools.ts. Targeted source review
confirmed the relevant behavior; a clean rebuild and complete regression suite
were not run. No implementation changed. Downstream client validation/impact
remains unmeasured.

## Case matrix

The Unicode path was `C:/Probe space/naïve 測試.txt`. All file paths and operations
in this probe were strings only; no corresponding file was opened or executed.

| Case | Observed result | Interpretation |
| --- | --- | --- |
| Single path body with Unicode/spaces | exact string | expected |
| Single backslash Windows path body | exact string | expected |
| Write body containing nested Markdown/bash fences | exact content | expected |
| Write body with leading/trailing blank lines and indentation | exact content | expected |
| Empty write body | empty content string preserved | expected |
| Inline JSON edit array with multi-line strings | exact array/strings | expected |
| YAML block-list edits | exact object array | expected |
| Single object body containing nested JSON | JSON text string, not object | typed-body concern |
| Malformed JSON in single object body | incomplete text string emitted in a call | typed-body concern |
| Write fence without closing/end marker | no call | intentional rejection, not a regression |
| Truncated JSON array header, items declared object | array containing the incomplete JSON string | array fallback concern |
| Unknown fence name | no call | expected |
| Single path body incorrectly prefixed with path: | literal prefix retained in filename | known probe-design mismatch |
| Single boolean body true | string "true", not boolean | typed-body concern |
| Single integer body 3 | string "3", not number | typed-body concern |
| Single array body containing JSON | JSON text string, not array | typed-body concern |
| Multi-parameter inline JSON object header | JSON text string, not object | object-header concern |
| Same object header as an indented YAML block | correctly typed object | expected control |

## Source-confirmed mechanisms

In [fenced.ts](../packages/core/src/fenced.ts):

1. `deriveFencedSpec` makes a lone parameter the body regardless of its declared
   type. `parseFencedInner` assigns that body directly from the remaining text.
   An object, array, boolean or number body consequently remains a string. The
   formatter emits a body placeholder for these schemas, so correct JSON text in
   the advertised position can still produce arguments of the wrong type.
2. `coerceHeaderValue` handles boolean/number/array headers but has no object
   branch. Inline object JSON remains a string. The separate empty-header YAML
   block path can produce an actual object, making representation significant.
3. The array branch tries JSON and falls back to `[value]`. That can be useful for
   a scalar shorthand for a string array, but truncated JSON for an object-item
   array also becomes a string element. This parser retains parameter types, not
   complete item schemas; whether a client rejects that call needs separate testing.

Existing fenced tests explicitly reject an unclosed fence without an end marker
because it may be truncated. Preserve that guard when considering fixes; the
initial probe's expectation of recovery was too broad.

The codebase-memory graph located deriveFencedSpec/parseFencedInner/parseToolCalls;
coverage metadata recorded no issue for the targeted parser/test paths, and the
source was read directly for the statements above. This is bounded evidence, not
an exhaustive caller/validation audit.

## Minimal reproducible command

From the repository root, PowerShell (requires the existing core dist build):

```powershell
@'
import { formatToolDefinitions, parseToolCalls } from './packages/core/dist/index.mjs';
const tool = (name, properties) => ({
  type: 'function',
  function: { name, parameters: {
    type: 'object', properties, required: Object.keys(properties)
  } }
});
const cases = [
  { name: 'typed body', tool: tool('flag', { enabled: { type: 'boolean' } }),
    text: '```flag\ntrue\n```' },
  { name: 'inline object header', tool: tool('set_options', {
      target: { type: 'string' }, options: { type: 'object' }
    }), text: '```set_options\ntarget: main\noptions: {"mode":"safe"}\n```' },
  { name: 'truncated object-item array', tool: tool('edit_file', {
      path: { type: 'string' }, edits: { type: 'array', items: { type: 'object' } }
    }), text: '```edit_file\npath: C:/probe.txt\nedits: [{"old_text":"alpha","new_text":\n```' }
];
for (const c of cases) {
  const result = parseToolCalls(c.text, [c.tool]);
  console.log(JSON.stringify({ name: c.name, result }));
}
'@ | node --input-type=module
```

Expected schema-compatible values are a boolean for enabled, an object for
options, and rejection of the incomplete object-item JSON array. The observed
parser-level outputs were a string, a string, and an array containing raw text.
No tool calls returned by this command are executed.

## Follow-up criteria

Assess typed-body/object-header coercion and malformed-array handling with focused
regression cases, then verify the fix through the real client before counting a
tool-reliability gain. Preserve valid string-array shorthand, file-body whitespace,
nested fences, empty files, YAML block values and the unclosed-fence safeguard.
Do not weaken malformed-input handling just to increase tool-call counts.

See the [prioritized research checklist](research-follow-up.md). No fix, model
mapping, live-client test or new capability is claimed by this report.
