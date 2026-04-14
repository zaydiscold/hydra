# Refactoring Risk Analysis & Light Pass Notes

## Context
During the "Light Pass" refactoring of the backend controllers (specifically `AccountController.js`), we introduced a global `catchAsync` wrapper in `BaseController` and extracted the `pendingMagicLinks` map into its own manager (`server/services/magic-link-manager.js`).

## Skeptical Analysis: What Can Break?

### 1. `catchAsync` Blanket Rollout Risk
**The Risk:** Removing all `try/catch` blocks blindly from controllers will break heavily customized endpoints. For example, in `AccountController.login` and `AccountController.verifyOTP`, the `catch` blocks are not just returning 500 errors. They contain vital business logic, such as:
- Catching `err.name === 'NeedSecondFactorError'` and returning a specific 202 status to the frontend.
- Appending `clerkDebugOtpExtra()` JSON hints to the response payload for UI debugging.

**The Mitigation (Light Impact):** 
We are **not** applying `catchAsync` universally. We will only apply `catchAsync` to simple, read/write endpoints (e.g., `getAccounts`, `addAccount`, `deleteAccount`) where an error strictly translates to a standard JSON fail response. For complex flow-control endpoints (`login`, `startOTP`), we leave the explicit `try/catch` untouched to guarantee frontend logic doesn't break.

### 2. State Decoupling Risk
**The Risk:** Moving `pendingMagicLinks` and its `setInterval` TTL garbage collector to a lazy-loaded service (`server/services/magic-link-manager.js`).
- If this module is dynamically imported *only* when a magic-link callback is hit, the 15-minute cleanup interval won't start until the first user invokes it. 
- While harmless (the map will just sit empty until then), it changes the boot sequence slightly compared to when `AccountController.js` loaded on application start.

**The Mitigation:** This is perfectly fine. Lazy loading side-effects is actually better for boot times, and since no items enter the map until `sendMagicLink` runs (which also imports the manager), the garbage collection loop is guaranteed to be running when items actually exist.

### 3. Frontend Prop Drilling & Component Extraction
**The Risk:** Moving Modals out of `PoolManager.jsx` into separate files might break state updates if we don't pass down `refresh()` or setter methods correctly.
**The Mitigation:** Since we haven't done this yet, we will ensure that any extracted component explicitly receives its required state mutators via props before deleting the inline code. 

## Git Log Summary
These changes represent safe, atomic commits. The extraction of standard routes to `catchAsync` reduces thousands of repetitive boilerplate lines over time while preserving complex business logic.
