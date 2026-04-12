#!/bin/bash
# docker-build.sh — build and optionally push the Hydra Docker image
# Usage:
#   ./scripts/docker-build.sh                  # local build only
#   ./scripts/docker-build.sh --push           # build + push to ghcr.io
#   ./scripts/docker-build.sh --push v1.2.0    # build + push with version tag

set -e

IMAGE="ghcr.io/zaydiscold/hydra"
SHORT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
TAG_LATEST="${IMAGE}:latest"
TAG_SHA="${IMAGE}:sha-${SHORT_SHA}"

PUSH=0
VERSION_TAG=""

for arg in "$@"; do
  if [ "$arg" = "--push" ]; then
    PUSH=1
  elif [[ "$arg" =~ ^v[0-9]+\.[0-9]+\.[0-9]+ ]]; then
    VERSION_TAG="${IMAGE}:${arg}"
  fi
done

echo "[docker-build] Building image: ${TAG_LATEST} (${SHORT_SHA})"

BUILD_ARGS=(
  "--tag" "${TAG_LATEST}"
  "--tag" "${TAG_SHA}"
)

if [ -n "${VERSION_TAG}" ]; then
  BUILD_ARGS+=("--tag" "${VERSION_TAG}")
  echo "[docker-build] Extra tag: ${VERSION_TAG}"
fi

if [ "${PUSH}" = "1" ]; then
  BUILD_ARGS+=("--push")
  echo "[docker-build] Will push to ghcr.io"
else
  BUILD_ARGS+=("--load")
fi

docker buildx build "${BUILD_ARGS[@]}" .

echo "[docker-build] Done. Image: ${TAG_LATEST}"
if [ "${PUSH}" = "1" ]; then
  echo "[docker-build] Pushed: ${TAG_LATEST}"
  echo "[docker-build] Pushed: ${TAG_SHA}"
  [ -n "${VERSION_TAG}" ] && echo "[docker-build] Pushed: ${VERSION_TAG}"
fi
