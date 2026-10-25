# Named application API keys

Use separate keys to distinguish applications even when they share a host/IP.
Each accepted key provides a stable application ID and a human-readable label.
Incoming authentication stays optional by default; adding a key does not require
other clients to use one.

## Create and use

On the proxy host, using its existing account/data directory:

```sh
m365-proxy keys create "Production application"
m365-proxy keys create "Development application"
m365-proxy keys create "Agent automation"
```

Each command prints a new random token **once**, plus its ID/label. Copy that token
into the corresponding client's API-key field. Clients send
`Authorization: Bearer <token>` to the normal proxy base URL. Keep the Microsoft
sign-in separate: these keys identify callers of this proxy, not Microsoft accounts.
Clients using different keys also retain separate caller identities for conversation reuse.

The private `proxy-api-keys.json` file stores only SHA-256 digests, IDs, labels,
creation/revocation timestamps and the explicit required-mode flag. Tokens have
32 random bytes of entropy. List/status responses omit digests and raw tokens; authorized creation displays its new token once.
If a token is lost, create a replacement and revoke the old ID.

## Manage

```sh
m365-proxy keys list
m365-proxy keys rename <id> "New application label"
m365-proxy keys revoke <id>
m365-proxy keys mode required
m365-proxy keys mode optional
```

Changes apply to subsequent requests without restart. Revocation does not cancel
an existing chat. Renaming affects new request labels; historical labels remain
unchanged. A local file lock serializes CLI and dashboard mutations; concurrent updates fail
without overwriting another writer. Repair a leftover lock only after confirming
no key-management process is running. Invalid key configuration fails closed.

Optional mode accepts keyless traffic and unknown placeholder tokens as
unattributed, matching existing keyless clients. Revoking a key in optional mode
removes its attribution; it cannot prevent callers from using keyless access.
Use required mode if you want revoked/unknown tokens rejected. Required mode
cannot be enabled before a usable named or legacy key exists.

The existing `server.json` `apiKey` / `M365_API_KEY` remains valid and still makes
incoming keys required. Named keys are accepted alongside it. Removing required
mode for named keys does not disable a configured legacy key. No production keys
are created automatically. Up to 1,000 key records, including revoked keys, are
supported; request history still has unlimited retention.

## Dashboard and storage

Settings lists key metadata and offers create/rename/revoke controls after a
administrator password sign-in. First-time setup/recovery uses a host grant from
`.\m365-proxy.cmd operator authorize` in the portable release folder. See [dashboard management](dashboard-operations.md)
for expiry, origin checks and one-time token display. CLI management remains
available. There is no unauthenticated remote key-management
endpoint. These keys identify applications; they do not implement tenant-specific
permissions or restrict access to an individual application's dashboard records.

Requests shows key labels in the merged list and inspector, and can filter saved
and live requests by key. Clients shows key/model/route usage and system counts.
Records without a recognized key, including older rows, remain unattributed.
An app identity indicates which configured credential was used, not proof of the
physical machine or program. Shared keys combine usage.

Schema 5 normalizes `(key ID, historical label)` into `request_applications`; each
request stores a small integer reference instead of repeating the key ID/label.
The key digest never enters SQLite. Additive upgrades preserve earlier request
IDs, reports, timings and rollups. Back up the database before upgrading; older
binaries reject schema 5, so rollback may also require the pre-upgrade database.

## Guided pi/OpenClaw setup

Set an environment variable to the token you saved, then select its variable name:

```sh
m365-proxy client setup pi --api-key-env M365_APPLICATION_KEY
m365-proxy client setup openclaw --api-key-env M365_APPLICATION_KEY
```

The variable must be nonempty. Setup writes the chosen key to the client's private
configuration without printing it; `--dry-run` and `--replace` retain their existing
behavior. In required mode, setup refuses to write an unusable keyless configuration
if no key was supplied. `client info` and `doctor` report named-key required mode
correctly; they do not reveal any token. The token cannot be recovered from its ID
or stored digest.
