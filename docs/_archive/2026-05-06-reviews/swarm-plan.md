# Phase 2 Swarm Attack Plan
# 5 agents, 5 parallel worktrees, 5 domains
# All agents read .swarm-working.md + this plan on start

## AGENT ASSIGNMENTS

### A1 — Manifest: Error States & Crash Recovery (#76-#85, #57, #92, #93)
**Branch**: swarm/p2-a1-recovery
**Worktree**: ~/Desktop/hydra-wt-p2-a1
**Findings**: 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 92, 93, 57
**Focus**: Port 3001 crash, network offline recovery, DB read-only detection, disk full handling, chromium/prisma engine missing detection, JWT secret hardening, multi-instance lock, schema sync errors, error boundary polish

### A2 — Manifest: Security & Lifecycle (#83, #84, #85, #88, #75, #92, #50, #51, #55)
**Branch**: swarm/p2-a2-security
**Worktree**: ~/Desktop/hydra-wt-p2-a2
**Findings**: 83, 84, 85, 88, 75 (Windows SIGTERM), 92 (isPidAlive Windows), 50, 51, 55, 56
**Focus**: JWT validation, DATABASE_URL hardening, multi-instance lock, API shutdown rate limit, Windows compat fixes, file permission hardening

### A3 — Manifest: Packaging & DX (#95, #96, #97, #98, #102, #103, #104, #76, #82, #84)
**Branch**: swarm/p2-a3-packaging
**Worktree**: ~/Desktop/hydra-wt-p2-a3
**Findings**: 95 (remove chromium from bundle), 96 (vite optimization), 97 (startup timing), 98 (lazy imports), 102, 103 (unused assets), 104 (log level), 76 (hot reload), 82 (VITE_DEV_SERVER_URL), 84 (sourcemap), 85 (log tail)
**Focus**: Reduce .dmg from 612MB, vite vendor chunking, startup instrumentation, log trimming, dev DX improvements

### A4 — Manifest: UX/UI Polish (#58-#74, #61)
**Branch**: swarm/p2-a4-ux
**Worktree**: ~/Desktop/hydra-wt-p2-a4
**Findings**: 57 (error boundary), 58 (light mode), 59 (keyboard shortcuts), 60 (about panel), 61 (tray icon), 62-74 (a11y, nuke button, password reveal, tray updates, etc.)
**Focus**: Light mode theme, keyboard shortcuts in menu, custom About panel, accessibility fixes, tray polish

### A5 — Manifest: Cross-Platform + Skeptical Validation (#86-#93, #75-#93)
**Branch**: swarm/p2-a5-crossplat
**Worktree**: ~/Desktop/hydra-wt-p2-a5
**Findings**: 86-93 (cross-platform bugs), validation pass on ALL findings
**Focus**: Windows UNC paths, Linux xdg-open, Windows LOCALAPPDATA fallback, npm scripts organization, test gaps, validate all other agents' fixes, add tests

## RULES
1. ALL agents read .swarm-working.md AND .swarm-plan.md on start
2. Each agent works in their OWN worktree (git worktree add)
3. Each agent commits to their OWN branch
4. Mark findings DONE in .swarm-working.md as you fix them
5. Run `npm run gate` after EACH commit
6. Add tests alongside fixes
7. No overlap — if another agent owns a finding, skip it
8. On completion: cherry-pick everything to master, run full test suite, merge

## TEST REQUIREMENTS
- Between each fix: `node --check` on changed files
- After each commit: `npm run gate`
- After all fixes: full test suite (`npm run test:electron-*`)
- If electron-launch-compat fails with ESM export error, use dynamic import

## SHARED DOCS
- .swarm-working.md — the bug list (in the main repo, readable from all worktrees)
- .swarm-plan.md — this file
