import path from 'node:path';
import { app } from 'electron';

/** Platform-native user data directory (where DB, secrets, logs live). */
export const userData = process.env.HYDRA_DATA_DIR || app.getPath('userData');

/** Logs directory inside userData. */
export const logsDir = path.join(userData, 'logs');

/** Temp directory for Playwright artifacts. */
export const tempDir = path.join(userData, 'tmp');

/** Legacy data directory (pre-migration). */
export const legacyDataDir = path.join(process.cwd(), 'data');
