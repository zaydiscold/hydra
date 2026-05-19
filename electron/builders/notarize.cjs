/**
 * electron-builder afterSign hook — submits the freshly-signed macOS .app
 * to Apple's notary service via @electron/notarize.
 *
 * REQUIRED environment variables (only when actually signing):
 *   APPLE_ID                       Apple ID email
 *   APPLE_APP_SPECIFIC_PASSWORD    https://appleid.apple.com → Security → App-Specific Passwords
 *   APPLE_TEAM_ID                  10-char Team ID from Apple Developer portal
 *
 * If APPLE_ID is unset (e.g. a contributor running a local unsigned build,
 * or CI without secrets), this hook logs a single warning and returns —
 * the build still produces a working .app, just one Gatekeeper will warn
 * about on first launch.
 *
 * This is a CommonJS file (.cjs) because electron-builder's afterSign
 * resolution doesn't follow ESM `package.json#exports` correctly across
 * versions. Keeping it CJS dodges that footgun without forcing the rest
 * of the codebase off ESM.
 *
 * Verify the result after a successful build:
 *   codesign -dvv release/mac-arm64/Hydra.app
 *   spctl --assess --verbose=4 release/mac-arm64/Hydra.app
 *   xcrun stapler validate release/mac-arm64/Hydra.app
 */

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appName = context.packager.appInfo.productFilename;
  const appPath = `${context.appOutDir}/${appName}.app`;

  if (process.env.HYDRA_SKIP_NOTARIZE === '1') {
    console.log('[notarize] HYDRA_SKIP_NOTARIZE=1 set — skipping');
    return;
  }
  if (!process.env.APPLE_ID || !process.env.APPLE_APP_SPECIFIC_PASSWORD || !process.env.APPLE_TEAM_ID) {
    if (process.env.HYDRA_SKIP_ADHOC_SIGN !== '1') {
      const { execFileSync } = require('node:child_process');
      console.warn(
        '[notarize] Missing Apple signing credentials — applying local ad-hoc signature ' +
        'so the unpacked .app has a valid bundle signature for local dogfood.'
      );
      execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
    }
    console.warn(
      '[notarize] Missing APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID — ' +
      'skipping notarization. The .app will still build, but Gatekeeper will warn on first launch. ' +
      'Set HYDRA_SKIP_NOTARIZE=1 to silence this message.'
    );
    return;
  }
  // Lazy-require so contributors who don't notarize never need the dep on PATH.
  const { notarize } = require('@electron/notarize');
  const appBundleId = (context.packager && context.packager.config && context.packager.config.appId) || 'com.zayd.hydra';

  console.log(`[notarize] Submitting ${appPath} to Apple Notary Service...`);
  const started = Date.now();
  await notarize({
    tool: 'notarytool',
    appBundleId,
    appPath,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
  });
  console.log(`[notarize] Notarization succeeded in ${((Date.now() - started) / 1000).toFixed(1)}s`);
};
