# WeChat Mini Program Release Playbook

## Current status

- Current uploaded version: `0.1.6`
- Upload time: `2026-04-22` (Asia/Shanghai)
- Current backend state: development version `0.1.6` has been uploaded and is waiting for manual review submission in `版本管理`
- Current repo upload command:

```bash
npm run upload:miniprogram -- <version> "<description>"
```

## What to do right now

1. Open the WeChat mini program backend `版本管理`.
2. Find development version `0.1.6`.
3. Confirm the version description is the release you want to review.
4. Submit `0.1.6` for review manually.

## If the review is approved

1. Open WeChat mini program backend `版本管理`.
2. Confirm version `0.1.6` is marked as approved.
3. Click the publish or release action for the approved version.
4. Verify the online version by opening the mini program from WeChat and checking:
   - home timer page loads correctly
   - photo upload works
   - session completion works
   - calendar heatmap updates after a completed session
   - public profile page can be opened after login
5. Record the publish time and keep the matching GitHub commit for traceability.

## If the review is rejected

1. Open the reject details in WeChat backend and copy the exact rejection reason.
2. Fix the issue in this repo.
3. Re-run verification:

```bash
npm test
npm run typecheck
npm run build:server
```

4. Upload a new development version:

```bash
npm run upload:miniprogram -- <new-version> "<new-description>"
```

5. Re-submit the new version from WeChat backend.

## If release is blocked after approval

If WeChat still blocks publishing after the code review passes, check these platform items first:

- WeChat account verification status
- mini program filing or record status
- required app profile fields such as name, icon, and description
- required category completeness

Follow the exact prompt shown in the backend before retrying release.

## Recommended versioning rule

- Patch release for fixes during review: `0.1.6`, `0.1.7`
- Minor release for new user-facing functionality: `0.2.0`, `0.3.0`

## Release checklist

- `npm test` passes
- `npm run typecheck` passes
- `npm run build:server` passes
- cloud service is healthy
- database and object storage environment variables are present
- uploaded mini program version matches the intended GitHub commit
- WeChat backend shows the expected version description
