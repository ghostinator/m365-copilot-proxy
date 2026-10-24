# Install and operate the proxy

Node.js 24+ is supported. Windows startup runs as your user at sign-in, using your existing MSAL and browser profile. It is not a service that runs before sign-in. The default data directory remains `~/.config/opencode-m365`; upgrades do not rename or delete it.

## Portable release

Extract a release archive into a permanent directory. Run its `m365-proxy.cmd` on Windows, or `./m365-proxy` on Linux/macOS. Releases can include Node; otherwise install Node 24+. Git, pnpm, Nix and a compiler are not needed at runtime. Chromium is provisioned separately by setup using the Playwright version included in the release.

```powershell
.\m365-proxy.cmd setup
.\m365-proxy.cmd login
.\m365-proxy.cmd doctor
.\m365-proxy.cmd serve
```

`login` explicitly permits a visible browser for your tenant's SSO/MFA if silent or automated authentication is unavailable. Password/TOTP storage is optional; existing `secrets.json` continues to work. Background startup disables interactive prompts. If a tenant policy requires renewed human approval, run `login` again and restart.

`doctor` inspects local configuration and browser/runtime availability without authenticating or sending a chat. `doctor --live` checks authentication and can contact Microsoft, but sends no chat. `diagnostics output.json` exports only runtime/configuration status, excluding credentials, browser state, logs, environment dumps and prompts.

For a versioned per-user installation, run `INSTALL.cmd` or `windows\Install.ps1` from an extracted Windows ZIP. It verifies manifest hashes, copies into `%LOCALAPPDATA%\Programs\M365CopilotProxy\versions`, and creates a stable `m365-proxy.cmd` in the parent directory. It does not add itself to PATH or install startup automatically. Rerun from a newer release to update. An installed/running startup task is stopped, repointed, restarted and checked for readiness. The previous version is retained; `Install.ps1 -Rollback` switches back. Failed running-service updates restore the previous selection/task. An explicitly chosen data directory is remembered across updates and rollback.

## Start when you sign in

After a successful login:

```powershell
.\m365-proxy.cmd service install
.\m365-proxy.cmd service start
.\m365-proxy.cmd service status
.\m365-proxy.cmd service stop
.\m365-proxy.cmd service uninstall
```

The task uses the current user's interactive identity, stays attached to a watchdog, has no 72-hour execution limit and disallows duplicate task instances. The watchdog restarts unexpected Node failures up to three times, five seconds apart; authentication/configuration exit 78 is not retried rapidly. `M365_SERVICE_RESTARTS=0..10` adjusts the watchdog's bound. Task Scheduler is additionally configured with three one-minute fallback retries. It opens no console or login window. `start` waits for `/health/ready`. `stop` verifies the recorded process identity and asks the server to drain; after 20 seconds it can force-stop the verified process. Logs are in `service-logs` under the data directory. Startup registration is separate from installing the files. Uninstall removes the startup task and preserves account/configuration state; remove application files separately when no longer needed.

## Local dashboard and client setup

These features are included in version 0.3.0 and later.

Visit `http://127.0.0.1:4141/dashboard` while the proxy runs. The first dashboard
version is read-only: readiness, authentication expiry, uptime, HTTP request totals,
remembered conversations, advertised models, known priority-access exhaustion and
configured fallback routes. It sends no Microsoft requests. Normal upstream turns
provide allowance observations when Microsoft includes metering. The dashboard
shows daily/weekly counts and their observation time; missing counts are unknown.
A missing exhaustion record does not mean quota remains.

The Activity card counts requests since the current process started, including
model-list connectivity tests, health probes, invalid/rejected chat requests and
unsupported routes. It separately shows in-flight, finished and failed requests,
with model/chat/health/other totals. Dashboard status polls, its page/script and
favicon are excluded. The latest 20 requests show bounded metadata: a known endpoint
(unknown paths are masked), method, time, status and duration. Query strings,
headers and bodies are never recorded in this activity view. Status 499 denotes
a client disconnect, and 502 can denote a streaming transport failure. HTTP 200
with an application-level error inside an SSE chunk is still an HTTP 200 here.
The dashboard refreshes every five seconds. The separate chat-admission count
drops to zero after a turn; it is not a lifetime count. Counts reset on restart.
If a proxy API key is configured, enter it in the page to read status. The page
holds it in memory only and never stores it in browser storage or the URL. Closing
or reloading the page clears it. Up to 20 in-memory error summaries show fixed
categories instead of raw log messages. Tray controls and browser-managed
start/stop remain tracked in [the roadmap](roadmap.md).

Quota observations persist atomically in private `quota-observations-<hash>.json`
files under the data directory. The hash scopes them to the authenticated tenant
and account; raw identifiers/tokens are not stored in these files or exposed by
the status API. Counts and route observations expire after six hours or a UTC
date change and then display as unknown. The last upstream route includes requested
and actual model IDs and indicates fallback use; it may describe a refused/failed
upstream attempt and does not establish successful client delivery. Observations
are a snapshot, not a live authoritative balance. Persistence failures do not
fail chat delivery. Process-local exhaustion walls retain their existing behavior.

Configure pi without manually editing JSON:

```text
m365-proxy client setup pi --dry-run
m365-proxy client setup pi
pi --provider m365 --model claude-sonnet
```

The command uses `PI_CODING_AGENT_DIR/models.json`, or `~/.pi/agent/models.json`,
and the current server endpoint/key and model registry. Other providers and top-level
settings are preserved. Existing different `m365` settings require `--replace`;
an exact private backup is made before writing. Invalid JSON is left untouched.
Dry-run writes nothing and prints no API key. `--config path` selects another file;
`--base-url https://host/v1` selects another endpoint. Remote endpoints require
HTTPS. Setup sends no chat, changes no pi defaults and does not install pi itself.

OpenClaw uses the same model generator as the plugin:

```text
m365-proxy client setup openclaw --dry-run
m365-proxy client setup openclaw
m365-proxy client info
```

Setup honors `OPENCLAW_CONFIG_PATH`, then `OPENCLAW_STATE_DIR/openclaw.json`,
otherwise `~/.openclaw/openclaw.json`, following [OpenClaw's environment conventions](https://docs.openclaw.ai/help/environment).
It preserves other providers, existing aliases and the selected default model.
The same dry-run/backup/replace rules apply. This writer accepts strict JSON;
JSON5/comments or malformed nested config are rejected without changing the file.
Use `--config` to generate a separate JSON file for manual merging in that case.
`client info` prints credential-free connection instructions and model IDs for
other OpenAI-compatible clients. It never prints the configured proxy key or
probes Microsoft. Setup does not install or launch OpenClaw.

## Configuration and security

`setup` creates a private `server.json` in the data directory if none exists:

```json
{ "host": "127.0.0.1", "port": 4141 }
```

Environment overrides remain supported. `M365_DATA_DIR` explicitly selects a different data root; no automatic migration occurs. Per-file legacy overrides (`M365_CACHE_FILE`, `M365_SECRETS_FILE`, `M365_BROWSER_PROFILE`, log/frame paths) still work. Stop all instances before moving state. On Windows setup restricts data-root inheritance to the current user and SYSTEM; POSIX state files are written mode 0600 in a 0700 directory.

The default listener is loopback. A non-loopback bind requires `M365_API_KEY`; put `apiKey` in private `server.json` when a background task must retain the setting. Clients then send `Authorization: Bearer <key>`. Restrict the network/firewall and use TLS at a reverse proxy for remote access. Browser origins are denied unless they match the request origin or are explicitly listed in `M365_ALLOWED_ORIGINS` (comma-separated), or the `allowedOrigins` array in `server.json`. Native clients without Origin remain supported.

`GET /health/live` reports process liveness. `/health` and `/health/ready` report readiness (503 until startup authentication completes). Health probes do not send a chat. Auth startup failures exit with configuration code 78. Readiness tracks the last acquired token's expiry; standalone and OpenClaw servers silently renew it near expiry during idle periods. This maintenance can contact Microsoft's token endpoint, never sends a chat, and never opens a browser. A separate explicit login can update the cache that maintenance reloads. Readiness does not prove Microsoft will serve any particular model.

Clients can send `X-Conversation-Id` or `conversation_id` in the request body. These identifiers are scoped to the caller's bearer credential and tool names, and reuse still requires the exact previously acknowledged history and assistant reply. Clients without IDs use verified history matching; ambiguous histories start fresh. Full turns are serialized for one account, including upstream production of streamed responses.

## Limits and compatibility

| Setting | Default |
| --- | --- |
| `M365_CONNECT_TIMEOUT_MS` | 30000, including SignalR handshake |
| `M365_IDLE_TIMEOUT_MS` | 180000 without upstream frames |
| `M365_TURN_TIMEOUT_MS` | 600000 per upstream connection/turn |
| `M365_MAX_REQUEST_BYTES` | 32 MiB, including JSON/base64 images |
| `M365_MAX_IMAGE_BYTES` | 20 MiB per image/download |
| `M365_MAX_SESSIONS` | 128 remembered histories |
| `M365_MAX_PENDING_REQUESTS` | 32 admitted/queued requests |
| `M365_QUEUE_TIMEOUT_MS` | 120000 waiting for account admission |
| `M365_MAX_RESPONSE_CHARS` | 2000000 characters per upstream turn |

Image HTTP requests have a 60-second deadline; inbound request bodies have a 30-second deadline. `M365_BUDGET_LOGS` uses the platform path delimiter (`;` on Windows, `:` on POSIX), preserving Windows drive letters. These are local operational limits, separate from M365 quotas. `M365_AVOID_THROTTLING=1` enables the existing estimated account-budget pacing. Expensive chat/model probes remain explicit, sequential experiments.

`/v1/models` and generated OpenClaw configuration share input/output hints from one registry, including image input and reasoning classification by resolved tone. Context/output values are client hints, not measured model guarantees. OpenAI `temperature` and `max_tokens` are accepted for compatibility but are not upstream generation controls; the undocumented protocol does not offer equivalent verified controls. Tool-mode streaming buffers tool calls; text-mode streaming forwards deltas. Streaming failures after headers are committed appear as error chunks rather than a new HTTP status.

Operational errors are always logged. `M365_LOG_STDOUT=1` also emits operational information (to stderr for service capture); detailed prompts/frames require opt-in debug/trace. Debug logs rotate at 10 MiB with one backup; frame dumps are explicit opt-in and require operator retention management. Diagnostics exports do not include these files.

## Developer validation and releases

```text
pnpm install --frozen-lockfile
pnpm test
node scripts/test-installed-runtime.mjs
node scripts/build-release.mjs --include-node
node scripts/verify-release.mjs <release-directory>
```

The installed-runtime tests use an explicitly loaded offline MSAL fixture and temporary state. It is never enabled by the production launcher. Release smoke tests copy the app into a temporary path containing spaces and run outside the repository. Manifests contain SHA-256 hashes of all shipped files; each archive has a separate checksum file. Verify a downloaded archive against a checksum obtained from a trusted release channel before extraction; an included manifest is an integrity check, not an authenticity signature.

Windows/Linux CI runs build/unit tests and built/isolated runtime checks. The Windows runner, task definition and versioned installer have offline checks. `scripts/test-windows-service.ps1` additionally registers a uniquely named temporary sign-in task with a local fake server, verifies failure/restart and stop, then removes it. Real M365/pi validation, actual account startup, reboot/logoff behavior and 24–72-hour soak tests remain separate account/host checks. `scripts/windows/Test-Proxy.ps1 -Tools` runs one isolated, real pi tool loop; `-Live` runs one plain completion instead. NixOS users can continue using the existing `services.m365-copilot-proxy` module and systemd unit.
