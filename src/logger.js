const levels = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

function createLogger(level = "info") {
  const currentLevel = levels[level] ?? levels.info;

  function logAt(target, message, meta) {
    if (levels[target] > currentLevel) {
      return;
    }

    const timestamp = new Date().toISOString();
    if (meta) {
      // Keep logs structured without forcing external logging dependencies.
      console.log(`[${timestamp}] [${target.toUpperCase()}] ${message}`, meta);
      return;
    }

    console.log(`[${timestamp}] [${target.toUpperCase()}] ${message}`);
  }

  return {
    error: (message, meta) => logAt("error", message, meta),
    warn: (message, meta) => logAt("warn", message, meta),
    info: (message, meta) => logAt("info", message, meta),
    debug: (message, meta) => logAt("debug", message, meta)
  };
}

module.exports = { createLogger };
