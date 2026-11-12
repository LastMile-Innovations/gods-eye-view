# Hosted NeighborOS

Current Agent validation and native read-workflow scope: [QEVAL-WORKFLOWS.md](QEVAL-WORKFLOWS.md). Earlier canned QEval records are classified unverified; new core checks execute nine probes with eleven NOT_RUN scenarios.

Hosted web access is the product target. Automatic loopback development sessions
are only for development/testing. Users see **Sign in**, complete the configured
OIDC provider's normal login, and return to their workspace. A valid session restores
automatically after refresh. There are no terminal codes or pairing forms.

The production entry point is `npm start`, serving `dist/` and the authenticated
workspace API. It does not run Vite, setup, MCP or inherited development provider
routes. The public frontend can load without authentication; private operations
require sign-in. Public source availability still depends on rights and provider
integration, and unavailable provider APIs return JSON 404 rather than pretend data.

## Configuration

Configure a confidential OpenID Connect client with Authorization Code flow and
`client_secret_basic`. Register the exact callback
`https://YOUR-DOMAIN/auth/callback`, allow `openid profile email`, and set these
**server environment variables** through your host's secret manager:

| Variable | Required value |
|---|---|
| `NEIGHBOR_PUBLIC_ORIGIN` | Exact public HTTPS origin, with no path or query |
| `NEIGHBOR_OIDC_ISSUER` | Provider's exact HTTPS issuer/discovery authority |
| `NEIGHBOR_OIDC_CLIENT_ID` | Registered confidential client ID |
| `NEIGHBOR_OIDC_CLIENT_SECRET` | Client secret; never a `VITE_` variable |
| `NEIGHBOR_TENANT_KEY` | Stable, randomly generated 32-byte key encoded as base64 |
| `NEIGHBOR_HOSTED_DATA_DIR` | Absolute private durable-volume path outside `dist` |
| `NEIGHBOR_NATIVE_BIN` | Reviewed native adapter executable; set by the container |
| `PORT` | Internal port, default 8080 |

Generate the routing key once using `openssl rand -base64 32`, store it securely,
and preserve it with the volume's recovery material. Changing it changes account
routing; it is not an encryption key. Do not rotate it by restarting or regenerate
it on each deploy. Existing local developer data is not automatically assigned to
an online account. Account migration needs an explicit, verified transfer.

The [OIDC client](https://github.com/panva/openid-client/blob/main/docs/README.md)
checks code flow, S256 PKCE, state, nonce, issuer, audience, expiry
and ID-token signatures. Only the verified `(issuer, subject)` selects an account.
Email changes and identical email addresses across accounts cannot merge workspaces.
Access/ID tokens are neither sent to browser JavaScript nor stored as app records.

## Run and package

From `gods-eye-view/`, using the supported Node 24.14+ or 26 runtime and the exact Rust pin in `../Quanta/native/rust-toolchain.toml` (currently 1.99.1):

```sh
npm ci
npm run workspace:build
npm run build
npm start
```

The native build and serving path use the guarded optimized release profile. The container recipe includes canonical toolchain/workspace metadata. [Local qualification](../../research/unified-world/optimized-worker/REPORT.md) includes staged dependency resolution; the Docker image build itself remains unverified this phase.

Or build the deployment image from **OS1**, where both sibling source trees live:

```sh
docker build -f Dockerfile.hosted -t neighboros:hosted .
```

The image uses a production Node process, an unprivileged `node` user, a separately
built native binary and a private `/data` directory. Mount a persistent volume at
`/data`, writable by UID 1000. Terminate HTTPS at a trusted reverse proxy, preserve
the public Host header, and keep the internal port private to that proxy. Forwarded
headers do not establish user identity, routing or request-origin authority.
`GET /healthz` is a secret-free liveness check and requires the configured Host.

This is a **single application instance with one durable volume**. Do not horizontally
replicate it against the same native stores. Authentication sessions and login
transactions are bounded process memory: restarts sign users out; their records and
native identity persist. Up to 16 account workers are retained, with idle eviction
only when no HTTP request is using them; excess demand receives a retryable limit.
Each account has the existing per-workspace record/content/queue limits.

## Security and remaining gates

Session cookies use the `__Host-` prefix, Secure, HttpOnly and SameSite=Lax. Sessions
expire after eight hours; logout invalidates the current server session. Every API
mutation checks the exact public Origin and session-bound CSRF token. The login
transaction is browser-bound, expires after ten minutes and is consumed once.
Logout ends this application session; it does not promise IdP-wide/global logout,
back-channel revocation or immediate propagation of IdP account disablement.

Each account gets a separate native Quanta database/authority domain and private
directory, selected by a server HMAC of verified identity. The host process retains
filesystem access: this is not client encryption or protection from the hosting
operator. Organization sharing, account deletion, federation and public posting
need additional domain authority. Imported restricted assets are not cleared for
redistribution by this package. Existing broad provider CSP allowances remain under
review. Configure edge abuse/rate controls before internet exposure.

The [delivery evidence](../../research/unified-world/hosted-foundation/REPORT.md)
separates signed fixture/browser/native checks from live IdP and hosting acceptance.
Real provider configuration, container/Linux execution, deployed TLS, volume backup
and restore, load tests and independent security review remain required before
production acceptance. No hosting service, public domain or identity provider has
been activated by this implementation.
