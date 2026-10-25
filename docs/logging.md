# Logging and diagnostics

The proxy has three separate diagnostic layers. None requires installing a
database server. All paths below are relative to `~/.config/opencode-m365` unless
`M365_DATA_DIR` selects another data root.

| Layer | Location | Contents and retention |
| --- | --- | --- |
| Request/error history | `activity.sqlite` and its `-wal`/`-shm` files | Persistent allowlisted request metadata, source/model rollups, detailed failures and explicit capability reports. Unlimited retention. |
| Operational summaries | Errors tab, internal operational errors | Up to 20 fixed-category summaries from this process. Separate from saved request failures; reset at restart. |
| Process/debug/frame logs | `debug.log`, `debug.log.1`, `service-logs/`, `frames/` | Local troubleshooting and optional protocol research. Debug/frame data can contain conversation content. |

## Saved request errors

Logging is automatic for completed tracked requests; no debug flag is needed.
HTTP 4xx/5xx responses, disconnects and application errors inside HTTP-200 streams
appear in **Errors** with shared time/model/System filters and 20/50/100-row pages.
Fields and interpretation are described in [the dashboard guide](dashboard.md#errors-and-troubleshooting).

Each detailed failure has a bounded message (12,000 characters), optional stack
(16,000), type/code, failure phase, queue/first-byte timings and upstream attempt
counts, joined to request metadata. Native HTTP error-body capture is capped at
16 KiB. Validation records use issue paths/codes instead of submitted values.
Common authorization strings, secret assignments, JWTs, API keys and URL
credentials/queries are redacted on a best-effort basis. Unknown paths/models
remain masked. Not every failure supplies a stack or upstream code.

Normal prompts, replies, tool arguments, raw headers and queries are not saved in
the activity database. Exceptions are bounded diagnostic messages supplied on an
error path and the evidence/identity from explicitly requested synthetic model
checks. Review exported diagnostics before sharing them: redaction is not a
guarantee that arbitrary upstream error text contains no sensitive information.

Failures recorded by older versions retain their status/client metadata but may
have no detailed reason. Client-only errors that never reach the proxy are not
observable. An empty filtered list does not mean every client succeeded.

## Local debug logging

| Setting | Behavior |
| --- | --- |
| No flags | ERROR lines still go to stderr and `debug.log`; INFO/DEBUG lines are skipped. Saved activity/error history remains enabled. |
| `M365_DEBUG=1` | Enable INFO/DEBUG log lines with payload truncation. |
| `M365_TRACE=1` | Implies debug logging and permits much larger/untruncated protocol payloads. Use only for deliberate protocol investigation. |
| `M365_LOG_STDOUT=1` | Enable INFO/ERROR lines on process stderr as well as the local file; DEBUG still requires DEBUG/TRACE. The historical variable name says stdout, but the logger writes stderr. |
| `M365_LOG_FILE` | Rename/move `debug.log`; relative paths use the data root, absolute paths are accepted. |
| `M365_DUMP_FRAMES=1` | Save WebSocket frame dumps under `frames/`. |
| `M365_FRAME_DIR` | Override the frame directory, relative to the data root unless absolute. |

`debug.log` rotates after approximately 10 MiB, keeping one previous `.1` file.
Individual log lines are capped at 16,000 characters normally or 1,000,000 with
trace. Frame dumps are separate and do not inherit SQLite retention controls.
Debug/trace/frame files may include prompts, responses and other protocol data;
do not put them in Git or publish them as screenshots. Turn off research flags
after collecting the evidence you need. See [protocol investigation](m365-copilot-api.md)
before changing protocol behavior.

The Windows sign-in runner captures stdout/stderr under `service-logs` and
rotates its local files; those logs are separate from SQLite history and
`debug.log`. Run `m365-proxy service status` to locate the runner logs.

## Inspection, backup and recovery

- `m365-proxy diagnostics output.json` exports runtime/configuration status, not
  credentials, browser state, log contents, environment dumps or prompts.
- `m365-proxy doctor` is local-only. `doctor --live` checks authentication and can
  contact Microsoft, but sends no chat.
- Back up SQLite through its online backup API or stop the proxy first. Copying
  only the main file while WAL is active can omit committed changes.
- Storage errors appear in status with unsaved/lost counts. Serving continues,
  with a 10,000-record emergency memory buffer; that is an outage limit, not a
  retention policy. Pending batches (up to 500 ms/100 records) can be lost on an
  abrupt process exit.

Schema migrations preserve prior records. Do not delete a database to repair a
display problem. See [storage](activity-database.md) and
[operations](operations.md) for supported recovery and runtime rollback.
