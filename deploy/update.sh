#!/usr/bin/env bash
set -euo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
umask 022
base=/opt/hot-doogy
repo=/var/lib/hot-doogy/repository.git
exec 9>/run/lock/hot-doogy-update.lock
flock -n 9 || exit 0
export GIT_SSH_COMMAND='ssh -i /etc/hot-doogy/github_deploy_key -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/etc/hot-doogy/github_known_hosts -o ConnectTimeout=15'

if [[ ! -d "$repo" ]]; then
  git init --bare "$repo"
  git --git-dir="$repo" remote add origin git@github.com:leossoliveira/hot-doogy-operations.git
fi
git --git-dir="$repo" fetch --prune origin '+refs/heads/main:refs/remotes/origin/main' 'refs/tags/v0.1.*:refs/tags/v0.1.*'
version=$(git --git-dir="$repo" tag --list 'v0.1.*' --sort=-version:refname | awk '/^v0\.1\.[0-9]+$/ {if (!found++) print}')
[[ -n "$version" ]] || { echo 'No validated version available.'; exit 1; }
sha=$(git --git-dir="$repo" rev-parse "$version^{commit}")
git --git-dir="$repo" merge-base --is-ancestor "$sha" refs/remotes/origin/main
target="$base/releases/$sha"
previous=$(readlink -f "$base/current" || true)
previous_version=''
previous_sha=''
if [[ -n "$previous" ]]; then
  read -r previous_version previous_sha < "$base/deployed-version"
  [[ "$previous_version" =~ ^v0\.1\.[0-9]+$ && "$previous_sha" =~ ^[0-9a-f]{40}$ && "$previous" == "$base/releases/$previous_sha" ]] || {
    echo 'Previous release identity is inconsistent; refusing deployment.' >&2; exit 1;
  }
fi
if [[ "$previous" == "$target" ]]; then
  systemctl is-active --quiet hot-doogy
  echo "Already running $version ($sha)"
  exit 0
fi

stage=$(mktemp -d "$base/releases/.prepare-XXXXXXXX")
trap 'rm -rf -- "$stage"' EXIT
git --git-dir="$repo" archive "$sha" | tar -x -C "$stage"
chmod 755 "$stage"
# Repository checks run without root privileges.
chown -R hotdoogy:hotdoogy "$stage"
runuser -u hotdoogy -- env -i PATH="$PATH" HOME=/nonexistent \
  /bin/sh -c 'cd "$1" && npm run check && npm run test:ci' sh "$stage"
chown -R root:root "$stage"
chmod -R a-w "$stage"
# The database and migration history commit together before switching application code.
# No DB credentials are available to the application or the unprivileged test process.
/usr/bin/node "$stage/scripts/deploy-database.mjs" prepare "$version" "$sha"
if [[ ! -d "$target" ]]; then mv "$stage" "$target"; fi
ln -sfn "$target" "$base/current.next"
mv -Tf "$base/current.next" "$base/current"
healthy() {
  for attempt in {1..20}; do
    if systemctl is-active --quiet hot-doogy && \
      curl --fail --silent --max-time 3 http://127.0.0.1:4173/ -o /dev/null && \
      [[ "$(curl --silent --max-time 3 -o /dev/null -w '%{http_code}' http://127.0.0.1:4173/api/auth/session)" == 401 ]]; then
      return 0
    fi
    sleep 1
  done
  return 1
}
if systemctl restart hot-doogy && healthy && \
  /usr/bin/node "$target/scripts/deploy-database.mjs" activate "$version" "$sha"; then
  printf '%s %s\n' "$version" "$sha" > "$base/deployed-version"
  echo "Deployed $version ($sha)"
else
  echo 'Health check failed; reverting application.' >&2
  if [[ -n "$previous" && -d "$previous" ]]; then
    ln -sfn "$previous" "$base/current.rollback"
    mv -Tf "$base/current.rollback" "$base/current"
    if systemctl restart hot-doogy && healthy; then
      /usr/bin/node "$target/scripts/deploy-database.mjs" rollback "$version" "$sha" "$previous_version" "$previous_sha"
    else
      /usr/bin/node "$target/scripts/deploy-database.mjs" failed "$version" "$sha"
    fi
  else
    systemctl stop hot-doogy
    rm -f "$base/current"
    /usr/bin/node "$target/scripts/deploy-database.mjs" failed "$version" "$sha"
  fi
  exit 1
fi
