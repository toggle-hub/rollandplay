#!/usr/bin/env bash
# Runs on the VPS as `deploy` (piped over SSH by CI): bash -s -- <backend|frontend> <release-id>
# Activates /opt/rollandplay/<component>/releases/<release-id> and keeps the newest 5 releases.
set -euo pipefail

component="$1"
release="$2"
base="/opt/rollandplay/${component}"
case "$component" in backend | frontend) ;; *) echo "unknown component: $component" >&2; exit 2 ;; esac
[ -d "$base/releases/$release" ] || { echo "missing release: $base/releases/$release" >&2; exit 1; }

previous="$(readlink "$base/current" || true)"
ln -sfn "releases/$release" "$base/current.new"
mv -Tf "$base/current.new" "$base/current"

if [ "$component" = backend ]; then
  fail() {
    journalctl -u rollandplay-backend -n 80 --no-pager || true
    if [ -n "$previous" ]; then
      echo "rolling back to $previous" >&2
      ln -sfn "$previous" "$base/current.new" && mv -Tf "$base/current.new" "$base/current"
      sudo /usr/bin/systemctl restart rollandplay-backend || true
    fi
    exit 1
  }
  sudo /usr/bin/systemctl restart rollandplay-backend || fail
  # The server exits on DB/Redis failures shortly after start, so wait for it to answer HTTP.
  for _ in $(seq 30); do
    if curl -s -o /dev/null http://127.0.0.1:8080/api/me; then up=1; break; fi
    sleep 1
  done
  [ "${up:-}" = 1 ] || fail
fi

cd "$base/releases"
ls -1t | { grep -vxF "$release" || true; } | tail -n +5 | xargs -r rm -rf --
echo "$component release $release active"
