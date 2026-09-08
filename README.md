# SigmaCTF

A local-first CTF arena: five challenges, ephemeral Docker instances, 15-minute leases, JWT cookie authentication, atomic flag throttling, Aura scoring, first blood, and a responsive terminal-inspired interface.

This repository implements the supplied blueprint. It includes the application, four custom Docker image definitions, local Compose, database migrations and seeds, tests, and a staged Azure deployment workflow. **A production deployment has not been performed.** See [VALIDATION.md](VALIDATION.md) for exactly what ran in the authoring environment.

## Quick start: complete local stack

Requirements: Linux x86-64 Docker Engine 28+ with the iptables firewall backend, Docker Compose v2, and Python 3. Windows can use a Linux VM or WSL host running Docker Engine; the firewall script must run inside that actual Docker host. The x86-64 pwn lab deliberately excludes ARM from the supported release targets.

From this directory:

```bash
python3 scripts/init-local.py
docker build -t sigmactf/backend:v1 -f apps/api/Dockerfile .
docker build -t sigmactf/web:v1 -f apps/web/Dockerfile .
docker build -t sigmactf/web-ping-of-ohio:v1 challenges/web-ping-of-ohio/
docker build -t sigmactf/pwn-sigma-overflow:v1 challenges/pwn-sigma-overflow/
docker compose --env-file deploy/local/.env -f deploy/local/docker-compose.yml up -d
sudo bash scripts/sandbox-firewall.sh
```

After checking that the firewall rules are present, set `SANDBOX_FIREWALL_CONFIRMED=true` in `deploy/local/.env`, then recreate the API and janitor:

```bash
docker compose --env-file deploy/local/.env -f deploy/local/docker-compose.yml up -d api janitor
```

Open **http://ctf.localhost:8080** in Chromium, create an account, select Ping of Ohio, and click **Let Him Cook**. Browsers resolve `*.localhost` to loopback; some command-line DNS resolvers need `curl --resolve HOST:8080:127.0.0.1`. Pwn connections use `nc localhost <allocated-port>`.

The API applies the schema and catalog on startup. Keep both generated secrets stable across restarts. The seed credentials and static flags are training content; change static artifacts and their seeds together before a competitive event. Dynamic flags are generated separately for every instance and never returned by the platform API.

To stop platform services, use the same Compose command with `down`. This does not delete volumes. Stop player instances first: dynamic containers are intentionally outside the Compose project, so `compose down` alone does not remove them. Their process deadline remains active and the janitor reconciles them when restarted.

## Application preview without Docker

Requires Node.js 22 and Python 3:

```bash
npm ci
python3 scripts/generate-artifacts.py
npm run preview:api
# In another terminal:
npm run dev
```

Open **http://localhost:3000**. This is an explicit development harness with temporary embedded PostgreSQL, an in-memory rate limiter, and disabled sandbox launches. Registration, RSA/forensics downloads, flag submissions, and scoreboard work. Accounts disappear when the preview API stops. Linux ELF downloads are generated during the backend Docker build; the preview reports their absence instead of supplying dummy binaries. Production `main.mjs` never loads preview adapters.

## Project map

| Path | Responsibility |
|---|---|
| `apps/api/src/app.mjs` | REST routes, validation, auth, submissions and scoreboard |
| `apps/api/src/orchestrator/` | Docker policy, capacity, replacement and reconciliation |
| `apps/api/migrations/` | PostgreSQL constraints and indexes |
| `apps/api/src/rate-limit.mjs` | Atomic Redis INCR/EXPIRE Lua script |
| `apps/web/app/` | Arena, challenge dialogs, account flow and scoreboard |
| `challenges/` | Intentionally vulnerable labs and static reverse source |
| `scripts/generate-artifacts.py` | Deterministic RSA and ICMP PCAP generation |
| `deploy/local/` | Traefik, separated socket proxies, PostgreSQL, Redis, API, web and janitor |
| `deploy/production/` | Blue/green application slots and optional Cloudflare Tunnel |
| `.github/workflows/deploy.yml` | Verification, all four images, Docker Hub and opt-in Azure deployment |

## API

All routes begin with `/api`. Mutations require an `Origin` matching `APP_ORIGIN`. Authenticated routes use the HttpOnly, SameSite=Strict `sigma_session` cookie, scoped to `/api`; production enables Secure cookies. API responses disable caching. Passwords use salted scrypt. Flags use HMAC-SHA256 with a separate server secret and constant-time comparison.

| Method | Route | Access |
|---|---|---|
| POST | `/auth/register`, `/auth/login` | Handle/password; 15 requests per source address per 15 minutes |
| POST | `/auth/logout` | Clears session cookie |
| GET | `/me` | Authenticated user, Aura and solved IDs |
| GET | `/challenges`, `/scoreboard`, `/health` | Public |
| GET | `/challenges/:id/artifact` | Allowlisted public attachment |
| GET / DELETE | `/instances/current` | Own current instance / terminate |
| POST | `/challenges/:id/spawn` | Authenticated; max 3 launches/minute |
| POST | `/challenges/:id/submit` | `{ "flag": "sigma{...}" }`; max 5 checks/minute across all challenges |

The API currently uses the direct peer address for the authentication throttle; players behind the same proxy share that conservative window. Configure a narrowly trusted proxy chain before scaling account creation. Flag and launch limits are per user. Redis errors fail submission requests closed, and its `noeviction` policy prevents silent counter eviction. Solves use a unique user/challenge key and a locked challenge row, preserving one award per solve and one first blood under concurrency. Score ties favor the earlier final solve.

## Sandbox boundary

Every instance runs as UID/GID 10001 with 64 MiB memory and swap ceiling, 0.25 CPU, 50 PIDs, all capabilities dropped, no-new-privileges, a read-only filesystem, and a 16 MiB noexec/nosuid/nodev `/tmp`. No host mounts, host networking, published container ports, or user-supplied Docker specifications are accepted. Only catalog images under `IMAGE_PREFIX/` can run; images must already be pulled by the operator.

Instances receive separate internal Docker bridges: `172.30.<slot>.0/29`, Traefik at `.2`, challenge at `.3`, and bridge name `sg<11 hex digits>`. Slots 0–50 are reserved for this deployment. The firewall blocks new connections from challenge addresses and new host access, while allowing replies to inbound connections. The embedded DNS resolver has no usable upstream. `SANDBOX_FIREWALL_CONFIRMED` is an operator assertion, **not automatic firewall attestation**. Validate actual host, internet, database, proxy and peer isolation before allowing untrusted players. Persist and reapply firewall rules on reboot or Docker/firewall restart.

The writable socket proxy restricts endpoint families but **does not inspect create-request bodies or enforce ownership**. The API remains a highly trusted host-control component. A socket mounted `:ro` does not make Docker API operations read-only. The separately networked read-only proxy serves Traefik. The [socket proxy documentation](https://github.com/Tecnativa/docker-socket-proxy) explains these endpoint permissions. For hostile public multi-tenancy, a separately enforced Docker authorization policy or a dedicated hardened execution host is still advisable; this repository does not implement a VM-grade isolation boundary.

Launch/reap operations serialize with a PostgreSQL advisory lock. The database reserves a user's lease inside the same transaction as orchestration; labeled containers and deterministic network names support compensation and crash recovery. Cleanup failure keeps the row active for retry. An independent janitor runs on startup and every 60 seconds, removing expired, exited and orphan resources. The challenge entrypoints use an absolute expiry timestamp and a process timer. Flag submission stops at the database deadline even when infrastructure cleanup is delayed. The process timer is a fallback, not a tamper-proof replacement for the janitor.

## Tests

```bash
npm test
npm run build
npm audit --audit-level=high
npx playwright install chromium
npm run test:e2e
```

The default backend suite uses real embedded PostgreSQL with serialized test transactions, fake Docker and in-memory rate counters. It does not prove Linux isolation or Redis behavior. For real PostgreSQL advisory-lock contention and atomic Redis counters, set `DATABASE_TEST_URL` and `REDIS_TEST_URL` to disposable development services and rerun `npm test`. The test creates and drops only a unique temporary schema. CI supplies these services automatically.

The default Playwright suite covers registration, filter behavior, downloading and independently solving RSA, wrong/correct submissions, Aura, leaderboard, mobile overflow and keyboard dismissal. For the actual command-injection challenge on a running local Docker stack:

```bash
LIVE_DOCKER=1 BASE_URL=http://ctf.localhost:8080 npm run test:e2e
```

Use a Chromium browser that resolves `*.localhost`. The live scenario obtains the generated flag through the intended challenge vulnerability and submits it as the player; it does not read Docker environment data. Other tests remain active. Each test uses a unique account; live tests add practice scoreboard rows.

## Deployment and blueprint corrections

Read [deploy/production/AZURE.md](deploy/production/AZURE.md) before enabling the workflow. Public hosting, cloud resource provisioning, DNS changes and Docker Hub publishing require the corresponding account access; none were performed by the local build.

* Next.js is **15.5.25**, replacing 14 after dependency auditing found security advisories without fixes on that branch. The requested App Router architecture and Tailwind design tokens remain. The lockfile and transitive overrides capture the audited dependency graph.
* CI builds all four images and publishes both `:v1` and immutable commit-SHA tags. Deployment uses the tested SHA. Updating one mutable `:v1` tag alone is not a reproducible release.
* A plain `compose up -d` does not guarantee zero downtime. The production script starts a separate application slot, verifies health, atomically switches Traefik's file route, checks the routed release, and drains the previous slot. Infrastructure upgrades still interrupt their respective services, active long requests can outlive the finite drain, and a one-VM deployment has no host-level HA. Only backward-compatible migrations are safe during overlap.
* Raw pwn TCP ports use DNS-only records and bypass Cloudflare's free HTTP proxy; see [supported ports](https://developers.cloudflare.com/fundamentals/reference/network-ports/). First-level `s<id>.example.com` challenge names fit free edge certificates; `s<id>.chal.example.com` does not by default. See [Universal SSL limitations](https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/limitations/).
* Azure's student/free offer is conditional and time-limited. Its listed PostgreSQL allowance is 750 B1MS hours with 32 GB storage and backup for 12 months. This is not a permanent $0 guarantee; confirm eligibility, region, VM SKU, disks, IP, traffic, backup and expiry in the subscription. See [Azure for Students](https://azure.microsoft.com/en-us/free/students/). A 1 GiB VM has no demonstrated capacity here for ten sandboxes plus the control plane and overlapping deployment slots.

## Adding a challenge

Add the lab Dockerfile and source under `challenges/`, adhering to non-root/read-only runtime constraints and the `EXPIRES_EPOCH` timer contract. Build/pull its image before enabling the catalog row. Add its reviewed metadata in a migration, including delivery (`http`, `tcp`, `static`), target port, points, and a registry-prefixed image. Add artifact handling when applicable. Catalog changes are operator-controlled SQL; no public Docker-image or catalog-edit endpoint is exposed. Traefik discovers dynamic instance labels without restarting the VM.

