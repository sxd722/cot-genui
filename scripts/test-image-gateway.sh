#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

QUERY="${1:-Hangzhou West Lake traditional architecture wide photography}"
OUTPUT_FILE="${2:-}"
LIMIT="${IMAGE_TEST_LIMIT:-3}"
MODE="${IMAGE_TEST_MODE:-auto}"
GATEWAY_HOST="${IMAGE_GATEWAY_HOST:-127.0.0.1}"
CONNECT_HOST="${IMAGE_GATEWAY_CONNECT_HOST:-127.0.0.1}"
GATEWAY_PORT="${IMAGE_GATEWAY_PORT:-4010}"
GATEWAY_KEY="${IMAGE_GATEWAY_API_KEY:-local-dev}"
REQUEST_TIMEOUT="${IMAGE_TEST_REQUEST_TIMEOUT_SECONDS:-20}"
BASE_URL="http://${CONNECT_HOST}:${GATEWAY_PORT}"

for command in curl python3; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Missing required command: $command" >&2
    exit 1
  fi
done

if ! [[ "$LIMIT" =~ ^[1-6]$ ]]; then
  echo "IMAGE_TEST_LIMIT must be an integer from 1 to 6" >&2
  exit 1
fi
if [[ "$MODE" != "auto" && "$MODE" != "gateway" && "$MODE" != "openverse" ]]; then
  echo "IMAGE_TEST_MODE must be auto, gateway, or openverse" >&2
  exit 1
fi

gateway_pid=""
gateway_log="$(mktemp -t cot-genui-image-gateway.XXXXXX.log)"
headers_file="$(mktemp -t cot-genui-image-headers.XXXXXX)"
response_file="$(mktemp -t cot-genui-image-response.XXXXXX.json)"

cleanup() {
  if [[ -n "$gateway_pid" ]] && kill -0 "$gateway_pid" 2>/dev/null; then
    kill "$gateway_pid" 2>/dev/null || true
    wait "$gateway_pid" 2>/dev/null || true
  fi
  rm -f -- "$gateway_log" "$headers_file" "$response_file"
}
trap cleanup EXIT INT TERM

node_bin=""
if command -v node >/dev/null 2>&1; then
  node_bin="node"
elif command -v node.exe >/dev/null 2>&1; then
  node_bin="node.exe"
fi

use_gateway=false
if [[ "$MODE" != "openverse" ]] && curl --silent --fail --max-time 2 "$BASE_URL/health" >/dev/null 2>&1; then
  use_gateway=true
  echo "Mode: existing Image Gateway at $BASE_URL"
elif [[ "$MODE" != "openverse" && -n "$node_bin" ]]; then
  echo "Mode: start Openverse Image Gateway at $BASE_URL"
  IMAGE_GATEWAY_HOST="$GATEWAY_HOST" \
  IMAGE_GATEWAY_PORT="$GATEWAY_PORT" \
  IMAGE_GATEWAY_API_KEY="$GATEWAY_KEY" \
  IMAGE_GATEWAY_PROVIDERS="openverse" \
    "$node_bin" --env-file-if-exists=.env.local --import tsx services/image-gateway/server.ts >"$gateway_log" 2>&1 &
  gateway_pid=$!

  for _ in {1..30}; do
    if curl --silent --fail --max-time 2 "$BASE_URL/health" >/dev/null 2>&1; then
      use_gateway=true
      break
    fi
    if ! kill -0 "$gateway_pid" 2>/dev/null; then
      echo "Image Gateway exited during startup:" >&2
      sed -n '1,120p' "$gateway_log" >&2
      exit 1
    fi
    sleep 0.5
  done

  if [[ "$use_gateway" != true ]]; then
    echo "Image Gateway did not become healthy:" >&2
    sed -n '1,120p' "$gateway_log" >&2
    exit 1
  fi
elif [[ "$MODE" == "gateway" ]]; then
  echo "Gateway mode requires Linux Node.js or an already running Gateway." >&2
  echo "Install Node.js in WSL, then rerun this script." >&2
  exit 1
else
  echo "Mode: direct Openverse API (Linux Node.js is not installed in WSL)"
fi

echo "Searching: $QUERY"

if [[ "$use_gateway" == true ]]; then
  payload="$(python3 -c 'import json,sys; print(json.dumps({"query":sys.argv[1],"limit":int(sys.argv[2])},ensure_ascii=False))' "$QUERY" "$LIMIT")"
  if ! http_status="$(curl \
      --silent \
      --show-error \
      --max-time "$REQUEST_TIMEOUT" \
      --dump-header "$headers_file" \
      --output "$response_file" \
      --write-out '%{http_code}' \
      --request POST \
      --header 'Content-Type: application/json' \
      --header "Authorization: Bearer $GATEWAY_KEY" \
      --data "$payload" \
      "$BASE_URL/v1/search")"; then
    echo "Gateway request failed or timed out." >&2
    [[ -n "$gateway_pid" ]] && sed -n '1,120p' "$gateway_log" >&2
    exit 1
  fi
  provider="$(awk -F': ' 'tolower($1) == "x-image-provider" {gsub("\r", "", $2); print $2}' "$headers_file" | tail -n 1)"
  attempts="$(awk -F': ' 'tolower($1) == "x-image-provider-attempts" {gsub("\r", "", $2); print $2}' "$headers_file" | tail -n 1)"
else
  query_string="$(python3 -c 'import sys,urllib.parse; print(urllib.parse.urlencode({"q":sys.argv[1],"page_size":sys.argv[2]}))' "$QUERY" "$LIMIT")"
  if ! http_status="$(curl \
      --silent \
      --show-error \
      --max-time "$REQUEST_TIMEOUT" \
      --dump-header "$headers_file" \
      --output "$response_file" \
      --write-out '%{http_code}' \
      --header 'Accept: application/json' \
      "https://api.openverse.org/v1/images/?$query_string")"; then
    echo "Direct Openverse request failed or timed out." >&2
    exit 1
  fi
  provider="openverse-direct"
  attempts="openverse,direct"
  if [[ "$http_status" == "200" ]]; then
    python3 - "$response_file" <<'PY'
import json, sys
path = sys.argv[1]
with open(path, "r", encoding="utf-8") as source:
    data = json.load(source)
results = []
for item in data.get("results", []):
    if not item.get("url"):
        continue
    result = {
        "imageUrl": item["url"],
        "sourceUrl": item.get("foreign_landing_url"),
        "alt": (item.get("title") or "").strip() or None,
        "creator": item.get("creator"),
        "creatorUrl": item.get("creator_url"),
        "license": " ".join(filter(None, [item.get("license"), item.get("license_version")])) or None,
        "licenseUrl": item.get("license_url"),
    }
    results.append({key: value for key, value in result.items() if value})
    if len(results) >= 6:
        break
with open(path, "w", encoding="utf-8") as target:
    json.dump({"schemaVersion": "1", "results": results}, target, ensure_ascii=False)
PY
  fi
fi

echo "HTTP: $http_status"
echo "Provider: ${provider:-unknown}"
echo "Attempts: ${attempts:-unknown}"

if [[ "$http_status" != "200" ]]; then
  echo "Provider response:" >&2
  sed -n '1,120p' "$response_file" >&2
  exit 1
fi

parse_status=0
python3 - "$response_file" <<'PY' || parse_status=$?
import json, sys
with open(sys.argv[1], "r", encoding="utf-8") as source:
    data = json.load(source)
results = data.get("results", []) if isinstance(data.get("results", []), list) else []
print(f"Candidates: {len(results)}")
for index, item in enumerate(results, 1):
    print(f"\n[{index}] {item.get('alt') or 'Untitled'}")
    print(f"URL: {item.get('imageUrl', '')}")
    if item.get("creator"):
        print(f"Creator: {item['creator']}")
    if item.get("license"):
        print(f"License: {item['license']}")
    if item.get("sourceUrl"):
        print(f"Source: {item['sourceUrl']}")
if not results:
    sys.exit(2)
PY

if [[ "$parse_status" -eq 2 ]]; then
  echo "No image candidates. Try a shorter English visual query or inspect Attempts above." >&2
  [[ -n "$gateway_pid" ]] && sed -n '1,120p' "$gateway_log" >&2
  exit 2
elif [[ "$parse_status" -ne 0 ]]; then
  echo "Could not parse provider response." >&2
  exit "$parse_status"
fi

if [[ -n "$OUTPUT_FILE" ]]; then
  first_url="$(python3 -c 'import json,sys; data=json.load(open(sys.argv[1],encoding="utf-8")); print(data.get("results",[{}])[0].get("imageUrl",""))' "$response_file")"
  if [[ -z "$first_url" ]]; then
    echo "Cannot download because the first candidate has no imageUrl" >&2
    exit 2
  fi
  mkdir -p -- "$(dirname -- "$OUTPUT_FILE")"
  echo "Downloading first candidate to: $OUTPUT_FILE"
  curl \
    --fail \
    --location \
    --max-redirs 3 \
    --max-time 30 \
    --output "$OUTPUT_FILE" \
    "$first_url"
  echo "Saved: $(cd -- "$(dirname -- "$OUTPUT_FILE")" && pwd)/$(basename -- "$OUTPUT_FILE")"
fi
