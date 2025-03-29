// ANSI color codes for terminal output
const Colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

// Configuration state
let verbose = false;

/**
 * Write a log message with forced newline for clean separation
 */
function formatMessage(color: string, prefix: string, message: string): string {
  return `${color}${Colors.bright}${prefix}${Colors.reset} ${message}`;
}

/**
 * Enable or disable verbose logging
 */
function setVerbose(value: boolean): void {
  verbose = value;
}

/**
 * Log a standard info message (blue color)
 */
function logInfo(message: string): void {
  console.info(formatMessage(Colors.blue, '[build]', message));
}

/**
 * Log a verbose message (cyan color), only when verbose mode is enabled
 */
function logVerbose(message: string): void {
  if (verbose) {
    console.info(formatMessage(Colors.cyan, '[build:verbose]', message));
  }
}

/**
 * Log an error message (red color)
 */
function logError(message: string): void {
  console.error(formatMessage(Colors.red, '[build:error]', message));
}

/**
 * Log a warning message (yellow color)
 */
function logWarning(message: string): void {
  console.warn(formatMessage(Colors.yellow, '[build:warning]', message));
}

/**
 * Log a success message (green color)
 */
function logSuccess(message: string): void {
  console.log(formatMessage(Colors.green, '[build:success]', message));
}

export { setVerbose, logInfo, logVerbose, logError, logWarning, logSuccess };
