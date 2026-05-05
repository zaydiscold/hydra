const isProd = import.meta.env.PROD;
export const logger = {
  warn: (...args) => { console.warn(...args); },
  error: (...args) => console.error(...args),
  info: (...args) => { if (!isProd) console.info(...args); },
};
