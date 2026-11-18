#!/usr/bin/env bash
# Build the suite and copy it to the host.  Usage: DEPLOY_TARGET=user@host:/srv/creative-tools ./deploy/deploy.sh
set -euo pipefail
: "${DEPLOY_TARGET:?Set DEPLOY_TARGET, e.g. root@tools:/srv/creative-tools}"
cd "$(dirname "$0")/.."
npm run build
rsync -av --delete dist/ "$DEPLOY_TARGET/"
