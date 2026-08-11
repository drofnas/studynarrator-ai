#!/usr/bin/env bash

set -Eeuo pipefail

if [[ "${1:-}" != "--confirm" || $# -ne 1 ]]; then
  printf 'Usage: bash scripts/gates/g00-reset.sh --confirm\n' >&2
  exit 2
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd -- "$script_dir/../.." && pwd -P)"
expected_parent="$repo_root/.tmp/gates"
target="$expected_parent/G00"

if [[ ! -e "$target" ]]; then
  printf 'Nothing to reset: %s does not exist.\n' "$target"
  exit 0
fi

if [[ -L "$target" || ! -d "$target" ]]; then
  printf 'Refusing reset: target must be a real directory, not a link or file: %s\n' "$target" >&2
  exit 1
fi

resolved_parent="$(cd -- "$(dirname -- "$target")" && pwd -P)"
resolved_target="$resolved_parent/$(basename -- "$target")"
if [[ "$resolved_parent" != "$expected_parent" || "$resolved_target" != "$target" || "$(basename -- "$target")" != "G00" ]]; then
  printf 'Refusing reset: resolved target is outside the expected gate directory: %s\n' "$resolved_target" >&2
  exit 1
fi

linked_entry="$(find -P "$target" -type l -print -quit)"
if [[ -n "$linked_entry" ]]; then
  printf 'Refusing reset: symbolic link found inside target: %s\n' "$linked_entry" >&2
  exit 1
fi

printf 'Removing these G00 disposable artifacts:\n'
find -P "$target" -mindepth 1 -maxdepth 3 -print
rm -rf -- "$target"
printf 'Removed disposable G00 artifacts: %s\n' "$target"
