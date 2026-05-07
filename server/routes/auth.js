import { Router } from 'express';
import { requireUnlocked } from '../middleware/auth.js';
import AuthController from '../controllers/AuthController.js';

const router = Router();

/**
 * Escape HTML entities for safe interpolation into raw HTML responses.
 * Used by the magic-link callback handler below — `pending.email` and
 * `err.message` originate from Clerk's API and could carry markup.
 * Even though the callback only ever renders to localhost, escaping is
 * cheap and prevents reflected-XSS regressions if the server is ever
 * exposed beyond loopback.
 */
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Status: tells frontend whether to show setup or login screen
router.get('/status', AuthController.getStatus.bind(AuthController));

// First-time setup: create password
router.post('/setup', AuthController.setup.bind(AuthController));

// Login
router.post('/login', AuthController.login.bind(AuthController));

// Nuclear Reset (Wipe Database)
router.post('/nuke', AuthController.nuke.bind(AuthController));

// Logout (Stateless JWTs mean frontend just deletes token)
router.post('/logout', requireUnlocked, AuthController.logout.bind(AuthController));

// Change password (requires current session)
router.post('/change-password', requireUnlocked, AuthController.changePassword.bind(AuthController));

// P6 — Magic link callback (PUBLIC — Clerk redirects browser here after user clicks link)
// GET /api/auth/magic-callback?signInId=...&accountId=...
router.get('/magic-callback', async (req, res) => {
  const { signInId, accountId, __clerk_ticket: clerkTicket } = req.query;
  if (!signInId || !accountId) {
    return res.status(400).send('<h2>Magic Link Error</h2><p>Missing signInId or accountId in callback URL.</p>');
  }

  try {
    // Lazy import to avoid circular deps
    const { pendingMagicLinks } = await import('../services/magic-link-manager.js');
    const clerkAuth = await import('../services/clerk-auth.js');
    const store = await import('../services/store.js');
    const pending = pendingMagicLinks.get(signInId);
    if (!pending) {
      return res.status(410).send(`
        <html><body style="font-family:monospace;background:#0a0a0a;color:#fff;padding:40px">
          <h2 style="color:#f87171">⚠ Link Expired or Already Used</h2>
          <p>This magic link has expired (15 min limit) or was already claimed.</p>
          <p>Go back to Hydra and send a new link.</p>
        </body></html>
      `);
    }

    // Complete the email_link sign-in/sign-up — pass the __clerk_ticket token if Clerk embedded it in the redirect URL
    const isSignUpBool = pending.isSignUp === true || req.query.isSignUp === '1';
    const session = await clerkAuth.completeEmailLink(signInId, pending.clientCookie, clerkTicket, { isSignUp: isSignUpBool });
    await store.updateAccountSession(
      pending.userId,
      pending.accountId,
      session.sessionCookie,
      session.clientCookie,
      session.sessionExpiry,
      { isNewLogin: true }
    );
    await store.logAccountEvent(pending.userId, pending.accountId, 'MAGIC_LINK_VERIFIED', `Signed in via magic link (${pending.email})`);

    // Auto-provision if no management key
    const { getManagementKeys } = await import('../services/management-key-store.js');
    const { default: dashboardApi } = await import('../services/dashboard-api.js');
    const existingKeys = await getManagementKeys(pending.accountId);
    let provisionNote = '';
    if (existingKeys.length === 0) {
      try {
        const pr = await dashboardApi.createManagementKey(pending.userId, pending.accountId);
        if (pr?.key) provisionNote = ' Management key auto-provisioned.';
      } catch { /* non-fatal */ }
    }

    pendingMagicLinks.delete(signInId);

    return res.send(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Hydra — Signed In</title></head>
<body style="font-family:monospace;background:#0a0a0a;color:#fff;padding:40px;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh">
  <div style="text-align:center;max-width:420px">
    <div style="font-size:3rem;margin-bottom:16px">✓</div>
    <h2 style="color:#4ade80;margin:0 0 12px">Signed In Successfully</h2>
    <p style="color:#d1d5db;margin:0 0 8px">Account <strong style="color:#fff">${escapeHtml(pending.email)}</strong> is now authenticated in Hydra.${escapeHtml(provisionNote)}</p>
    <p style="color:#6b7280;font-size:0.85rem;margin:0 0 24px">This tab will close automatically in 3 seconds…</p>
    <div id="bar" style="height:3px;background:#1f2937;border-radius:2px;overflow:hidden;width:100%">
      <div id="fill" style="height:100%;background:#4ade80;width:100%;transition:width 3s linear"></div>
    </div>
  </div>
  <script>
    // Instantly notify the opener (Hydra dashboard) — no polling delay
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({
          type: 'hydra:magic-link-done',
          signInId: ${JSON.stringify(signInId)},
          accountId: ${JSON.stringify(pending.accountId)},
          email: ${JSON.stringify(pending.email)},
        }, window.location.origin);
      }
    } catch (e) { /* cross-origin or blocked — fallback is the 5s poller */ }

    // Shrink the progress bar then close
    requestAnimationFrame(() => {
      document.getElementById('fill').style.width = '0%';
    });
    setTimeout(() => window.close(), 3000);
  </script>
</body>
</html>`);
  } catch (err) {
    return res.status(500).send(`
      <html><body style="font-family:monospace;background:#0a0a0a;color:#fff;padding:40px">
        <h2 style="color:#f87171">✗ Sign-In Failed</h2>
        <p>${escapeHtml(err.message)}</p>
        <p style="color:#888">Go back to Hydra and try again.</p>
      </body></html>
    `);
  }
});

export default router;
