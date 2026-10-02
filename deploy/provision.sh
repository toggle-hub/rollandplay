#!/usr/bin/env bash
# One-time (idempotent) setup for an Ubuntu 22.04+ VPS. Run as root:
#   DEPLOY_PUBKEY='ssh-ed25519 AAAA... github-actions' PUBLIC_BASE_URL='https://143.95.169.22' bash provision.sh
# PUBLIC_BASE_URL must be https://<IP or domain>; its host gets a Let's Encrypt certificate (IPs use the
# 6-day `shortlived` profile). Optional ACME_EMAIL registers the ACME account with an address.
# Re-running is safe: existing secrets in /etc/rollandplay/backend.env are kept; its URLs follow PUBLIC_BASE_URL.
set -euo pipefail

: "${DEPLOY_PUBKEY:?set DEPLOY_PUBKEY to the public half of the GitHub Actions deploy key}"
: "${PUBLIC_BASE_URL:?set PUBLIC_BASE_URL, e.g. https://your-domain.example}"
case "$PUBLIC_BASE_URL" in https://*) ;; *) echo "PUBLIC_BASE_URL must start with https://" >&2; exit 1 ;; esac
tls_host="${PUBLIC_BASE_URL#https://}"
tls_host="${tls_host%%/*}"
here="$(cd "$(dirname "$0")" && pwd)"
codename="$(. /etc/os-release && echo "$VERSION_CODENAME")"
export DEBIAN_FRONTEND=noninteractive

# sudo warns on every call when the hostname does not resolve.
grep -qwF "$(hostname)" /etc/hosts || echo "127.0.1.1 $(hostname)" >>/etc/hosts

apt-get update -q
apt-get install -yq ca-certificates curl gnupg rsync nginx

# Postgres 16 (PGDG) and current Redis (packages.redis.io); Ubuntu 22.04 ships older majors.
install -d -m 755 /etc/apt/keyrings
if [ ! -f /etc/apt/sources.list.d/pgdg.list ]; then
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /etc/apt/keyrings/pgdg.gpg
  echo "deb [signed-by=/etc/apt/keyrings/pgdg.gpg] https://apt.postgresql.org/pub/repos/apt ${codename}-pgdg main" >/etc/apt/sources.list.d/pgdg.list
fi
if [ ! -f /etc/apt/sources.list.d/redis.list ]; then
  curl -fsSL https://packages.redis.io/gpg | gpg --dearmor -o /etc/apt/keyrings/redis.gpg
  echo "deb [signed-by=/etc/apt/keyrings/redis.gpg] https://packages.redis.io/deb ${codename} main" >/etc/apt/sources.list.d/redis.list
fi
apt-get update -q
apt-get install -yq postgresql-16 redis
systemctl enable --now postgresql redis-server

# Accounts: the service runs as `rollandplay`; CI logs in as `deploy`.
id rollandplay >/dev/null 2>&1 || useradd --system --home-dir /var/lib/rollandplay --shell /usr/sbin/nologin rollandplay
id deploy >/dev/null 2>&1 || useradd --create-home --shell /bin/bash deploy
usermod -aG systemd-journal deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
printf 'restrict %s\n' "$DEPLOY_PUBKEY" >/home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys

install -d -m 755 -o deploy -g deploy /opt/rollandplay /opt/rollandplay/backend /opt/rollandplay/backend/releases /opt/rollandplay/frontend /opt/rollandplay/frontend/releases
install -d -m 750 -o rollandplay -g rollandplay /var/lib/rollandplay /var/lib/rollandplay/assets

# Database and backend environment (generated once).
install -d -m 755 /etc/rollandplay
env_file=/etc/rollandplay/backend.env
if [ ! -f "$env_file" ]; then
  db_password="$(openssl rand -hex 24)"
  salt="$(openssl rand -hex 32)"
  if ! runuser -u postgres -- psql -tAc "select 1 from pg_roles where rolname='rollandplay'" | grep -q 1; then
    runuser -u postgres -- psql -v ON_ERROR_STOP=1 -c "create role rollandplay login password '${db_password}'"
  else
    runuser -u postgres -- psql -v ON_ERROR_STOP=1 -c "alter role rollandplay password '${db_password}'"
  fi
  runuser -u postgres -- psql -tAc "select 1 from pg_database where datname='rollandplay'" | grep -q 1 ||
    runuser -u postgres -- createdb -O rollandplay rollandplay
  umask 077
  cat >"$env_file" <<EOF
HTTP_ADDR=127.0.0.1:8080
PUBLIC_BASE_URL=${PUBLIC_BASE_URL}
API_BASE_URL=${PUBLIC_BASE_URL}
DATABASE_URL=postgres://rollandplay:${db_password}@127.0.0.1:5432/rollandplay?sslmode=disable
REDIS_ADDR=127.0.0.1:6379
SESSION_COOKIE_NAME=rollandplay_session
SESSION_TTL_HOURS=720
MAGIC_LINK_TTL_MINUTES=15
# Required for login emails. Replace, then: systemctl restart rollandplay-backend
SMTP_ADDR=CHANGE_ME_smtp.provider.example:587
SMTP_FROM=Rollandplay <no-reply@CHANGE_ME.example>
SMTP_USERNAME=CHANGE_ME
SMTP_PASSWORD=CHANGE_ME
ASSET_STORAGE_DIR=/var/lib/rollandplay/assets
ROOM_PASSWORD_SALT=${salt}
LOG_LEVEL=info
LOG_FORMAT=json
EOF
  umask 022
fi
sed -i -E "s#^(PUBLIC_BASE_URL|API_BASE_URL)=.*#\1=${PUBLIC_BASE_URL}#" "$env_file"
chmod 600 "$env_file"

install -m 644 "$here/systemd/rollandplay-backend.service" /etc/systemd/system/rollandplay-backend.service
systemctl daemon-reload
systemctl enable rollandplay-backend

cat >/etc/sudoers.d/rollandplay-deploy <<'EOF'
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart rollandplay-backend
EOF
chmod 440 /etc/sudoers.d/rollandplay-deploy
visudo -cf /etc/sudoers.d/rollandplay-deploy

# TLS via certbot from snap: Ubuntu 22.04's apt certbot predates IP-address certificates.
# The snap ships snap.certbot.renew.timer; the deploy hook below is stored for renewals.
snap install --classic certbot
ln -sfn /snap/bin/certbot /usr/local/bin/certbot
install -d -m 755 /var/www/letsencrypt
rm -f /etc/nginx/sites-enabled/default
if [ ! -f /etc/letsencrypt/live/rollandplay/fullchain.pem ]; then
  # First run: the HTTPS site cannot load without a certificate, so serve only the ACME challenge.
  rm -f /etc/nginx/sites-enabled/rollandplay.conf
  cat >/etc/nginx/sites-enabled/rollandplay.conf <<'EOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    location /.well-known/acme-challenge/ { root /var/www/letsencrypt; }
}
EOF
  nginx -t
  systemctl reload nginx
fi
if [[ "$tls_host" =~ ^[0-9.]+$ || "$tls_host" == *:* ]]; then
  identifier=(--ip-address "$tls_host" --preferred-profile shortlived)
else
  identifier=(-d "$tls_host")
fi
if [ -n "${ACME_EMAIL:-}" ]; then account=(--email "$ACME_EMAIL"); else account=(--register-unsafely-without-email); fi
# No-op while the existing certificate already covers $tls_host and is not due for renewal.
certbot certonly --non-interactive --agree-tos "${account[@]}" --webroot -w /var/www/letsencrypt \
  --cert-name rollandplay "${identifier[@]}" --deploy-hook "systemctl reload nginx"

install -m 644 "$here/nginx/rollandplay.conf" /etc/nginx/sites-available/rollandplay.conf
ln -sfn /etc/nginx/sites-available/rollandplay.conf /etc/nginx/sites-enabled/rollandplay.conf
nginx -t
systemctl reload nginx
systemctl try-restart rollandplay-backend

echo "provisioned; edit SMTP_* in $env_file before users can log in"
