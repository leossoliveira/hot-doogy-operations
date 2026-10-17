#!/usr/bin/env bash
# Run on the VPS from a clone of this repository, after preparing credentials.
set -euo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
[[ $EUID -eq 0 ]] || { echo 'Run as root on the VPS.' >&2; exit 1; }
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
for command in node npm git curl flock runuser ssh systemctl psql; do command -v "$command" >/dev/null; done
node -e 'if(Number(process.versions.node.split(".")[0])<24)process.exit(1)'
for file in github_deploy_key supabase-s3.env database-deploy.json database-deploy.pgpass; do
  [[ -s "/etc/hot-doogy/$file" ]] || { echo "Prepare /etc/hot-doogy/$file first; see deploy/README.md." >&2; exit 1; }
done
getent passwd hotdoogy >/dev/null || useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin hotdoogy
install -d -m 755 /opt/hot-doogy/releases /var/lib/hot-doogy
install -d -m 750 -o root -g hotdoogy /etc/hot-doogy
chown root:root /etc/hot-doogy/github_deploy_key
chmod 600 /etc/hot-doogy/github_deploy_key
chown root:root /etc/hot-doogy/database-deploy.json /etc/hot-doogy/database-deploy.pgpass
chmod 600 /etc/hot-doogy/database-deploy.json /etc/hot-doogy/database-deploy.pgpass
chown root:hotdoogy /etc/hot-doogy/supabase-s3.env
chmod 640 /etc/hot-doogy/supabase-s3.env
# GitHub's published Ed25519 host key; do not disable host verification.
printf '%s\n' 'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl' > /etc/hot-doogy/github_known_hosts
chmod 600 /etc/hot-doogy/github_known_hosts
install -m 644 "$source_dir"/*.service "$source_dir"/*.timer /etc/systemd/system/
install -m 755 "$source_dir/update.sh" /usr/local/sbin/hot-doogy-update
systemd-analyze verify /etc/systemd/system/hot-doogy.service /etc/systemd/system/hot-doogy-update.service /etc/systemd/system/hot-doogy-update.timer
systemctl daemon-reload
systemctl enable hot-doogy
systemctl start hot-doogy-update
systemctl enable --now hot-doogy-update.timer
systemctl is-active hot-doogy hot-doogy-update.timer
cat /opt/hot-doogy/deployed-version
