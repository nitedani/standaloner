# Standaloner

Create self-contained, deployable Node.js applications by bundling your code and including necessary dependencies.

## Features

- **Deployment-ready output directory** with all dependencies included
- **Intelligent bundling** with proper handling of native modules and dependencies
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
  plugins: [standaloner({
    // Options (all optional)
    singlefile: false, // Set to true to bundle into a single file
    minify: false,     // Set to true to minify output
    trace: true,       // Set to false to disable dependency tracing
    external: []       // Array of packages to exclude from bundling
  })] // Uses Vite's build pipeline instead of Rolldown
});
```

## Common Use Cases

- **SSR Applications**: Build with Vite and deploy the self-contained output
- **Native Dependencies**: Use modules that can't be bundled without special configuration
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
    // Specify packages to exclude from bundling
    external: ['some-native-module', /^my-org-packages/],

    // Add Rolldown plugins
    plugins: [myPlugin()],

    // Output options
    output: { format: 'esm' }
  }
});
```


## How It Works

1. **Bundle & Relocate**: Uses [Rolldown](https://github.com/rolldown/rolldown) to bundle code and relocate referenced files to `.static` (or Vite's build pipeline when using the Vite plugin)
2. **Trace**: Uses [Vercel's Node File Trace](https://github.com/vercel/nft) to detect dependencies that can't be bundled
3. **Organize**: Copies dependencies to output with proper `node_modules` structure

## License

MIT
