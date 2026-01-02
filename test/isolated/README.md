# Isolated Build Test

Validates that `isolated: true` builds each entry separately without shared chunks.

## Test Files

- `functionA.mjs`, `functionB.mjs`, `functionC.mjs` - Entry points sharing common code
- `shared.mjs` - Common utilities
- `test.js` - Validation script

## Run Test

```bash
node test.js
```

Verifies isolated builds create no shared chunks while normal builds do.

