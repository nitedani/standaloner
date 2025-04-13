# Standaloner

Create self-contained, deployable Node.js applications with automatic handling of native modules and dependencies.

## Features

- **Deployment-ready output directory** with all dependencies included
- **Automatic handling of 80+ native modules** (Sharp, Prisma, Canvas, etc.)
- **Preserves file references** (URLs, paths) and handles multiple dependency versions
- **Vite integration** via plugin

## Installation

```bash
# npm
npm install standaloner

# yarn
yarn add standaloner

# pnpm
pnpm add standaloner
```

## Usage

### Basic Usage

```javascript
import standaloner from 'standaloner';

// Single entry point
await standaloner({
  input: 'src/server.js',
  outDir: 'dist'
});

// Multiple entry points
await standaloner({
  input: ['src/server.js', 'src/workers/queue.js'],
  outDir: 'dist'
});
```

### With Vite

```javascript
// vite.config.js
import { defineConfig } from 'vite';
import standaloner from 'standaloner/vite';

export default defineConfig({
  plugins: [standaloner()] // Uses Vite's build pipeline instead of Rolldown
});
```

## Common Use Cases

- **SSR Applications**: Build with Vite and deploy the self-contained output
- **Native Dependencies**: Use modules like Sharp, Prisma, Canvas without configuration
- **Microservices**: Create standalone deployable units for each service

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `input` | `string \| string[]` | - | Input file(s) to process |
| `outDir` | `string` | `'<inputDir>/dist'` | Output directory |
| `bundle` | `boolean \| object` | `true` | Bundle options or disable bundling |
| `trace` | `boolean` | `true` | Whether to trace dependencies |
| `cleanup` | `boolean` | `false` | Delete input files after processing |
| `verbose` | `boolean` | `false` | Enable verbose logging |

### Advanced Options

```javascript
await standaloner({
  input: 'src/index.js',
  outDir: 'dist',
  bundle: {
    // Add custom externals (beyond the 80+ automatic ones)
    external: ['some-package', /^my-org-packages/],

    // Add Rolldown plugins
    plugins: [myPlugin()],

    // Output options
    output: { format: 'esm' }
  }
});
```

## Default Externals

Standaloner automatically handles 80+ packages including:

- **Database**: Prisma, SQLite3, PostgreSQL, MySQL, MongoDB
- **Native Modules**: Sharp, Argon2, BCrypt, Canvas, FFmpeg
- **System**: Chokidar, fs-extra, USB/Bluetooth/Serial access
- **Other**: TensorFlow.js, PDF libraries, Puppeteer/Playwright

No need to manually specify these - they're handled automatically!

## How It Works

1. **Bundle**: Uses [Rolldown](https://github.com/rolldown/rolldown) to bundle code (or Vite's build pipeline when using the Vite plugin)
2. **Trace**: Uses [Node File Trace](https://github.com/vercel/nft) to find unbundled dependencies
3. **Organize**: Copies dependencies to output with proper `node_modules` structure

## License

MIT
