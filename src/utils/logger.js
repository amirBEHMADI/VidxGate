/**
 * Simple logger module with timestamps and colored output
 */

const colors = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
};

function getTimestamp() {
  const now = new Date();
  return now.toTimeString().split(" ")[0];
}

const logger = {
  info: (msg, ...args) => {
    console.log(`${colors.dim}[${getTimestamp()}]${colors.reset} ${colors.cyan}[INFO]${colors.reset} ${msg}`, ...args);
  },
  success: (msg, ...args) => {
    console.log(`${colors.dim}[${getTimestamp()}]${colors.reset} ${colors.green}[SUCCESS]${colors.reset} ${msg}`, ...args);
  },
  warn: (msg, ...args) => {
    console.warn(`${colors.dim}[${getTimestamp()}]${colors.reset} ${colors.yellow}[WARN]${colors.reset} ${msg}`, ...args);
  },
  error: (msg, ...args) => {
    console.error(`${colors.dim}[${getTimestamp()}]${colors.reset} ${colors.red}[ERROR]${colors.reset} ${msg}`, ...args);
  },
  action: (msg, ...args) => {
    console.log(`${colors.dim}[${getTimestamp()}]${colors.reset} ${colors.magenta}[ACTION]${colors.reset} ${msg}`, ...args);
  },
};

module.exports = logger;
