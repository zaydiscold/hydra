#!/usr/bin/env node
import { getAccountSession } from './server/services/store.js';

const USER_ID = '26d94c8c-5294-4841-855c-2ae12d4490fe';
const ACCOUNT_ID = 'cecff6a9-cbcc-4110-93ec-409299474b82';

const session = await getAccountSession(USER_ID, ACCOUNT_ID);

console.log('export HYDRA_CAPTURE_OR_SESSION="' + session.sessionCookie + '"');
console.log('export HYDRA_CAPTURE_OR_CLIENT="' + (session.clientCookie || '') + '"');
console.log('');
console.log('Session expires:', session.sessionExpiry);

process.exit(0);
