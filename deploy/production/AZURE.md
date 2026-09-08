# Azure deployment runbook

Status: prepared, not deployed. No Azure resources, DNS records, GitHub repository or production secrets were provided to the authoring session. Do not treat this guide as evidence that the proposed free-tier capacity is available or load-tested.

## 1. Confirm the subscription and capacity

In the Azure portal, inspect the subscription's Free Services page and regional VM quota before provisioning. Select an eligible **x86-64** Linux SKU if retaining Sigma Overflow. The current build workflow publishes Linux AMD64 images; ARM64 B2pts_v2 needs separately built control-plane images and a redesigned ARM pwn exercise or explicitly tested emulation.

The [Azure for Students offer](https://azure.microsoft.com/en-us/free/students/) describes credit and conditional service allowances. Check the exact eligible VM size and 12-month expiry. PostgreSQL Flexible Server's listed allowance is 750 hours of B1MS, 32 GB data and 32 GB backup. Additional storage, IP addressing, traffic, excess usage, optional monitoring and a domain can create charges. A budget alert is informational, not a hard spending cap. Keep the subscription spending limit where available; never assume an alert prevents credit use.

The ten-instance maximum alone reserves 640 MiB for sandboxes. Linux, Docker, Traefik, web, API, janitor, proxies and Redis need additional memory; blue/green deployment briefly duplicates application processes. Start with a measured concurrency limit that fits the VM. `MAX_INSTANCES=5` is a configurable target, not verified capacity. Offloading PostgreSQL helps memory, but no 24/7 or $0 operating guarantee is made. Confirm the offer in the actual account and perform a load test before committing to 5–10 concurrent users.

## 2. Prepare the host

Use an Ubuntu x86-64 VM with Docker Engine 28+, Compose v2, the Docker iptables backend, Python 3, curl, util-linux (`flock`), and br_netfilter. Give a dedicated deployment account ownership of `/opt/sigmactf`, write access to `/opt/sigmactf-release.tar.gz`, and Docker access. Docker membership is equivalent to a highly privileged host role.

Copy this source tree to `/opt/sigmactf`. Run `python3 scripts/init-local.py`. Keep HTTP bound to `127.0.0.1:8080`; a Cloudflare Tunnel will provide encrypted web ingress without exposing origin HTTP. If pwn challenges must be reachable from players, set `TCP_BIND_ADDRESS=0.0.0.0` in `deploy/local/.env` and allow 30000–30050/TCP in the VM network security group only for the intended player audience. Restrict SSH to the operator or runner access path. Never publish PostgreSQL, Redis, socket proxies or the Traefik dashboard.

Start infrastructure only:

```bash
cd /opt/sigmactf
docker compose --env-file deploy/local/.env -f deploy/local/docker-compose.yml up -d traefik socket-read socket-write redis
sudo bash scripts/sandbox-firewall.sh
```

If using local PostgreSQL instead of Azure PostgreSQL, also start the `postgres` service. Do not run the local `api`, `web` or `janitor` services in production; the slot configuration replaces them. Stop any existing local app containers before the first blue/green rollout to avoid conflicting routes.

Create a system service or equivalent boot step to reapply `scripts/sandbox-firewall.sh` after Docker starts. Persist `net.bridge.bridge-nf-call-iptables=1`. Ensure the reserved `172.30.0.0/16` range does not overlap the VM's VNet or another Docker network. The script is for iptables, not Docker's experimental nftables backend.

## 3. Configure PostgreSQL and application secrets

Copy `deploy/production/.env.example` to `deploy/production/.env` and set permissions to `0600`. Fill in two separate randomly generated 64-character secrets, the Docker Hub owner, app origin, challenge domain and pwn hostname.

For managed PostgreSQL, use its DNS endpoint, an application database and a dedicated login with schema migration rights. Require TLS verification (`sslmode=verify-full`) and restrict server network access to the VM. The Node image includes standard CA roots; install any additional operator-required CA bundle if the server chain needs it. URL-encode password characters in `DATABASE_URL`. Do not disable certificate verification.

Use `PUBLIC_WEB_PORT=443`, `PUBLIC_HTTPS=true`, `COOKIE_SECURE=true`, `CHALLENGE_DOMAIN=example.com`, and `APP_ORIGIN=https://ctf.example.com` in the production application environment. Leave the infrastructure host HTTP bind at loopback port 8080. Only set `SANDBOX_FIREWALL_CONFIRMED=true` after the host rules are active and have passed an isolation test.

JWT and flag secrets must remain identical in both application slots. PostgreSQL and Redis state must be shared across slots. Keep data/backup retention within the account allowance and test restores. Redis AOF persists limiter counters across restarts; disk growth also needs monitoring.

## 4. Configure Cloudflare and DNS

Use an existing domain on Cloudflare. Create a Cloudflare Tunnel and route `ctf.example.com` and `*.example.com` to `http://traefik:80` with incoming Host headers preserved. Ensure the wildcard DNS route exists. Keep `tcp.example.com` as a more-specific **DNS-only A record** pointing to the VM for raw pwn traffic. The wildcard includes only first-level names, matching the [Universal SSL coverage](https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/limitations/).

Supply the tunnel token securely in a root/deployment-readable environment file outside source control and start the optional tunnel configuration:

```bash
docker compose --env-file /secure/path/tunnel.env -p sigmactf-tunnel -f deploy/production/tunnel.yml up -d
```

`tunnel.env` contains `TUNNEL_TOKEN=...`. The tunnel connector has no challenge or socket-proxy network access. The raw TCP service bypasses Cloudflare's HTTP proxy and its web protection; [Cloudflare documents its supported proxy ports](https://developers.cloudflare.com/fundamentals/reference/network-ports/). Avoid applying challenge-breaking WAF rules to the deliberately vulnerable labs, while retaining protection for the platform host.

## 5. Enable GitHub deployment

Create a repository from the source and configure Docker Hub visibility/access. The VM must be able to pull all four images; authenticate Docker on the VM with a read-packages credential for private packages. Public Docker Hub and public repository Actions have different usage terms from private repositories; verify current quotas instead of assuming unlimited free CI/storage.

Create a protected GitHub environment named `production`, with these secrets:

| Secret | Value |
|---|---|
| `AZURE_HOST` | VM address or SSH hostname |
| `AZURE_USER` | Dedicated deployment account |
| `AZURE_SSH_KEY` | Deployment private key |
| `AZURE_KNOWN_HOSTS` | Previously verified SSH host key line |

Set repository variable `AZURE_DEPLOY_ENABLED=true` only after completing host setup. The workflow validates, runs browser tests, builds all four images, publishes `:v1` and commit-SHA tags, transfers the tested source and invokes `scripts/deploy.sh`. It does not create Azure resources. Actions use major-version tags; pin them to reviewed commit SHAs if the deployment requires stricter supply-chain controls. Pin infrastructure images to reviewed digests for fully reproducible production rollout.

## 6. Verify and recover

Before opening the arena, test the real Docker E2E scenario and these host-dependent properties: web and TCP reachability, forbidden sandbox internet/host/database/socket/peer access, memory/PID limits, non-root read-only execution, expiry while the API is stopped, janitor recovery after restart, and two simultaneous spawn requests for the same player. These are release gates, not claims of completed validation.

For a manual application release, after image publishing:

```bash
IMAGE_PREFIX=mawin82560 IMAGE_TAG=<40-character-tested-commit-sha> bash scripts/deploy.sh
```

The script alternates blue/green projects, waits for container health, atomically changes the file-provider routes, and checks that `/api/health` returns the expected release. On route verification failure it restores the prior route when one exists and retains both slots for inspection. Pre-switch failure leaves the old route untouched. Logs are available with `docker compose -p sigmactf-blue -f deploy/production/app.yml logs` after exporting the required environment values. State is under `deploy/state/` and is excluded from source control.

After successful handoff, the old app slot drains for 15 seconds before removal; challenge containers remain independently managed. The script does not prune images automatically, preserving rollback choices. To roll back, redeploy a previously verified SHA. Migrations must remain backward-compatible because both versions share one database. Destructive schema changes require a separately planned maintenance operation and backup.

One VM, one database and one Traefik process cannot provide host-failure high availability. Infrastructure restarts are outside the application blue/green guarantee. Under memory pressure, even application overlap may fail; health gating helps avoid routing to the unhealthy slot but cannot prevent the host OOM killer from affecting the old slot.

