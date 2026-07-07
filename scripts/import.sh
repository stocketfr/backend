#!/bin/sh
set -eu

usage() {
  cat <<'USAGE' >&2
Usage:
  sh ./scripts/import.sh products <normalized-products.csv>

Import types:
  products  Import an already-normalized product CSV
USAGE
}

if [ "$#" -lt 1 ]; then
  usage
  exit 1
fi

kind=$1
shift

case "$kind" in
  products)
    if [ "$#" -ne 1 ]; then
      usage
      exit 1
    fi

    infisical run --env=dev -- tsx src/scripts/import-products.ts "$1"
    ;;

  -h|--help|help)
    usage
    ;;

  *)
    echo "Unknown import type: $kind" >&2
    usage
    exit 1
    ;;
esac
