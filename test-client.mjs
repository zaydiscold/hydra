import { clerkHttpsJson } from './server/services/clerk-auth.js';
import * as store from './server/services/store.js';

const userId = '26d94c8c-5294-4841-855c-2ae12d4490fe';
const accountId = '27f1bd77-1f5f-4c94-bbf1-91e23dcbb24e';

const session = await store.getAccountSession(userId, accountId);
console.log('Testing GET /client with clientCookie...');

const result = await clerkHttpsJson('GET', 'client?_clerk_js_version=5.0.0', {
  cookieClient: session.clientCookie,
  extraHeaders: {
    Origin: 'https://openrouter.ai',
    Referer: 'https://openrouter.ai/',
  },
});

console.log('Status:', result.statusCode);
console.log('Set-Cookie header names:', result.setCookieLines?.map(c => c.split('=')[0]) || []);
console.log();
console.log('Response data keys:', Object.keys(result.data || {}));
console.log('Response.client keys:', Object.keys(result.data?.client || {}));
console.log();
console.log('Has last_active_session_id:', !!result.data?.client?.last_active_session_id);
console.log('Has lastActiveSession:', !!result.data?.client?.lastActiveSession);
console.log('Has sessions array:', Array.isArray(result.data?.client?.sessions));

if (result.data?.client?.sessions) {
  console.log('Number of sessions:', result.data.client.sessions.length);
  for (const s of result.data.client.sessions) {
    console.log('  Session:', s.id, s.status);
    if (s.last_active_token) {
      console.log('    Has last_active_token with JWT:', !!s.last_active_token.jwt);
    }
  }
}
