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
accept="application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json"
index=$(mktemp)
tar -xOf "$archive" index.json >"$index"
media_type=$(node --input-type=module -e "import {readFileSync} from 'node:fs'; const doc = JSON.parse(readFileSync(process.argv[1], 'utf8')); process.stdout.write(doc.mediaType || 'application/vnd.oci.image.index.v1+json')" "$index")
auth=()
for candidate in "${XDG_RUNTIME_DIR:-}/containers/auth.json" "$HOME/.config/containers/auth.json"; do
  if [[ -f "$candidate" ]]; then
    basic=$(node --input-type=module -e "import {readFileSync} from 'node:fs'; const doc = JSON.parse(readFileSync(process.argv[1], 'utf8')); const auths = doc.auths ?? {}; const entry = auths[process.argv[2]] ?? auths['https://' + process.argv[2]] ?? {}; process.stdout.write(entry.auth ?? '')" "$candidate" "$host")
    if [[ -n "$basic" ]]; then
      auth=(-H "Authorization: Basic $basic")
    fi
    break
  fi
done
put_headers=$(mktemp)
put_body=$(mktemp)
put_code=$(curl -sS -D "$put_headers" -o "$put_body" -w '%{http_code}' \
  -X PUT \
  "${auth[@]}" \
  -H "Content-Type: ${media_type}" \
  --data-binary @"$index" \
  "${scheme}://${host}/v2/${name}/manifests/${tag}" || true)
echo "index put HTTP ${put_code}"
if [[ "$put_code" != "200" && "$put_code" != "201" ]]; then
  echo "index put body: $(cat "$put_body")" >&2
fi
headers=$(mktemp)
body=$(mktemp)
code=$(curl -sS -D "$headers" -o "$body" -w '%{http_code}' \
  "${auth[@]}" \
  -H "Accept: ${accept}" \
  "${scheme}://${host}/v2/${name}/manifests/${tag}" || true)
got=$(awk 'tolower($1)=="docker-content-digest:" { print $2 }' "$headers" | tr -d '\r')
rm -f "$headers" "$put_headers" "$put_body" "$body" "$index"
if [[ "$code" != "200" || -z "$got" ]]; then
  echo "sequence stopped: registry digest ${got:-missing} HTTP ${code} != recorded ${expected}" >&2
  exit 1
fi
if [[ "$got" != "$expected" ]]; then
  echo "sequence stopped: registry digest ${got} != recorded ${expected}" >&2
  exit 1
fi
echo "digest unchanged ${got}"
