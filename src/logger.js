const fs = require("fs");
const path = require("path");
const EventEmitter = require("events");

const levels = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

function createLogger(optionsOrLevel) {
  const opts = typeof optionsOrLevel === "string" ? { level: optionsOrLevel } : optionsOrLevel || {};
  const levelName = (opts.level || "info").toLowerCase();
  const currentLevel = levels[levelName] ?? levels.info;
  const filePath = opts.filePath || path.join(process.cwd(), "logs", "apexflix.log");
  const maxBuffer = Number(opts.maxBuffer || opts.maxLines || 2000);

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  } catch (e) {
    // ignore
  }

  let stream = null;
  try {
    stream = fs.createWriteStream(filePath, { flags: "a", encoding: "utf8" });
  } catch (e) {
    // continue without file stream
  }

  const buffer = [];
  const events = new EventEmitter();

  function serializeMeta(meta) {
    try {
      return typeof meta === "string" ? meta : JSON.stringify(meta);
    } catch {
      return String(meta);
    }
  }

  function appendToFile(line) {
    if (!stream) return;
    try {
      stream.write(line + "\n");
    } catch (e) {
      // ignore file errors
    }
  }

  function addToBuffer(line) {
    buffer.push(line);
    if (buffer.length > maxBuffer) buffer.shift();
  }

  function parseLogLine(line) {
    const m = String(line || "").match(/^\[(.*?)\] \[(\w+)\] (.*)$/);
    if (!m) return { raw: line };
    return { timestamp: m[1], level: m[2].toLowerCase(), message: m[3], raw: line };
  }

  function logAt(target, message, meta) {
    if ((levels[target] ?? 99) > currentLevel) {
      return;
    }

    const timestamp = new Date().toISOString();
    const metaStr = meta ? " " + serializeMeta(meta) : "";
    const line = `[${timestamp}] [${target.toUpperCase()}] ${message}${metaStr}`;

    if (meta) {
      console.log(line, meta);
    } else {
      console.log(line);
    }

    appendToFile(line);
    addToBuffer(line);
    events.emit("log", parseLogLine(line));
  }

  function getRecentLogs(opts = {}) {
    let { limit = 200, level = "", search = "" } = opts;
    limit = Number(limit) || 200;
    if (limit <= 0) limit = 200;

    let lines = [];
    try {
      const fileData = fs.readFileSync(filePath, "utf8") || "";
      lines = fileData.split(/\r?\n/).filter(Boolean);
    } catch (e) {
      // fallback to in-memory buffer
      lines = buffer.slice();
    }

    let tail = lines.slice(-limit).map(parseLogLine);

    if (level) {
      const want = String(level).toLowerCase();
      tail = tail.filter((l) => String(l.level || "").toLowerCase() === want);
    }

    if (search) {
      const s = String(search).toLowerCase();
      tail = tail.filter((l) => String(l.raw || "").toLowerCase().includes(s));
    }

    return tail;
  }

  function clearLogs() {
    try {
      if (stream) stream.end();
    } catch (e) {}
    try {
      fs.truncateSync(filePath, 0);
    } catch (e) {}
    try {
      stream = fs.createWriteStream(filePath, { flags: "a", encoding: "utf8" });
    } catch (e) {
      stream = null;
    }
    buffer.length = 0;
    events.emit("cleared");
  }

  return {
    error: (m, meta) => logAt("error", m, meta),
    warn: (m, meta) => logAt("warn", m, meta),
    info: (m, meta) => logAt("info", m, meta),
    debug: (m, meta) => logAt("debug", m, meta),
    getRecentLogs,
    clearLogs,
    filePath,
    events,
    levels
  };
}

module.exports = { createLogger };
