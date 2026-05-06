const isProd = import.meta.env.PROD;
export const logger = {
  debug: (...args) => { if (!isProd) console.debug(...args); },
  warn: (...args) => { if (!isProd) console.warn(...args); },
  error: (...args) => console.error(...args),
  info: (...args) => { if (!isProd) console.info(...args); },
};
