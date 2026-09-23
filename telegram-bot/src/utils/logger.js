const ts = () => new Date().toISOString();

const logger = {
  info: (...args) => console.log(`[${ts()}] [INFO]`, ...args),
  warn: (...args) => console.warn(`[${ts()}] [WARN]`, ...args),
  error: (...args) => console.error(`[${ts()}] [ERROR]`, ...args),
  debug: (...args) => {
    if (process.env.LOG_LEVEL === 'debug') console.log(`[${ts()}] [DEBUG]`, ...args);
  },
};

module.exports = logger;
