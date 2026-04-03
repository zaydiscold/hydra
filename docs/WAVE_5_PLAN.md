- **Action**: Upgrade to a "staggered matrix-lock" effect. The text will scramble globally, but characters will lock into their final correct state from left-to-right progressively, creating a much higher-end cyberpunk feel.

## 5. Global Loading Indicator (NProgress-style)
- **Action**: Add an ultra-thin, glowing line at the absolute top of the viewport that streaks across when any `api.*` request is pending, providing deep system feedback even when local spinners aren't visible.

## 6. Future Epic: Native App Wrapper (Electron/Tauri)
Because Hydra uses Playwright for invisible automated OTP flows, it requires a Node.js backend to bypass Cloudflare. However, running a terminal daemon is neither elegant nor user-friendly.
- **Action**: Package the Express backend and React frontend into a unified `.app` native binary using Electron (or Tauri). 
- **UX**: The app sits in the Mac Dock. Clicking it automatically spins up the isolated SQLite database and backend in a hidden Node process, then opens the beautiful native React window. Cmd+Q safely spins everything down. Zero terminals, zero browser tabs, 100% local database security.
