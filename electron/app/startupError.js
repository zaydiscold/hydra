/**
 * Hydra Startup Error Dialog
 *
 * Replaces `dialog.showErrorBox` with a richer modal that gives the user
 * actionable next steps when the app fails to bootstrap:
 *
 *   • "Open Logs Folder" — reveals the log dir in Finder/Explorer
 *   • "Copy Details"     — pushes a redacted error blob to the clipboard
 *                          so the user can paste it into a support ticket
 *   • "Quit"             — closes the dialog and exits
 *
 * Without this, a packaged user who hits a corrupt SQLite file or an
 * EADDRINUSE on first boot just sees "Hydra Startup Error: ..." and has
 * nowhere to take the error. The plumbing for `shell.openPath(logs)` and
 * `clipboard.writeText` already exists (tray menu / other handlers); this
 * surface unifies them in the one place where users actually need them.
 *
 * The dialog re-shows itself after Open Logs / Copy Details so the user
 * can do both before quitting. Picking "Quit" (or closing via Esc) breaks
 * the loop.
 */
import { app, clipboard, dialog, shell } from 'electron';

/** @typedef {{ message: string, stack?: string|null, phase?: string }} StartupErrorInfo */

/**
 * Build the multi-line text we copy to the clipboard. Includes platform,
 * version, phase, error message, and stack — same shape the support
 * bundle elsewhere uses. Redacts nothing (a startup failure rarely
 * contains user data) but call sites should avoid passing tokens.
 *
 * @param {StartupErrorInfo} info
 * @returns {string}
 */
function formatErrorBundle(info) {
  const lines = [
    '=== Hydra Startup Error ===',
    `When:     ${new Date().toISOString()}`,
    `Version:  ${app.getVersion()}`,
    `Electron: ${process.versions.electron}`,
    `Node:     ${process.versions.node}`,
    `OS:       ${process.platform} ${process.arch}`,
    `Phase:    ${info.phase || 'unknown'}`,
    '',
    'Message:',
    `  ${info.message || '(none)'}`,
  ];
  if (info.stack) {
    lines.push('', 'Stack:', info.stack.split('\n').map((l) => `  ${l}`).join('\n'));
  }
  return lines.join('\n');
}

/**
 * Show the startup-error dialog and resolve when the user picks Quit.
 * Open-Logs and Copy-Details actions re-prompt the dialog so the user
 * can chain them.
 *
 * @param {StartupErrorInfo} info
 */
export async function showStartupErrorDialog(info) {
  const detail = info.message || '(no details)';
  const bundle = formatErrorBundle(info);

  // Loop until the user picks Quit (button index 0) or closes the dialog.
  // We use cancelId=0 so Esc / X also quits.
  for (;;) {
    let response;
    try {
      ({ response } = await dialog.showMessageBox({
        type: 'error',
        title: 'Hydra — Startup Failed',
        message: 'Hydra was unable to start.',
        detail: `${detail}\n\nUse the buttons below to investigate before quitting.`,
        buttons: ['Quit', 'Open Logs Folder', 'Copy Details'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      }));
    } catch (e) {
      // Dialog itself failed (rare — e.g. app destroyed mid-prompt). Fall
      // through to console + return so the caller can still call app.quit().
      console.error('[startupError] dialog rejected:', e?.message || e);
      console.error('[startupError] details:\n' + bundle);
      return;
    }
    // Guard: a malformed dialog return (no `response` field) shouldn't
    // silently fall through to "Quit" — log and exit the loop so the caller
    // can decide what to do. Theoretically only possible if the dialog API
    // changes shape; cheap insurance.
    if (response === undefined) {
      console.error('[startupError] dialog returned no response — aborting prompt loop');
      console.error('[startupError] details:\n' + bundle);
      return;
    }

    if (response === 1) {
      // Open Logs Folder — best-effort; app.getPath('logs') is set after
      // electron-log initializes, but even pre-init Electron returns a
      // platform default (~/Library/Logs/Hydra on macOS).
      try {
        await shell.openPath(app.getPath('logs'));
      } catch (e) {
        console.error('[startupError] open logs failed:', e?.message || e);
        await dialog.showMessageBox({
          type: 'error',
          title: 'Hydra',
          message: 'Failed to open logs folder.',
          detail: String(e?.message || e || 'Unknown error'),
          buttons: ['OK'],
          defaultId: 0,
        });
      }
      continue;
    }

    if (response === 2) {
      let copied = false;
      try {
        clipboard.writeText(bundle);
        copied = true;
      } catch (e) {
        console.error('[startupError] copy details failed:', e?.message || e);
      }
      await dialog.showMessageBox({
        type: copied ? 'info' : 'error',
        title: 'Hydra',
        message: copied ? 'Error details copied to clipboard.' : 'Failed to copy error details.',
        detail: copied
          ? 'Paste this into a support ticket or GitHub issue. The clipboard contents include version, platform, phase, message, and stack.'
          : 'Use Open Logs Folder or copy the console output from the terminal that launched Hydra.',
        buttons: ['OK'],
        defaultId: 0,
      });
      continue;
    }

    // response === 0 (Quit) or dialog dismissed — break and let caller exit.
    return;
  }
}
