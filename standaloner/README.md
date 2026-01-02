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
    bundle: false,     // Set to true to bundle into a single file
    minify: false,     // Set to true to minify output
    trace: true,       // Set to false to disable dependency tracing
    external: [],      // Array of packages to exclude from bundling
    isolated: false    // Set to true to build each entry separately without shared chunks
  })] // Uses Vite's build pipeline instead of Rolldown
});
```

## Common Use Cases

- **SSR Applications**: Build with Vite and deploy the self-contained output
- **Native Dependencies**: Use modules that can't be bundled without special configuration
- **Microservices**: Create standalone deployable units for each service
- **Serverless Functions**: Build isolated, self-contained functions for Vercel, AWS Lambda, or similar platforms

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `input` | `string \| string[] \| object` | - | Input file(s) to process. Can be a single file path, array of paths, or object with named entries |
| `outDir` | `string` | `'<inputDir>/dist'` | Output directory |
| `bundle` | `boolean \| object` | `true` | Bundle options or disable bundling. See Advanced Options for object properties |
| `trace` | `boolean` | `true` | Whether to trace dependencies |
| `cleanup` | `boolean` | `false` | Delete input files after processing |
| `verbose` | `boolean` | `false` | Enable verbose logging |

### Bundle Options

When `bundle` is an object, it supports these additional properties:

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `external` | `(string \| RegExp)[]` | `[]` | Packages to exclude from bundling |
| `plugins` | `Plugin[]` | `[]` | Rolldown plugins to apply |
| `output` | `object` | - | Rolldown output options (e.g., `format`, `sourcemap`) |
| `isolated` | `boolean` | `false` | Build each entry separately without shared chunks |

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
    output: { format: 'esm' },

    // Build each entry separately (useful for serverless functions)
    isolated: true
  }
});
```

#### Isolated Builds

For serverless deployments (e.g., Vercel, AWS Lambda) where each function must be completely self-contained:

```javascript
await standaloner({
  input: {
    functionA: 'src/functionA.js',
    functionB: 'src/functionB.js',
    functionC: 'src/functionC.js'
  },
  outDir: 'dist',
  bundle: {
    isolated: true  // Each function becomes a standalone bundle without shared chunks
  }
});
```

When `isolated: true`:
- Each entry point is bundled separately
- No shared chunks are created between entry points
- Each output file is completely self-contained
- Builds run concurrently for better performance
- Ideal for serverless functions that need independent deployment


## How It Works

1. **Bundle & Relocate**: Uses [Rolldown](https://github.com/rolldown/rolldown) to bundle code and relocate referenced files to `.static` (or Vite's build pipeline when using the Vite plugin)
2. **Trace**: Uses [Vercel's Node File Trace](https://github.com/vercel/nft) to detect dependencies that can't be bundled
3. **Organize**: Copies dependencies to output with proper `node_modules` structure

## License

MIT
