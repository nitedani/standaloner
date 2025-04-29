import type { Plugin } from 'vite';

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
  /^mongodb$/, // MongoDB driver (may include native optimizations)
  /^oracledb$/, // Oracle database driver
  /^oracle$/, // Oracle database driver
  /^snowflake-sdk$/, // Snowflake database connector
  /^mssql$/, // Microsoft SQL Server client
  /^tedious$/, // SQL Server driver
  /^sybase$/, // Sybase database connector
  /^ibm_db$/, // IBM DB2 driver
  /^db2$/, // DB2 connector
  /^informix$/, // Informix database connector
  /^sap-hana-client$/, // SAP HANA client
  /^taos$/, // TDengine database driver
  /^clickhouse$/, // ClickHouse database driver
  /^cassandra-driver$/, // Cassandra database driver
  /^couchbase$/, // Couchbase client
  /^@couchbase\//, // Couchbase SDK
  /^aerospike$/, // Aerospike database client
  /^influx$/, // InfluxDB client
  /^@influxdata\//, // InfluxData packages
  /^neo4j-driver$/, // Neo4j graph database driver
  /^scylla$/, // ScyllaDB client
  /^dynamoose$/, // DynamoDB modeling
  /^cockroachdb$/, // CockroachDB client
  /^timescaledb$/, // TimescaleDB client
  /^leveldb$/, // LevelDB interface
  /^leveldown$/, // LevelDB bindings
  /^rethinkdb$/, // RethinkDB driver
  /^memcached$/, // Memcached client

  // Cryptography and hashing
  /^argon2$/, // Argon2 password hashing
  /^argon2-browser$/, // Argon2 for browsers
  /^bcrypt$/, // BCrypt password hashing
  /^bcryptjs$/, // Pure JS implementation but might still need special handling
  /^sodium-native$/, // Libsodium cryptography bindings
  /^sodium-universal$/, // Universal libsodium bindings
  /^keytar$/, // Native system keychain access
  /^node-forge$/, // TLS/cryptography implementation
  /^node-webcrypto-ossl$/, // WebCrypto OpenSSL implementation
  /^pkcs11js$/, // PKCS#11 bindings
  /^ssh2$/, // SSH client and server implementations
  /^gpg$/, // GnuPG encryption
  /^tls$/, // TLS implementation
  /^@peculiar\//, // WebCrypto packages
  /^webcrypto$/, // Web Cryptography API
  /^@trust\//, // Trust Services
  /^otp$/, // One-time password
  /^yubikey$/, // YubiKey interface
  /^kerberos$/, // Kerberos authentication
  /^node-scrypt$/, // scrypt for passwords
  /^otplib$/, // TOTP/HOTP implementation
  /^fido2-lib$/, // FIDO2/WebAuthn
  /^@simplewebauthn\//, // WebAuthn implementation
  /^secure-random$/, // Secure random number generation
  /^strongbox$/, // Secure storage
  /^pkcs7$/, // PKCS#7 signing/verification

  // Image processing
  /^sharp$/, // High-performance image processing
  /^canvas$/, // Canvas implementation with native dependencies
  /^image-js$/, // Image manipulation library
  /^pureimage$/, // Pure JS image manipulation (might have native optionals)
  /^gm$/, // GraphicsMagick bindings

  // Compression libraries
  /^zlib-sync$/, // Synchronous zlib bindings
  /^node-zopfli$/, // Zopfli compression algorithm
  /^node-libpng$/, // PNG manipulation

  // Machine learning and scientific computing
  /^@tensorflow\//, // All TensorFlow packages
  /^brain\.js$/, // Neural networks
  /^ml-matrix$/, // Matrix operations (may use native code)
  /^ml-regression$/, // Machine learning regression
  /^onnx$/, // Open Neural Network Exchange
  /^onnxruntime$/, // ONNX Runtime
  /^@onnxruntime\/node$/, // ONNX Runtime for Node.js
  /^pytorch-node$/, // PyTorch for Node.js
  /^@pytorch\//, // PyTorch packages
  /^@huggingface\//, // Hugging Face libraries
  /^natural$/, // NLP tools
  /^@nlpjs\//, // NLP.js packages
  /^node-nlp$/, // Natural language processing

  // Audio/video processing
  /^ffmpeg-static$/, // FFmpeg binaries
  /^fluent-ffmpeg$/, // FFmpeg wrapper
  /^fluent-avconv$/, // avconv/ffmpeg wrapper
  /^webrtc$/, // WebRTC implementation
  /^wrtc$/, // WebRTC implementation
  /^simple-peer$/, // WebRTC simplified
  /^node-opus$/, // Opus audio codec bindings
  /^speaker$/, // Audio output device
  /^mic$/, // Microphone access
  /^node-microphone$/, // Microphone streaming
  /^node-lame$/, // MP3 encoding/decoding
  /^node-wav$/, // WAV file processing
  /^node-vad$/, // Voice activity detection

  // File system and OS interaction
  /^chokidar$/, // File watcher
  /^fs-extra$/, // Enhanced file system methods
  /^graceful-fs$/, // Graceful file system operations
  /^node-watch$/, // File watcher
  /^drivelist$/, // List all connected drives
  /^diskusage$/, // Disk usage information
  /^fuse-bindings$/, // FUSE filesystem bindings

  // Native bindings and build tools
  /^node-gyp-build$/, // Node-gyp build tool (indicator of native code)
  /^node-pre-gyp$/, // Pre-gyp tool for native modules
  /^node-pre-gyp-github$/, // GitHub extension for node-pre-gyp
  /^bindings$/, // Helper for loading native modules
  /^node-addon-api$/, // Native addon API
  /^prebuildify$/, // Indicates prebuilt binaries
  /^pkg-config$/, // pkg-config functionality
  /^cmake-js$/, // CMake for Node.js packages

  // PDF manipulation
  /^pdf-lib$/, // PDF manipulation library
  /^pdfkit$/, // PDF generation library

  // Hardware access
  /^usb$/, // USB device access
  /^node-usb$/, // USB device access
  /^bluetooth-hci-socket$/, // Bluetooth HCI socket bindings
  /^noble$/, // BLE peripheral library
  /^node-hid$/, // USB HID device access
  /^node-hid-stream$/, // HID device streams
  /^bluetooth-serial-port$/, // Bluetooth serial port communication
  /^node-ble$/, // Bluetooth Low Energy
  /^node-bluetooth$/, // Bluetooth control
  /^raspicam$/, // Raspberry Pi camera module
  /^onoff$/, // GPIO access (Raspberry Pi, etc.)
  /^i2c-bus$/, // I2C communication
  /^pi-gpio$/, // Raspberry Pi GPIO
  /^pigpio$/, // Raspberry Pi GPIO
  /^node-dht-sensor$/, // DHT temperature/humidity sensors
  /^node-opcua$/, // OPC UA protocol
  /^modbus-serial$/, // Modbus protocol
  /^node-bacstack$/, // BACnet protocol
  /^node-canopen$/, // CANopen protocol
  /^node-can$/, // CAN bus access
  /^zigbee-herdsman$/, // Zigbee protocol
  /^mdns$/, // mDNS/Bonjour/Avahi
  /^node-ssdp$/, // SSDP/UPnP discovery
  /^node-lora$/, // LoRa protocol
  /^zigbee-clusters$/, // Zigbee clusters

  // Performance monitoring
  /^appmetrics$/, // Application metrics
  /^node-memwatch$/, // Memory leak detection
  /^memwatch-next$/, // Memory leak detection
  /^gc-stats$/, // Garbage collector statistics

  // System information and monitoring
  /^systeminformation$/, // Detailed system information (CPU, memory, disk, etc.)
  /^node-os-utils$/, // OS utilities and monitoring
  /^os-utils$/, // OS monitoring utilities
  /^cpu-stat$/, // CPU statistics
  /^pidusage$/, // Process CPU/memory usage monitoring
  /^node-disk-info$/, // Disk information
  /^node-gpu$/, // GPU information and monitoring
  /^hwinfo$/, // Hardware information
  /^node-machine-id$/, // Retrieve machine unique ID
  /^detect-libc$/, // Detect libc implementation
  /^node-health$/, // System health monitoring
  /^process-list$/, // List system processes
  /^sysinfo$/, // System information library
  /^cpu-features$/, // CPU features detection
  /^microtime$/, // High-resolution time measurement
  /^node-uname$/, // System information (uname)

  // Browser and GUI tooling
  /^phantomjs-prebuilt$/, // PhantomJS prebuilt binaries
  /^puppeteer$/, // Puppeteer (includes Chromium)
  /^playwright$/, // Playwright (includes browsers)
  /^playwright-core$/, // Playwright core
  /^electron$/, // Electron framework (includes Chromium)
  /^electron-builder$/, // Electron packaging
  /^node-gtk$/, // GTK+ bindings
  /^node-qt$/, // Qt bindings
  /^node-red$/, // Node-RED (includes native components)
  /^node-notifier$/, // Cross-platform notifications
  /^win-audio$/, // Windows audio control
  /^desktop-screenshot$/, // Desktop screenshot capture
  /^clipboard$/, // System clipboard access
  /^wallpaper$/, // System wallpaper control
  /^iohook$/, // Global keyboard and mouse hooks
  /^sleep$/, // Sleep functions with higher resolution
  /^robotjs$/, // Desktop automation

  // Rust and other language-based Node modules
  /@node-rs\//, // Node-rs namespace for Rust packages
  /^napi-rs$/, // N-API for Rust
  /@rustify\//, // Rustify namespace for Rust packages
  /^neon-bindings$/, // Rust bindings for Node.js
  /^rusty-nodejs$/, // Rust bindings
  /^native-rust-async$/, // Async Rust native modules

  // Process execution and system commands
  /^node-cmd$/, // Command execution
  /^child-process-ext$/, // Extended child process utilities
  /^sudo-prompt$/, // Execute commands with sudo
  /^node-powershell$/, // PowerShell execution
  /^execa$/, // Process execution improvements
  /^windows-process-tree$/, // Windows process tree information
  /^node-pty$/, // Pseudo terminal bindings

  // Platform-specific features
  /^mac-screen-capture-permissions$/, // macOS screen capture permissions
  /^macos-release$/, // macOS version information
  /^win-version$/, // Windows version information
  /^windows-cpu$/, // Windows CPU information
  /^wmi-client$/, // Windows Management Instrumentation
  /^node-mac-permissions$/, // macOS permissions manager
  /^node-linux-packagemanager$/, // Linux package manager access
  /^fsevents$/, // MacOS file system events
  /^registry-js$/, // Windows registry access
  /^registry$/, // Windows registry access
  /^regedit$/, // Windows registry editor

  // Network tools
  /^network$/, // Network utilities
  /^ping$/, // ICMP ping implementation
  /^traceroute$/, // Traceroute implementation
  /^netstat$/, // Network statistics
  /^wireless-tools$/, // Wireless network tools
  /^network-speed$/, // Network speed testing
  /^speedtest-net$/, // Internet speed testing
  /^getmac$/, // Get MAC address
  /^local-devices$/, // Find devices on local network
  /^node-port-scanner$/, // Port scanning
  /^nmap$/, // Network mapper
  /^raw-socket$/, // Raw socket access
  /^pcap$/, // Packet capture library
  /^network-interfaces$/, // Network interfaces information
  /^dns-packet$/, // DNS packet parsing/serializing
  /^network-address$/, // Network address utilities

  // Miscellaneous packages known to cause issues
  /^bufferutil$/, // WebSocket buffer utilities
  /^utf-8-validate$/, // UTF-8 validation
  /^ref$/, // C reference bindings
  /^ref-struct$/, // C struct bindings
  /^ref-napi$/, // Reference/deference pointers
  /^ffi-napi$/, // Foreign function interface
  /^integer$/, // Big integer library with C++ addons
  /^node-sass$/, // Sass compiler with native bindings
  /^fibers$/, // Fibers implementation
  /^libxmljs$/, // Libxml bindings
  /^swiftjs$/, // Swift bindings
  /^grpc$/, // gRPC implementation with native components
  /^grpc-js$/, // gRPC implementation
  /^caps$/, // Linux capabilities
  /^epoll$/, // Linux epoll bindings
  /^tree-sitter$/, // Tree-sitter parsing library
  /^unix-dgram$/, // Unix datagram sockets
  /^unix-socket$/, // Unix sockets
  /^node-ipc$/, // Inter-process communication
  /^node-kernel-module$/, // Kernel module interaction
  /^re2$/, // RE2 regular expression engine

  // Printer and scanner access
  /^node-printer$/, // Printer access
  /^node-thermal-printer$/, // Thermal printer management
  /^printer$/, // Printer management
  /^escpos$/, // ESC/POS printer commands
  /^node-escpos$/, // ESC/POS implementation
  /^scanner$/, // Scanner access
  /^sane-scanner$/, // SANE scanner interface

  // Message queue and distributed systems
  /^amqplib$/, // AMQP protocol for RabbitMQ
  /^rhea$/, // AMQP 1.0 client
  /^kafkajs$/, // Kafka client
  /^node-rdkafka$/, // Native Kafka client
  /^nats$/, // NATS messaging system
  /^hemera$/, // Microservices pattern for NATS
  /^zeromq$/, // ZeroMQ bindings
  /^mqtt$/, // MQTT client
  /^redis-clustr$/, // Redis cluster client
  /^ioredis-cluster$/, // Redis cluster client

  // Advanced logging, metrics, APM
  /^winston-transport-sentry-node$/, // Sentry transport for Winston
  /^dd-trace$/, // Datadog APM
  /^elastic-apm-node$/, // Elastic APM
  /^newrelic$/, // New Relic agent
  /^applicationinsights$/, // Azure Application Insights
  /^appoptics-apm$/, // AppOptics APM
  /^@dynatrace\/oneagent$/, // Dynatrace OneAgent
  /^splunk-logging$/, // Splunk logging
  /^@sentry\/node$/, // Sentry for Node.js
  /^rollbar$/, // Rollbar error tracking
  /^loggly$/, // Loggly logger
  /^stackdriver-errors-js$/, // Google Stackdriver errors

  // Virtualization and containerization clients
  /^dockerode$/, // Docker API client
  /^node-docker-api$/, // Docker API wrapper
  /^kubernetes-client$/, // Kubernetes client
  /^@kubernetes\/client-node$/, // Official Kubernetes client
  /^nerdctl$/, // nerdctl compatibility layer
  /^@podman\//, // Podman client
  /^libvirt$/, // libvirt virtualization API
  /^vagrant$/, // Vagrant API client
  /^proxmox-api$/, // Proxmox API client

  // Real-time communication
  /^@xmpp\//, // XMPP client
  /^node-xmpp-client$/, // XMPP client
  /^matrix-js-sdk$/, // Matrix client
  /^@matrix-org\//, // Matrix.org packages
  /^centrifuge$/, // Centrifugo client
  /^sip.js$/, // SIP client
  /^jssip$/, // SIP client

  // Big data processing
  /^@apache-arrow\//, // Apache Arrow packages
  /^apache-arrow$/, // Apache Arrow columnar memory format
  /^hadoop-streaming$/, // Hadoop streaming
  /^node-spark$/, // Spark client
  /^drill$/, // Apache Drill client
  /^hive-driver$/, // Hive driver
  /^impala$/, // Impala client
  /^parquet-js$/, // Parquet file format
  /^avro-js$/, // Avro serialization
  /^delta-lake$/, // Delta Lake client

  // Service discovery and service mesh
  /^consul$/, // Consul client
  /^node-consul$/, // Consul API client
  /^etcd3$/, // etcd v3 client
  /^node-etcd$/, // etcd client
  /^node-zookeeper-client$/, // ZooKeeper client
  /^eureka-js-client$/, // Eureka service discovery
  /^istio-client$/, // Istio service mesh client
  /^linkerd-config$/, // Linkerd configuration
  /^@hashicorp\//, // HashiCorp tools clients

  // Cloud provider SDKs and tools
  /^@aws-sdk\//, // AWS SDK v3 (modular version)
  /^aws-sdk$/, // AWS SDK for JavaScript
  /^@azure\//, // Azure SDK packages
  /^@google-cloud\//, // Google Cloud SDK packages
  /^@cloudflare\//, // Cloudflare SDK packages
  /^@alicloud\//, // Alibaba Cloud SDK
  /^ibm-cos-sdk$/, // IBM Cloud Object Storage SDK
  /^digitalocean$/, // DigitalOcean API client
  /^firebase-admin$/, // Firebase Admin SDK (server-side)
  /^linode-api$/, // Linode API client

  // Authentication and identity
  /^ldapjs$/, // LDAP client
  /^@auth0\//, // Auth0 packages
  /^passport-saml$/, // SAML authentication

  // Namespace-based patterns that cover multiple packages
  /^@opentelemetry\//, // OpenTelemetry packages
  /^@mapbox\//, // Mapbox packages
  /^@serialport\//, // Serial port related packages
  /^@grpc\//, // gRPC related packages
  /^@abandonware\//, // Maintained forks of abandoned hardware libraries

  // Catchall for packages with common indicators of native code
  /.*\/build\/Release\/.*/, // Any package with a Release build directory
  /.*\.node$/, // Any direct .node binary import
  /.*-darwin\.node$/, // Platform-specific binaries
  /.*-win32\.node$/,
  /.*-linux\.node$/,
  /.*-prebuilds\/.*$/, // Prebuilt binaries directory
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

const defaultExternalsPlugin = (external?: (string | RegExp)[]): Plugin => ({
  name: 'standaloner:default-externals',
  enforce: 'pre',
  async resolveId(id, importer, options) {
    if (
      isExternal(id) ||
      (external &&
        external.some(pattern => (pattern instanceof RegExp ? pattern.test(id) : pattern === id)))
    ) {
      // Make sure it's really a .node file
      if (id.endsWith('.node')) {
        const resolved = await this.resolve(id, importer, options);
        if (resolved) {
          const isNodeFile = resolved.id.endsWith('.node');
          if (!isNodeFile) {
            return null;
          }
        }
      }

      return { id, external: true };
    }
  },
});
