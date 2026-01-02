# Asset Detection Test

This test validates that standaloner correctly detects and relocates all types of asset references.

## Tested Asset Detection Types

1. **URL References**: `new URL('./file', import.meta.url)`
2. **Path Join Operations**: `path.join(__dirname, 'file')`
3. **FS Operations**: `fs.readFileSync(path)`, `fs.statSync(path)`, etc.
4. **Require for Native Modules**: `require('./file.node')`
5. **Multiple References**: Multiple assets in the same file

## Test Files

- `index.mjs` - Source file with all asset reference types
- `test.js` - Test runner that builds and validates
- Asset files:
  - `test-data.txt` - Text file
  - `image.png` - Binary file (mock)
  - `config.json` - JSON configuration
  - `data/nested-file.csv` - Nested directory asset
  - `mock.node` - Mock native module

## Run Test

```bash
node test.js
```

## What It Validates

1. Assets are correctly detected during bundling
2. Assets are relocated to `.static` directory
3. Asset references are transformed correctly
4. Built application can access all relocated assets
5. All 5 asset detection types work properly
