# M365 Copilot Proxy

Requires Node.js 24+. The package includes its built server and JavaScript runtime dependencies; setup provisions the matching Chromium browser separately.

```text
m365-proxy setup
m365-proxy login
m365-proxy serve
```

On Windows, `m365-proxy service install` registers per-user sign-in startup, and `m365-proxy service start` starts it now. `service status`, `service stop` and `service uninstall` manage it. `doctor` is a local diagnostic check; `diagnostics output.json` exports credential-free status. See the included `OPERATIONS.md` for configuration, security, release installation, update/rollback and recovery.

Default endpoint: `http://127.0.0.1:4141/v1`. Account state stays in `~/.config/opencode-m365`. A non-loopback bind requires `M365_API_KEY`. This is an unofficial adapter for the enterprise M365 Copilot service and requires a supported work/school account.
