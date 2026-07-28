# AGENTS.md

Repository-level guidance for AI/code agents working in this project.

## Core rules

1. Use `yarn` for dependency management and scripts.
2. Keep package output limited to `dist` and package metadata files.
3. Maintain dual package compatibility (ESM + CJS + typings).
4. Avoid runtime dependencies unless strictly required.

## Commands

- Install: `yarn install`
- Lint: `yarn lint`
- Typecheck: `yarn typecheck`
- Test: `yarn test:run`
- Build: `yarn build`
- Package quality: `yarn check:pkg`

## Release expectations

- Publishing should happen from CI on tags `v*`.
- Keep `publishConfig.access` as `public` for the scoped package.
- `npm publish` in CI should use `--provenance`.

## Code conventions

- TypeScript strict mode is required.
- Public API surface should be exported from `src/index.ts`.
- Preserve isomorphic behavior: do not import Node-only modules in runtime code.
