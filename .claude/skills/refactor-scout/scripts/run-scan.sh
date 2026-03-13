#!/usr/bin/env bash
set -euo pipefail

refactor-scout scan --format json --output .tmp/refactor-scout.json "$@"
