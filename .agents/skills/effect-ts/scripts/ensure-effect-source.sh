#!/usr/bin/env sh

set -eu

project_root=${1:-.}
repo_dir="$project_root/.repos/effect"

if [ -f "$repo_dir/packages/effect/package.json" ]; then
  exit 0
fi

if [ -e "$repo_dir" ]; then
  echo "Cannot bootstrap Effect source: $repo_dir exists but is not a valid Effect checkout." >&2
  exit 1
fi

effect_version=$(node - "$project_root" <<'NODE'
const fs = require("node:fs")
const path = require("node:path")

const root = path.resolve(process.argv[2])

const read = (file) => {
  try {
    return fs.readFileSync(path.join(root, file), "utf8")
  } catch {
    return undefined
  }
}

const packageJson = read("node_modules/effect/package.json")
if (packageJson !== undefined) {
  const version = JSON.parse(packageJson).version
  if (typeof version === "string") {
    process.stdout.write(version)
    process.exit(0)
  }
}

const workspace = read("pnpm-workspace.yaml")
const catalogMatch = workspace?.match(/^\s{2}effect:\s*[~^]?([^\s#]+)\s*$/m)
if (catalogMatch != null) {
  process.stdout.write(catalogMatch[1])
  process.exit(0)
}

const manifest = read("package.json")
if (manifest !== undefined) {
  const parsed = JSON.parse(manifest)
  const requested = parsed.dependencies?.effect ?? parsed.devDependencies?.effect
  if (typeof requested === "string" && requested !== "catalog:") {
    const match = requested.match(/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/)
    if (match !== null) {
      process.stdout.write(match[1])
      process.exit(0)
    }
  }
}

const lockfile = read("pnpm-lock.yaml")
const lockMatch = lockfile?.match(/^\s{2}effect@(\d+\.\d+\.\d+(?:-[^:\s]+)?):\s*$/m)
if (lockMatch != null) {
  process.stdout.write(lockMatch[1])
}
NODE
)

effect_major=${effect_version%%.*}
mkdir -p "$project_root/.repos"

if [ "$effect_major" = "3" ]; then
  effect_tag="effect@$effect_version"
  if git ls-remote --exit-code --tags https://github.com/Effect-TS/effect.git "refs/tags/$effect_tag" >/dev/null 2>&1; then
    git clone --depth 1 --branch "$effect_tag" https://github.com/Effect-TS/effect.git "$repo_dir"
  else
    git clone --depth 1 https://github.com/Effect-TS/effect.git "$repo_dir"
  fi
  exit 0
fi

if [ -n "$effect_version" ] && [ "$effect_major" != "4" ]; then
  echo "Unsupported Effect major: $effect_major (detected $effect_version)." >&2
  exit 1
fi

git clone --depth 1 https://github.com/Effect-TS/effect-smol.git "$repo_dir"
