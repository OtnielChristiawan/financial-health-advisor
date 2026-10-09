#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
install_dir="${project_root}/.render/java25"
archive="$(mktemp)"
extract_dir="$(mktemp -d)"
trap 'rm -f "$archive"; rm -rf "$extract_dir"' EXIT

curl --fail --silent --show-error --location \
  "https://api.adoptium.net/v3/binary/latest/25/ga/linux/x64/jdk/hotspot/normal/eclipse" \
  --output "$archive"
mkdir -p "$extract_dir" "$install_dir"
tar -xzf "$archive" --directory "$extract_dir" --strip-components=1
cp -R "$extract_dir/." "$install_dir/"
"$install_dir/bin/java" -version
