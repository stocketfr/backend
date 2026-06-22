#!/bin/sh
set -eu

usage() {
  cat <<'USAGE' >&2
Usage:
  sh ./scripts/import.sh sortly [--preview|--propose] <sortly-export.csv>
  sh ./scripts/import.sh products [--preview|--propose] <normalized-products.csv>

Import types:
  sortly    Import Sortly Item rows from a raw Sortly export; folder rows are ignored
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
  sortly)
    if [ "$#" -lt 1 ]; then
      usage
      exit 1
    fi

    infisical run --env=dev -- tsx src/scripts/import-products.ts --import-type sortly-items "$@"
    ;;

  products)
    if [ "$#" -lt 1 ]; then
      usage
      exit 1
    fi

    infisical run --env=dev -- tsx src/scripts/import-products.ts --import-type normalized-products "$@"
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
