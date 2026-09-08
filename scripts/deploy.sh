#!/usr/bin/env bash
# Blue/green application update. Infrastructure remains running.
set -euo pipefail
cd "$(dirname "$0")/.."
[[ ${IMAGE_TAG:-} =~ ^[a-f0-9]{40}$ ]] || { echo 'IMAGE_TAG must be the tested commit SHA'; exit 1; }
[[ ${IMAGE_PREFIX:-} =~ ^[a-z0-9][a-z0-9_.-]+$ ]] || { echo 'IMAGE_PREFIX must be your Docker Hub namespace'; exit 1; }
export IMAGE_PREFIX IMAGE_TAG
export APP_ENV_FILE="$PWD/deploy/production/.env"
[[ -f $APP_ENV_FILE ]] || { echo 'Configure deploy/production/.env first'; exit 1; }
mkdir -p deploy/state deploy/traefik/dynamic
exec 9>deploy/state/deploy.lock
flock -n 9 || { echo 'Another deployment is running'; exit 1; }
previous=none
[[ ! -f deploy/state/active-slot ]] || previous=$(cat deploy/state/active-slot)
[[ $previous == none || $previous == blue || $previous == green ]] || exit 1
export SLOT=blue
[[ $previous != blue ]] || SLOT=green
compose=(docker compose -p "sigmactf-$SLOT" -f deploy/production/app.yml)
"${compose[@]}" pull
# Pre-pull the exact matching lab images, keeping challenge launches off the registry API.
docker pull "$IMAGE_PREFIX/web-ping-of-ohio:$IMAGE_TAG"
docker pull "$IMAGE_PREFIX/pwn-sigma-overflow:$IMAGE_TAG"
# The API must seed challenge image tags from this release, not the persistent env file.
export RELEASE_TAG="$IMAGE_TAG"
"${compose[@]}" up -d --wait --wait-timeout 180
app_host=$(python3 -c 'from urllib.parse import urlparse; from pathlib import Path; print(urlparse(next(x.split("=",1)[1] for x in Path("deploy/production/.env").read_text().splitlines() if x.startswith("APP_ORIGIN="))).hostname)')
export APP_HOST="$app_host"
[[ ! -f deploy/traefik/dynamic/active.json ]] || cp deploy/traefik/dynamic/active.json deploy/state/previous-route.json
python3 - <<'PY'
import json, os
from pathlib import Path
slot=os.environ['SLOT']; host=os.environ['APP_HOST']
if not host or any(c not in 'abcdefghijklmnopqrstuvwxyz0123456789.-' for c in host): raise SystemExit('Invalid APP_ORIGIN')
routes={'http': {'routers': {
    'platform-api': {'rule': f'Host(`{host}`) && PathPrefix(`/api`)', 'entryPoints':['web'], 'service':f'api-{slot}', 'priority':100},
    'platform-web': {'rule': f'Host(`{host}`)', 'entryPoints':['web'], 'service':f'web-{slot}', 'priority':10}},
    'services': {
    f'api-{slot}': {'loadBalancer':{'servers':[{'url':f'http://api-{slot}:4000'}]}},
    f'web-{slot}': {'loadBalancer':{'servers':[{'url':f'http://web-{slot}:3000'}]}}}}}
directory=Path('deploy/traefik/dynamic')
(directory/'active.tmp').write_text(json.dumps(routes))
os.replace(directory/'active.tmp',directory/'active.json')
PY
# Poll through the proxy after its file-provider debounce; preserve old slot on failure.
healthy=false
for attempt in $(seq 1 15); do
  if curl --fail --silent -H "Host: $APP_HOST" http://127.0.0.1:8080/api/health | python3 -c 'import json,sys,os; sys.exit(0 if json.load(sys.stdin).get("release")==os.environ["IMAGE_TAG"] else 1)'; then healthy=true; break; fi
  sleep 2
done
if [[ $healthy != true ]]; then
  if [[ -f deploy/state/previous-route.json ]]; then
    cp deploy/state/previous-route.json deploy/traefik/dynamic/restore.tmp
    mv deploy/traefik/dynamic/restore.tmp deploy/traefik/dynamic/active.json
  fi
  echo 'Route verification failed. Previous route restored where available; both slots retained for diagnosis.'
  exit 1
fi
printf '%s' "$SLOT" > deploy/state/active-slot
sleep 15
if [[ $previous != none ]]; then
  SLOT="$previous" docker compose -p "sigmactf-$previous" -f deploy/production/app.yml down
fi
echo "Deployment healthy: $IMAGE_TAG ($SLOT)."
