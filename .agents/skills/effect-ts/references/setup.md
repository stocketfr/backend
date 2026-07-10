# Effect Source Bootstrap

Keep a local Effect source checkout at `./.repos/effect` in every repository where this skill is used.

## Automatic Setup

When the checkout is missing, run the bundled script from the skill directory:

```sh
./scripts/ensure-effect-source.sh /path/to/project
```

The script:

1. Reads the installed Effect version from `node_modules`, `pnpm-workspace.yaml`, `package.json`, or `pnpm-lock.yaml`.
2. For Effect v4, clones the v4 source from `https://github.com/Effect-TS/effect-smol.git`.
3. For Effect v3, clones `https://github.com/Effect-TS/effect.git` at the exact `effect@<version>` tag when available, falling back to its v3 `main` branch.
4. Defaults to Effect v4 when it cannot detect a version.

Do not prompt the user merely because the checkout is missing. The clone is local research infrastructure and should remain ignored by version control.

## Manual Fallback

If the script cannot run, inspect the project's installed Effect major and clone the corresponding source:

```sh
mkdir -p .repos
git clone --depth 1 https://github.com/Effect-TS/effect-smol.git .repos/effect
```

Use `Effect-TS/effect` instead for a v3 project. Never substitute v4 source when researching an existing v3 codebase.
