#!/usr/bin/env bash
# Copy one OCI archive to a registry. Does not build and does not tag a rebuild.
set -euo pipefail

archive=""
destination=""
expected=""
scheme="https"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --archive)
      archive=$2
      shift 2
      ;;
    --destination)
      destination=$2
      shift 2
      ;;
    --expected)
      expected=$2
      shift 2
      ;;
    --scheme)
      scheme=$2
      shift 2
      ;;
    *)
      echo "sequence stopped: unknown argument" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$archive" || -z "$destination" || -z "$expected" ]]; then
  echo "sequence stopped: archive, destination, and expected digest are required" >&2
  exit 1
fi
if [[ ! -f "$archive" ]]; then
  echo "sequence stopped: OCI archive is missing" >&2
  exit 1
fi
if ! command -v skopeo >/dev/null 2>&1; then
  echo "sequence stopped: skopeo is required and this script does not build an image" >&2
  exit 1
fi

tls=()
if [[ "$scheme" == "http" ]]; then
  tls=(--dest-tls-verify=false)
fi
skopeo copy --all "${tls[@]}" "oci-archive:${archive}" "docker://${destination}"

host=${destination%%/*}
rest=${destination#*/}
name=${rest%%:*}
tag=${rest##*:}
headers=$(mktemp)
code=$(curl -sS -D "$headers" -o /dev/null -w '%{http_code}' \
  -H "Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json" \
  "${scheme}://${host}/v2/${name}/manifests/${tag}" || true)
got=$(awk 'tolower($1)=="docker-content-digest:" { print $2 }' "$headers" | tr -d '\r')
rm -f "$headers"
if [[ "$code" != "200" || -z "$got" ]]; then
  echo "sequence stopped: registry digest ${got:-missing} HTTP ${code} != recorded ${expected}" >&2
  exit 1
fi
if [[ "$got" != "$expected" ]]; then
  echo "sequence stopped: registry digest ${got:-missing} != recorded ${expected}" >&2
  exit 1
fi
echo "digest unchanged ${got}"
