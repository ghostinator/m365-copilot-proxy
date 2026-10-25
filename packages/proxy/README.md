# M365 Copilot Proxy

Requires Node.js 24+. The package includes its built server and JavaScript runtime dependencies; setup provisions the matching Chromium browser separately.

```text
m365-proxy setup
m365-proxy login
m365-proxy serve
```

On Windows, `m365-proxy service install` registers per-user sign-in startup, and `m365-proxy service start` starts it now. `service status`, `service stop` and `service uninstall` manage it. `doctor` is a local diagnostic check; `diagnostics output.json` exports credential-free status. See the included `OPERATIONS.md` for configuration, security, release installation, update/rollback and recovery.

Default endpoint: `http://127.0.0.1:4141/v1`. Account state stays in `~/.config/opencode-m365`. API keys are optional; set `M365_API_KEY` or `apiKey` in private `server.json` to require bearer authentication. This is an unofficial adapter for the enterprise M365 Copilot service and requires a supported work/school account.

## Dashboard and diagnostics

Open `http://127.0.0.1:4141/dashboard` (or your configured listener). The six tabs
are Overview, Requests, Clients, Models, Errors and Settings. They cover saved
rolling activity summaries, client/model rankings, scrollable request/error
history, database size, observed budgets and optional connection authentication.
Activity uses built-in SQLite with unlimited retention; no database server is
required. Normal chat content is not retained in activity history.

Under Models, select models and check types, then click Test selected models.
Eight checks cover identity, function/shell tools, tool results, streaming, JSON,
instructions and recall. Results appear in each row's Latest checks / served
route and Evidence / identity columns and persist independently per check type.
Checks run only when requested, consume quota, run sequentially and never execute
model-generated commands. Identity is self-reported; a passing sample is not a
general reliability guarantee. Errors includes HTTP-200 SSE failures and bounded,
redacted diagnostic reasons/stacks where available.

The [project README and screenshot gallery](https://github.com/ghostinator/m365-copilot-proxy#dashboard-and-operations-070),
[dashboard guide](https://github.com/ghostinator/m365-copilot-proxy/blob/main/docs/dashboard.md)
and [logging guide](https://github.com/ghostinator/m365-copilot-proxy/blob/main/docs/logging.md)
describe filters, result interpretation, storage, backups and troubleshooting.
Source version 0.7.0 does not imply that this fork has published an npm package.
