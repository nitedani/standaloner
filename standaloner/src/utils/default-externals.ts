export { isExternal };
export { defaultExternalsPlugin };
export { externalPatterns };

const externalPatterns = [
  // Database drivers and ORM tools
  /@prisma/, // Prisma ORM with native bindings
  /^prisma$/, // Prisma core package
  /^sqlite3$/, // SQLite bindings
  /^pg-native$/, // PostgreSQL native bindings
  /^mysql2$/, // MySQL native connector
  /^better-sqlite3$/, // Better SQLite3 with native bindings
  /^mongoose$/, // MongoDB ODM (may include native code)

  // Cryptography and hashing
  /^argon2$/, // Argon2 password hashing
  /@node-rs\/argon2/, // Rust-based Argon2 implementation
  /^bcrypt$/, // BCrypt password hashing
  /^bcryptjs$/, // Pure JS implementation but might still need special handling
  /^sodium-native$/, // Libsodium cryptography bindings
  /^keytar$/, // Native system keychain access

  // Image processing
  /^sharp$/, // High-performance image processing
  /^canvas$/, // Canvas implementation with native dependencies
  /^image-js$/, // Image manipulation library
  /^pureimage$/, // Pure JS image manipulation (might have native optionals)

  // Compression libraries
  /^zlib-sync$/, // Synchronous zlib bindings
  /^node-zopfli$/, // Zopfli compression algorithm
  /^node-libpng$/, // PNG manipulation

  // Machine learning and scientific computing
  /@tensorflow\/tfjs-node$/, // TensorFlow.js Node.js bindings
  /^node-tensorflow$/, // TensorFlow bindings
  /^brain\.js$/, // Neural networks
  /^ml-matrix$/, // Matrix operations (may use native code)

  // Audio/video processing
  /^ffmpeg-static$/, // FFmpeg binaries
  /^fluent-ffmpeg$/, // FFmpeg wrapper
  /^node-webrtc$/, // WebRTC implementation
  /^node-opus$/, // Opus audio codec bindings

  // File system and OS interaction
  /^chokidar$/, // File watcher
  /^fs-extra$/, // Enhanced file system methods
  /^graceful-fs$/, // Graceful file system operations
  /^node-watch$/, // File watcher

  // Other native bindings
  /^node-gyp-build$/, // Node-gyp build tool (indicator of native code)
  /^node-pre-gyp$/, // Pre-gyp tool for native modules
  /^bindings$/, // Helper for loading native modules
  /@mapbox\/node-pre-gyp/, // Mapbox's pre-gyp fork
  /^node-addon-api$/, // Native addon API
  /^serialport$/, // Serial port access
  /@serialport\/bindings/, // Serial port bindings

  // PDF manipulation
  /^pdf-lib$/, // PDF manipulation library
  /^pdfkit$/, // PDF generation library

  // Hardware access
  /^usb$/, // USB device access
  /^bluetooth-hci-socket$/, // Bluetooth HCI socket bindings
  /^noble$/, // BLE peripheral library

  // Performance monitoring
  /^appmetrics$/, // Application metrics
  /^node-memwatch$/, // Memory leak detection

  // Other problematic packages
  /^phantomjs-prebuilt$/, // PhantomJS prebuilt binaries
  /^puppeteer$/, // Puppeteer (includes Chromium)
  /^playwright$/, // Playwright (includes browsers)
  /^playwright-core$/, // Playwright core
  /^oracledb$/, // Oracle database driver
  /^mongodb$/, // MongoDB driver (may include native optimizations)
  /^snowflake-sdk$/, // Snowflake database connector
  /^mssql$/, // Microsoft SQL Server client

  // Rust-based Node packages (usually have native components)
  /@node-rs\//, // Node-rs namespace for Rust packages
  /^napi-rs$/, // N-API for Rust

  // Miscellaneous packages known to cause issues
  /^bufferutil$/, // WebSocket buffer utilities
  /^utf-8-validate$/, // UTF-8 validation
  /^registry-js$/, // Windows registry access
  /^cpu-features$/, // CPU features detection
  /^microtime$/, // High-resolution time measurement
  /^ref$/, // C reference bindings
  /^ref-struct$/, // C struct bindings
  /^ffi-napi$/, // Foreign function interface
  /^integer$/, // Big integer library with C++ addons
  /^leveldown$/, // LevelDB bindings
  /^node-sass$/, // Sass compiler with native bindings
  /^fibers$/, // Fibers implementation
  /^fsevents$/, // MacOS file system events
  /^node-hid$/, // USB HID device access
  /^kerberos$/, // Kerberos authentication
  /^re2$/, // RE2 regular expression engine
  /^robotjs$/, // Desktop automation
  /^libxmljs$/, // Libxml bindings
  /^swiftjs$/, // Swift bindings
  /^grpc$/, // gRPC implementation with native components

  // Catchall for packages with common indicators of native code
  /.*\/build\/Release\/.*/, // Any package with a Release build directory
  /.*\.node$/, // Any direct .node binary import
  /.*-darwin\.node$/, // Platform-specific binaries
  /.*-win32\.node$/,
  /.*-linux\.node$/,
];

// Convert the array of regex patterns into a single combined regex
const createCombinedRegex = (patterns: RegExp[]) => {
  // Extract the pattern strings from each RegExp object, removing the leading/trailing slashes
  const patternStrings = patterns.map(
    regex => regex.toString().slice(1, -1) // Remove the /.../ wrapper
  );

  // Join them with the OR operator and create a new RegExp
  return new RegExp(`(?:${patternStrings.join('|')})`);
};

// Create the combined regex for when you need it
const externalRegex = createCombinedRegex(externalPatterns);

const isExternal = (packageId: string) => {
  // You can use either the combined regex
  return externalRegex.test(packageId);
};

const defaultExternalsPlugin = {
  name: 'standaloner:default-externals',
  enforce: 'pre',
  resolveId(id: string) {
    if (isExternal(id)) {
      return { id, external: true };
    }
  },
};
