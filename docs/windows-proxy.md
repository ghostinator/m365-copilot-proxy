# Windows quick start

Use Node 24+ and run `scripts\windows\Setup-Proxy.ps1` from a source checkout, or use the prebuilt release and its `m365-proxy.cmd setup`. Setup installs the browser matching the pinned Playwright version. It preserves the existing `~/.config/opencode-m365` account state.

Run `node packages\proxy\bin\m365-proxy.mjs login` for explicit sign-in. Then run `Start-Proxy.ps1` for a foreground proxy, or use `m365-proxy service install` followed by `service start` for hidden, supervised startup at your next sign-in. No task is registered by setup. `Stop-Proxy.ps1` requests a graceful stop without trusting or killing an arbitrary PID.

`Test-Proxy.ps1` checks readiness and model discovery without spending a chat turn. Add `-Live` to explicitly send one completion, or `-Tools` for one isolated real-pi tool loop that must write a unique marker to disk. An HTTP check alone does not prove tool behavior.

The default bind is `127.0.0.1`; IPv6 loopback is `::1`. Wildcard addresses (`0.0.0.0`, `::`) require an API key. Port/host can be persisted in private `server.json`, with environment overrides supported. Background tasks explicitly disable interactive login and use the same Windows identity/profile as setup.

This is a model backend, not a Microsoft Graph/mail/calendar integration. Native tool calling remains outside scope. See [operations](operations.md) for releases, update/rollback, diagnostics, limits and recovery.
