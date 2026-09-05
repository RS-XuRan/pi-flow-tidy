#!/usr/bin/env sh
set -eu

if ! command -v pi >/dev/null 2>&1; then
  echo "Pi is not installed or is not available on PATH." >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed or is not available on PATH." >&2
  exit 1
fi

pi install git:github.com/RS-XuRan/pi-flow-tidy

agent_dir="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
package_root="$agent_dir/git/github.com/RS-XuRan/pi-flow-tidy"
installer="$package_root/bin/pi-flow-tidy.mjs"
if [ ! -f "$installer" ]; then
  echo "Installed package entry point was not found: $installer" >&2
  exit 1
fi

node "$installer" install
