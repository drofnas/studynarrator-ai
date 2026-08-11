#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

readonly DEFAULT_MODEL_ID="speaches-ai/Kokoro-82M-v1.0-ONNX"
readonly DEFAULT_VOICE_ID="af_heart"
readonly CONNECT_TIMEOUT_SECONDS="10"
readonly REQUEST_TIMEOUT_SECONDS="180"

die() {
  printf 'GATE G00: ERROR: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage:
  SPEACHES_BASE_URL=https://speaches.example.test \
    bash scripts/gates/g00-speaches-baseline.sh

  SPEACHES_BASE_URL=https://speaches.example.test \
    bash scripts/gates/g00-speaches-baseline.sh --expect-unavailable

Environment:
  SPEACHES_BASE_URL       Required. A server root URL or URL ending in /v1.
  SPEACHES_API_KEY        Optional. Sent as a bearer token without logging it.
  SPEACHES_MODEL_ID       Optional. Defaults to the G00 Kokoro model.
  SPEACHES_DEFAULT_VOICE  Optional. Defaults to af_heart.

The normal mode performs two WAV requests and two MP3 requests. Generated files
and machine-readable evidence are written under .tmp/gates/G00/ and are ignored
by Git. The unavailable mode succeeds only for a network failure or HTTP 5xx.
EOF
}

mode="run"
case "${1:-}" in
  "") ;;
  --expect-unavailable) mode="expect-unavailable" ;;
  --help|-h) usage; exit 0 ;;
  *) usage >&2; die "unknown argument: $1" ;;
esac
if (( $# > 1 )); then
  usage >&2
  die "too many arguments"
fi

for command_name in curl jq; do
  command -v "$command_name" >/dev/null 2>&1 || die "required command not found: $command_name"
done

if [[ "$mode" == "run" ]]; then
  for command_name in ffmpeg ffprobe file shasum; do
    command -v "$command_name" >/dev/null 2>&1 || die "required command not found: $command_name"
  done
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd -- "$script_dir/../.." && pwd -P)"
fixture_path="$repo_root/fixtures/baseline/speaches-smoke.txt"
output_root="$repo_root/.tmp/gates/G00"

[[ -f "$fixture_path" ]] || die "smoke fixture not found: $fixture_path"
[[ -n "${SPEACHES_BASE_URL:-}" ]] || die "SPEACHES_BASE_URL is required"
if [[ "$SPEACHES_BASE_URL" == *$'\n'* || "$SPEACHES_BASE_URL" == *$'\r'* ]]; then
  die "SPEACHES_BASE_URL must not contain newlines"
fi

case "$SPEACHES_BASE_URL" in
  http://*|https://*) ;;
  *) die "SPEACHES_BASE_URL must use http:// or https://" ;;
esac
if [[ "$SPEACHES_BASE_URL" == *'?'* || "$SPEACHES_BASE_URL" == *'#'* ]]; then
  die "SPEACHES_BASE_URL must not contain a query string or fragment"
fi

url_authority="${SPEACHES_BASE_URL#*://}"
url_authority="${url_authority%%/*}"
if [[ "$url_authority" == *'@'* ]]; then
  die "SPEACHES_BASE_URL must not contain embedded credentials; use SPEACHES_API_KEY"
fi

normalized_base="$SPEACHES_BASE_URL"
while [[ "$normalized_base" == */ ]]; do
  normalized_base="${normalized_base%/}"
done
[[ -n "$normalized_base" ]] || die "SPEACHES_BASE_URL is invalid"

if [[ "$normalized_base" == */v1 ]]; then
  api_base="$normalized_base"
  root_base="${normalized_base%/v1}"
  supplied_url_form="v1"
else
  api_base="$normalized_base/v1"
  root_base="$normalized_base"
  supplied_url_form="root"
fi

speech_endpoint="$api_base/audio/speech"
model_id="${SPEACHES_MODEL_ID:-$DEFAULT_MODEL_ID}"
voice_id="${SPEACHES_DEFAULT_VOICE:-$DEFAULT_VOICE_ID}"
smoke_text="$(<"$fixture_path")"

[[ -n "$model_id" ]] || die "SPEACHES_MODEL_ID must not be empty"
[[ -n "$voice_id" ]] || die "SPEACHES_DEFAULT_VOICE must not be empty"
[[ -n "$smoke_text" ]] || die "smoke fixture must not be empty"

mkdir -p -- "$output_root"

auth_header_file=""
declare -a curl_auth_args=()
cleanup_auth_header() {
  if [[ -n "$auth_header_file" && -f "$auth_header_file" && ! -L "$auth_header_file" ]]; then
    : > "$auth_header_file"
    rm -f -- "$auth_header_file"
  fi
}
trap cleanup_auth_header EXIT INT TERM

auth_header_sent=false
if [[ -n "${SPEACHES_API_KEY:-}" ]]; then
  if [[ "$SPEACHES_API_KEY" == *$'\n'* || "$SPEACHES_API_KEY" == *$'\r'* ]]; then
    die "SPEACHES_API_KEY must not contain newlines"
  fi
  auth_header_file="$(mktemp "$output_root/.auth-header.XXXXXX")"
  chmod 600 "$auth_header_file"
  printf 'Authorization: Bearer %s\n' "$SPEACHES_API_KEY" > "$auth_header_file"
  curl_auth_args=(--header "@$auth_header_file")
  auth_header_sent=true
fi

sanitize_headers() {
  local input_path="$1"
  local output_path="$2"
  awk '
    {
      lower = tolower($0)
      if (lower ~ /^http\// ||
          lower ~ /^content-type:/ ||
          lower ~ /^content-length:/ ||
          lower ~ /^date:/) {
        sub(/\r$/, "")
        print
      }
    }
  ' "$input_path" > "$output_path"
}

classify_curl_exit() {
  case "$1" in
    0) printf 'none' ;;
    6) printf 'dns-resolution-failure' ;;
    7) printf 'connection-failure' ;;
    22) printf 'http-error' ;;
    28) printf 'timeout' ;;
    35|51|53|58|59|60|66|77|80|82|83|90|91) printf 'tls-or-certificate-failure' ;;
    52) printf 'empty-server-response' ;;
    55|56) printf 'network-transfer-failure' ;;
    *) printf 'curl-exit-%s' "$1" ;;
  esac
}

write_request_payload() {
  local format="$1"
  local destination="$2"
  jq -n \
    --arg input "$smoke_text" \
    --arg model "$model_id" \
    --arg voice "$voice_id" \
    --arg response_format "$format" \
    '{input: $input, model: $model, voice: $voice, response_format: $response_format, speed: 1}' \
    > "$destination"
}

probe_optional_get() {
  local name="$1"
  local endpoint_path="$2"
  local endpoint_url="$3"
  local probe_dir="$output_root/preflight"
  local raw_headers="$probe_dir/$name.headers.raw"
  local safe_headers="$probe_dir/$name.headers.txt"
  local body="$probe_dir/$name.body"
  local stderr_path="$probe_dir/$name.stderr.raw"
  local result_path="$probe_dir/$name.json"
  local http_status
  local curl_exit
  local supported=false
  local model_present_json="null"

  mkdir -p -- "$probe_dir"
  : > "$raw_headers"
  : > "$stderr_path"
  set +e
  http_status="$(curl \
    --silent --show-error \
    --connect-timeout "$CONNECT_TIMEOUT_SECONDS" \
    --max-time "$REQUEST_TIMEOUT_SECONDS" \
    --dump-header "$raw_headers" \
    --output "$body" \
    --write-out '%{http_code}' \
    "${curl_auth_args[@]}" \
    "$endpoint_url" 2>"$stderr_path")"
  curl_exit=$?
  set -e

  sanitize_headers "$raw_headers" "$safe_headers"
  rm -f -- "$raw_headers" "$stderr_path"

  if [[ "$curl_exit" -eq 0 && "$http_status" =~ ^2[0-9][0-9]$ ]]; then
    supported=true
    if [[ "$name" == "models" ]] && jq -e . "$body" >/dev/null 2>&1; then
      model_present_json="$(jq --arg model "$model_id" '([.data[]?.id] | index($model)) != null' "$body")"
    fi
  fi

  jq -n \
    --arg endpoint "$endpoint_path" \
    --argjson curl_exit "$curl_exit" \
    --arg http_status "$http_status" \
    --argjson supported "$supported" \
    --argjson model_present "$model_present_json" \
    '{endpoint: $endpoint, curl_exit: $curl_exit, http_status: $http_status, supported: $supported, model_present: $model_present}' \
    > "$result_path"

  rm -f -- "$body"
}

perform_success_request() {
  local run_number="$1"
  local format="$2"
  local run_dir="$output_root/run-$run_number"
  local payload="$run_dir/request-$format.json"
  local audio="$run_dir/speaches-baseline.$format"
  local raw_headers="$run_dir/$format.headers.raw"
  local safe_headers="$run_dir/$format.headers.txt"
  local stderr_path="$run_dir/$format.stderr.raw"
  local ffprobe_path="$run_dir/$format.ffprobe.json"
  local summary_path="$run_dir/$format.summary.json"
  local http_status
  local curl_exit
  local content_type
  local media_description
  local sha256
  local byte_size

  mkdir -p -- "$run_dir"
  write_request_payload "$format" "$payload"
  : > "$raw_headers"
  : > "$stderr_path"

  set +e
  http_status="$(curl \
    --silent --show-error --fail-with-body \
    --request POST \
    --connect-timeout "$CONNECT_TIMEOUT_SECONDS" \
    --max-time "$REQUEST_TIMEOUT_SECONDS" \
    --header 'Content-Type: application/json' \
    "${curl_auth_args[@]}" \
    --data-binary "@$payload" \
    --dump-header "$raw_headers" \
    --output "$audio" \
    --write-out '%{http_code}' \
    "$speech_endpoint" 2>"$stderr_path")"
  curl_exit=$?
  set -e

  sanitize_headers "$raw_headers" "$safe_headers"
  rm -f -- "$raw_headers" "$stderr_path"

  if [[ "$curl_exit" -ne 0 || ! "$http_status" =~ ^2[0-9][0-9]$ ]]; then
    rm -f -- "$audio"
    die "run $run_number $format request failed ($(classify_curl_exit "$curl_exit"), HTTP $http_status)"
  fi
  [[ -s "$audio" ]] || die "run $run_number $format response was empty"

  media_description="$(file --brief -- "$audio")"
  ffmpeg -v error -i "$audio" -f null -
  ffprobe \
    -v error \
    -select_streams a:0 \
    -show_entries 'stream=index,codec_name,codec_type,sample_rate,channels:format=format_name,duration,size' \
    -of json \
    "$audio" > "$ffprobe_path"

  jq -e '
    (.streams | length) >= 1 and
    .streams[0].codec_type == "audio" and
    ((.format.duration | tonumber) > 0)
  ' "$ffprobe_path" >/dev/null || die "run $run_number $format failed FFprobe audio validation"

  if [[ "$format" == "wav" ]]; then
    jq -e '.format.format_name | contains("wav")' "$ffprobe_path" >/dev/null || die "run $run_number did not return a WAV container"
  else
    jq -e '.format.format_name | contains("mp3")' "$ffprobe_path" >/dev/null || die "run $run_number did not return an MP3 container"
  fi

  content_type="$(awk 'tolower($0) ~ /^content-type:/ {sub(/^[^:]*:[[:space:]]*/, ""); print}' "$safe_headers" | tail -n 1)"
  sha256="$(shasum -a 256 "$audio" | awk '{print $1}')"
  byte_size="$(wc -c < "$audio" | tr -d '[:space:]')"

  jq -n \
    --argjson run "$run_number" \
    --arg format "$format" \
    --arg endpoint "/v1/audio/speech" \
    --arg model "$model_id" \
    --arg voice "$voice_id" \
    --arg http_status "$http_status" \
    --arg content_type "$content_type" \
    --arg media_description "$media_description" \
    --arg artifact ".tmp/gates/G00/run-$run_number/speaches-baseline.$format" \
    --arg sha256 "$sha256" \
    --argjson byte_size "$byte_size" \
    --argjson authorization_header_sent "$auth_header_sent" \
    '{run: $run, format: $format, endpoint: $endpoint, model: $model, voice: $voice, http_status: $http_status, content_type: $content_type, media_description: $media_description, artifact: $artifact, sha256: $sha256, byte_size: $byte_size, authorization_header_sent: $authorization_header_sent, passed: true}' \
    > "$summary_path"

  printf 'PASS run=%s format=%s bytes=%s sha256=%s\n' "$run_number" "$format" "$byte_size" "$sha256"
}

perform_expected_failure() {
  local failure_dir="$output_root/failure"
  local payload="$failure_dir/request-mp3.json"
  local body="$failure_dir/response.body"
  local raw_headers="$failure_dir/response.headers.raw"
  local safe_headers="$failure_dir/response.headers.txt"
  local stderr_path="$failure_dir/response.stderr.raw"
  local result_path="$failure_dir/failure.json"
  local http_status
  local curl_exit
  local failure_class

  mkdir -p -- "$failure_dir"
  write_request_payload "mp3" "$payload"
  : > "$raw_headers"
  : > "$stderr_path"

  set +e
  http_status="$(curl \
    --silent --show-error --fail-with-body \
    --request POST \
    --connect-timeout "$CONNECT_TIMEOUT_SECONDS" \
    --max-time "$REQUEST_TIMEOUT_SECONDS" \
    --header 'Content-Type: application/json' \
    "${curl_auth_args[@]}" \
    --data-binary "@$payload" \
    --dump-header "$raw_headers" \
    --output "$body" \
    --write-out '%{http_code}' \
    "$speech_endpoint" 2>"$stderr_path")"
  curl_exit=$?
  set -e

  sanitize_headers "$raw_headers" "$safe_headers"
  rm -f -- "$raw_headers" "$stderr_path" "$body"
  failure_class="$(classify_curl_exit "$curl_exit")"

  if [[ "$curl_exit" -eq 0 && "$http_status" =~ ^2[0-9][0-9]$ ]]; then
    die "server unexpectedly succeeded during unavailable-server validation"
  fi
  if [[ "$curl_exit" -eq 0 ]]; then
    die "HTTP $http_status is not an unavailable-server result"
  fi
  if [[ "$curl_exit" -eq 22 && ! "$http_status" =~ ^5[0-9][0-9]$ ]]; then
    die "HTTP $http_status is not a server-unavailable response"
  fi

  jq -n \
    --arg endpoint "/v1/audio/speech" \
    --arg failure_class "$failure_class" \
    --argjson curl_exit "$curl_exit" \
    --arg http_status "$http_status" \
    --argjson authorization_header_sent "$auth_header_sent" \
    --arg captured_at "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" \
    '{endpoint: $endpoint, failure_class: $failure_class, curl_exit: $curl_exit, http_status: $http_status, authorization_header_sent: $authorization_header_sent, captured_at: $captured_at, expected_failure_captured: true}' \
    > "$result_path"

  printf 'GATE G00: EXPECTED UNAVAILABLE FAILURE CAPTURED\n'
  printf 'Evidence: .tmp/gates/G00/failure/failure.json\n'
}

if [[ "$mode" == "expect-unavailable" ]]; then
  perform_expected_failure
  exit 0
fi

probe_optional_get "health" "/health" "$root_base/health"
probe_optional_get "models" "/v1/models" "$api_base/models"

for run_number in 1 2; do
  perform_success_request "$run_number" "wav"
  perform_success_request "$run_number" "mp3"
done

results_path="$output_root/results.json"
jq -s '.' \
  "$output_root/run-1/wav.summary.json" \
  "$output_root/run-1/mp3.summary.json" \
  "$output_root/run-2/wav.summary.json" \
  "$output_root/run-2/mp3.summary.json" \
  > "$results_path"

curl_version="$(curl --version | head -n 1)"
jq_version="$(jq --version)"
ffmpeg_version="$(ffmpeg -version | head -n 1)"
ffprobe_version="$(ffprobe -version | head -n 1)"
file_version="$(file --version | head -n 1)"
shasum_version="$(shasum --version 2>&1 | head -n 1)"

jq -n \
  --arg generated_at "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" \
  --arg supplied_url_form "$supplied_url_form" \
  --arg endpoint "/v1/audio/speech" \
  --arg model "$model_id" \
  --arg voice "$voice_id" \
  --argjson authorization_header_sent "$auth_header_sent" \
  --arg curl_version "$curl_version" \
  --arg jq_version "$jq_version" \
  --arg ffmpeg_version "$ffmpeg_version" \
  --arg ffprobe_version "$ffprobe_version" \
  --arg file_version "$file_version" \
  --arg shasum_version "$shasum_version" \
  --slurpfile health "$output_root/preflight/health.json" \
  --slurpfile models "$output_root/preflight/models.json" \
  --slurpfile results "$results_path" \
  '{generated_at: $generated_at, supplied_url_form: $supplied_url_form, endpoint: $endpoint, model: $model, voice: $voice, authorization_header_sent: $authorization_header_sent, tools: {curl: $curl_version, jq: $jq_version, ffmpeg: $ffmpeg_version, ffprobe: $ffprobe_version, file: $file_version, shasum: $shasum_version}, optional_preflight: {health: $health[0], models: $models[0]}, results: $results[0]}' \
  > "$output_root/evidence.json"

printf 'GATE G00: AUTOMATED CHECKS PASSED\n'
printf 'Evidence: .tmp/gates/G00/evidence.json\n'
