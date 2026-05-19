#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE="${HYDRA_HOME_REMOTE:-home}"
REMOTE_HOME="${HYDRA_HOME_BASE:-\$HOME/Desktop}"
REMOTE_DIR="${HYDRA_HOME_DIR:-$REMOTE_HOME/hydra}"
REMOTE_TARBALL="${HYDRA_HOME_TARBALL:-$REMOTE_HOME/hydra-src.tgz}"
REMOTE_PARTS="${HYDRA_HOME_PARTS:-$REMOTE_HOME/hydra-src-parts}"
REMOTE_BACKUP_ROOT="${HYDRA_HOME_BACKUP_ROOT:-$REMOTE_HOME/hydra-remote-backups}"
CHUNK_SIZE="${HYDRA_HOME_CHUNK_SIZE:-4m}"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/hydra-home-intel.XXXXXX")"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

echo "[home-intel] creating source snapshot"
tar -C "$ROOT" \
  --exclude './.git' \
  --exclude './node_modules' \
  --exclude './release' \
  --exclude './dist' \
  --exclude './build' \
  --exclude './data' \
  --exclude './videos' \
  --exclude './.env' \
  --exclude './.env.*' \
  --exclude './.playwright-mcp' \
  -czf "$WORK_DIR/hydra-src.tgz" .

tar -tzf "$WORK_DIR/hydra-src.tgz" >/dev/null

echo "[home-intel] splitting snapshot into $CHUNK_SIZE chunks"
mkdir -p "$WORK_DIR/parts"
split -b "$CHUNK_SIZE" "$WORK_DIR/hydra-src.tgz" "$WORK_DIR/parts/hydra-src.tgz.part-"

echo "[home-intel] preparing remote workspace on $REMOTE"
ssh -o ServerAliveInterval=10 -o ServerAliveCountMax=6 "$REMOTE" \
  "rm -rf '$REMOTE_PARTS' && mkdir -p '$REMOTE_PARTS' && rm -f '$REMOTE_TARBALL'"

for part in "$WORK_DIR"/parts/hydra-src.tgz.part-*; do
  name="$(basename "$part")"
  remote_part="$REMOTE_PARTS/$name"
  local_size="$(wc -c < "$part" | tr -d ' ')"
  remote_size="$(
    ssh -o ServerAliveInterval=10 -o ServerAliveCountMax=6 "$REMOTE" \
      "test -f '$remote_part' && wc -c < '$remote_part' || true" | tr -d '[:space:]'
  )"
  if [[ "$remote_size" == "$local_size" ]]; then
    echo "[home-intel] chunk already present: $name"
    continue
  fi
  echo "[home-intel] copying chunk: $name"
  scp -o ServerAliveInterval=10 -o ServerAliveCountMax=6 "$part" "$REMOTE:$remote_part"
done

echo "[home-intel] assembling source snapshot on $REMOTE"
ssh -o ServerAliveInterval=10 -o ServerAliveCountMax=6 "$REMOTE" \
  "cat '$REMOTE_PARTS'/hydra-src.tgz.part-* > '$REMOTE_TARBALL' && tar -tzf '$REMOTE_TARBALL' >/dev/null && mkdir -p '$REMOTE_BACKUP_ROOT' && if [ -e '$REMOTE_DIR' ]; then mv '$REMOTE_DIR' '$REMOTE_BACKUP_ROOT/hydra-$STAMP'; fi && mkdir -p '$REMOTE_DIR' && tar -xzf '$REMOTE_TARBALL' -C '$REMOTE_DIR'"

echo "[home-intel] building Intel macOS package on $REMOTE"
ssh -o ServerAliveInterval=10 -o ServerAliveCountMax=6 "$REMOTE" \
  "cd '$REMOTE_DIR' && npm ci && ELECTRON_CACHE=/tmp/hydra-electron-cache npm run electron:build:mac-x64 && HYDRA_BUILD_TARGET=darwin-x64 npm run electron:smoke && codesign --verify --deep --strict --verbose=2 release/mac/Hydra.app && test -f release/Hydra-1.0.0-mac-x64.zip && test -f release/Hydra-1.0.0-mac-x64.zip.blockmap"

echo "[home-intel] copying Intel artifacts back to local release/"
mkdir -p "$ROOT/release"
scp -o ServerAliveInterval=10 -o ServerAliveCountMax=6 \
  "$REMOTE:$REMOTE_DIR/release/Hydra-1.0.0-mac-x64.zip" \
  "$REMOTE:$REMOTE_DIR/release/Hydra-1.0.0-mac-x64.zip.blockmap" \
  "$ROOT/release/"

echo "[home-intel] done: local release/Hydra-1.0.0-mac-x64.zip"
