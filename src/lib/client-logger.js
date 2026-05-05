const isProd = import.meta.env.PROD;
export const logger = {
  warn: (...args) => { if (!isProd) console.warn(...args); },
  error: (...args) => console.error(...args),
  info: (...args) => { if (!isProd) console.info(...args); },
};
