# Linux validation — October 24, 2026

With user authorization, Ubuntu was installed using the existing WSL installation
(`wsl --install -d Ubuntu --no-launch`). It boots successfully as WSL2, despite a
nonfatal nested-virtualization warning. Reported environment: Ubuntu 26.04.1 LTS,
x86_64, kernel `6.18.54.1-microsoft-standard-WSL2`.

Validation uses a separate Linux filesystem checkout at
`/root/m365-proxy-validation-20261024`. Node 24.21.0 was obtained from the official
Node distribution endpoint and checked against its SHA-256 manifest; pnpm 10.32.1
matches the repository's pinned package manager. Tools/logs live under
`/opt/m365-validation`. No Windows credential/cache/browser data was copied into
the Linux account, and no live Microsoft requests were made.

## Baseline fixes at revision 7f18693

- Frozen-lockfile dependency installation: passed.
- Full build and unit suite: 434 passed, 6 live tests skipped.
- Installed-runtime offline authentication/policy/shutdown fixtures: passed.
- Extracted npm package, running outside the checkout: passed.
- Bundled-Node Linux portable release: built and all 900 manifest hashes verified.
- Release copy in a path containing spaces: setup/doctor/startup fixtures passed.

## Feature follow-up at revision 4921191

The updated Linux build/unit suite passed **439 tests, 6 live tests skipped**.
Installed-runtime checks, including the dashboard and authenticated operator-status
routes, passed. The extracted updated npm package also passed startup/policy/stop
checks outside the checkout. The Windows build/unit suite likewise passed 439
tests; installed Nitro routes and the isolated pi configuration CLI passed offline
checks. The dashboard was visually inspected in the in-app browser using an
explicitly loaded offline MSAL fixture, then the preview server was stopped.

## Boundaries

WSL validation establishes Linux build/runtime behavior, not Nix derivation or
NixOS service correctness. A regular Linux desktop user account, systemd service
installation, actual-account Linux authentication, remote CI and reboot/soak
behavior have not been validated. The initial source checkout remains unchanged;
all implementation work is in the upstream checkout and its local feature branch.
