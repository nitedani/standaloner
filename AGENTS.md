# Agent Instructions for Standaloner Repository

## Repository Overview

**Standaloner** is a Node.js build tool that creates self-contained, deployable applications by bundling code and including necessary dependencies. It uses Rolldown for bundling, Vercel's Node File Trace for dependency tracing, and provides a Vite plugin for integration.

**Repository Stats:**
- Type: TypeScript monorepo using pnpm workspaces
- Size: ~21 source files (excluding node_modules/dist)
- Language: TypeScript (ES2022, strict mode)
- Package Manager: pnpm v10.7.0 (exact version pinned in packageManager field)
- Node Version: Tested with v20.x
- License: MIT

## Critical Setup Instructions

### 1. Initial Setup (REQUIRED)

**ALWAYS run these commands in order before making any changes:**

```bash
# Enable corepack to get the correct pnpm version
corepack enable

# Install dependencies (respects pnpm-lock.yaml)
pnpm install
```

**Note:** The repository uses **pnpm workspaces** with workspace links defined in `.npmrc`. Never use npm or yarn.

### 2. Building the Project

**To build all packages:**
```bash
pnpm build
```

This command:
- Compiles the main `standaloner` package TypeScript (removes dist, runs `tsc`)
- Builds test packages including the Vite integration test
- Takes approximately 8-10 seconds total
- The Vite test build takes 7-8 seconds and includes Prisma setup

**To build only the main package:**
```bash
cd standaloner && pnpm run build
```

**Development mode with watch:**
```bash
cd standaloner && pnpm run dev
```
This runs TypeScript in watch mode (`tsc -w`).

### 3. Testing

**There are no formal test scripts.** The `test/` directory contains example packages that demonstrate usage:
- `test/package1/` - Basic package with lodash dependency
- `test/package2/` - Package with different lodash version (demonstrating multi-version handling)
- `test/vite/` - Full Vite SSR application using standaloner plugin

**To test the Vite integration manually:**
```bash
cd test/vite
node test.js  # Runs standaloner programmatically
# OR
pnpm run build  # Builds via Vite plugin
```

**IMPORTANT:** The `test/vite` package has a `prod` script, but it currently has a known issue where it expects `dist/server/index.js` but the bundle creates `dist/server/index.mjs`. The build itself succeeds, producing a 983KB bundled output.

### 4. Validation

**No linting or formatting scripts are configured.** However, Prettier configuration exists in `.prettierrc`:
- 100 char line width
- 2 space tabs
- Single quotes
- Semicolons required
- LF line endings

**TypeScript strict mode is enabled** in `standaloner/tsconfig.json` with:
- `strict: true`
- `noImplicitAny: true`
- `strictNullChecks: true`
- `noUncheckedIndexedAccess: true`

Always ensure TypeScript compiles without errors by running `pnpm build`.

## Project Structure

### Workspace Layout

```
/
├── standaloner/              # Main package (published to npm)
│   ├── src/                  # TypeScript source files
│   │   ├── index.ts          # Main API entry point
│   │   ├── vite.ts           # Vite plugin
│   │   ├── bundle.ts         # Rolldown bundling logic
│   │   ├── trace.ts          # Dependency tracing using @vercel/nft
│   │   ├── relocate.ts       # Asset relocation
│   │   └── utils/            # Utility functions
│   ├── dist/                 # Compiled output (gitignored)
│   ├── package.json          # Main package manifest
│   └── tsconfig.json         # TypeScript config (ES2022, node16 modules)
│
├── test/                     # Example/test packages
│   ├── package1/             # Test package with dependencies
│   ├── package2/             # Test package (multi-version demo)
│   └── vite/                 # Vite SSR integration test
│       ├── server/           # Server source code
│       ├── pages/            # Vike pages
│       ├── prisma/           # Prisma schema and test.db
│       ├── vite.config.ts    # Uses standaloner plugin
│       └── test.js           # Programmatic test script
│
├── package.json              # Root workspace config
├── pnpm-workspace.yaml       # Workspace definition
├── pnpm-lock.yaml            # Locked dependencies
├── .npmrc                    # pnpm workspace settings
├── .prettierrc               # Code style config
└── .gitignore                # Ignores node_modules, dist, test.db
```

### Key Files

**Configuration:**
- `standaloner/tsconfig.json` - TypeScript compiler options
- `.prettierrc` - Code formatting rules
- `pnpm-workspace.yaml` - Defines workspace packages

**Source Code Entry Points:**
- `standaloner/src/index.ts` - Main standaloner API
- `standaloner/src/vite.ts` - Vite plugin integration

**Package Exports (from standaloner/package.json):**
- `.` → `./dist/index.js` (default export)
- `./vite` → `./dist/vite.js` (Vite plugin)

## Architecture & Key Concepts

### How Standaloner Works

1. **Bundle Phase** (optional): Uses Rolldown to bundle code, relocating file references to `.static` directory
2. **Trace Phase**: Uses Vercel's Node File Trace to detect unbundleable dependencies (native modules, etc.)
3. **Copy Phase**: Copies traced dependencies to output with proper `node_modules` structure

### Dependencies

**Runtime Dependencies:**
- `@vercel/nft` v0.30.3 - Node File Trace for dependency detection
- `rolldown` 1.0.0-beta.51 - Fast Rust-based bundler (Rollup alternative)
- `acorn` v8.15.0 - JavaScript parser
- `estree-walker` v3.0.3 - AST traversal
- `magic-string` v0.30.21 - String manipulation for code transformation

**Dev Dependencies:**
- `typescript` v5.9.3 (main package) / v5.8.2 (root)
- `vite` v7.2.2 (peer dependency for plugin)
- `rollup` v4.53.2 (types)

### Workspace Dependencies

The root `package.json` uses pnpm overrides to link workspace packages:
```json
"pnpm": {
  "overrides": {
    "standaloner": "link:./standaloner/",
    "package1": "link:./test/package1/",
    "package2": "link:./test/package2/"
  }
}
```

This means test packages reference the local `standaloner` package, not npm.

## Common Pitfalls & Important Notes

### Build Scripts

- **ALWAYS use `pnpm`**, never `npm` or `yarn`
- The root `build` script uses filters: `--filter {standaloner} --filter {test/*}`
- Building from clean state works reliably
- The Vite test package has a `prepare` script that runs Prisma setup during install

### TypeScript Configuration

- Module system: `node16` (ESM with .js extensions in imports)
- Target: `ES2022`
- Strict mode enabled - all code must pass strict type checking
- Declaration files are generated (`declaration: true`)

### Vite Plugin Behavior

When using the Vite plugin with `bundle: true`:
- Creates a bundled output file
- The bundle plugin runs AFTER initial Vite build in the `writeBundle` hook
- File extensions might differ from expectations (e.g., `.mjs` instead of `.js`)
- The plugin sets `resolve.noExternal: true` for server environments

### Prisma in Test Package

The `test/vite` package includes Prisma:
- Runs `prisma:reset` on install (generates client, pushes schema)
- Uses SQLite database at `prisma/test.db`
- Client generated to `node_modules/@prisma/client`

### CI/CD

**No GitHub Actions workflows exist** in this repository. No automated CI/CD is configured.

## Making Changes

### When Modifying TypeScript Source

1. Make your changes in `standaloner/src/`
2. Run `pnpm build` to compile
3. Check for TypeScript errors - they MUST be fixed
4. Test with the Vite example: `cd test/vite && pnpm run build`
5. Verify the build output shows the bundling summary

### When Adding Dependencies

1. Add to appropriate `package.json` (main or test package)
2. Run `pnpm install` from repository root
3. Rebuild to ensure no issues

### Code Style

- Follow the existing style in each file
- Use single quotes for strings
- Add semicolons
- 2-space indentation
- Comments are minimal - only add if necessary for complex logic

## Build Time Expectations

- TypeScript compilation (standaloner): ~1-2 seconds
- Full workspace build: ~8-10 seconds
- Vite test build: ~7-8 seconds
- Clean build (rm -rf dist): Same as above

## Trust These Instructions

These instructions have been validated by:
- Running `corepack enable` and installing pnpm v10.7.0
- Successfully running `pnpm install`
- Successfully running `pnpm build` from clean state
- Verifying TypeScript compilation with zero errors
- Testing the Vite integration build process
- Examining all configuration files and package manifests

**Only search for additional information if these instructions are incomplete or you encounter errors not documented here.**
