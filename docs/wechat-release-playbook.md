# WeChat Mini Program Release Playbook

## Current Status

- Current uploaded version: `0.1.11`
- Upload time: `2026-04-24` (Asia/Shanghai)
- Uploaded commit: `1ed3150`
- Current backend state: development version `0.1.11` has been uploaded and is waiting for manual review submission in Version Management.
- Current repo upload command:

```bash
npm run upload:miniprogram -- <version> "<description>"
```

## What To Do Right Now

1. Open the WeChat mini program backend Version Management page.
2. Find development version `0.1.11`.
3. Confirm the description is `Fix request-domain startup and calendar fallback`.
4. Submit `0.1.11` for review manually.

## If The Review Is Approved

1. Open the WeChat mini program backend Version Management page.
2. Confirm version `0.1.11` is marked as approved.
3. Click the publish or release action for the approved version.
4. Verify the online version by opening the mini program from WeChat and checking:
   - home timer page loads correctly
   - photo upload works
   - session completion works
   - calendar heatmap updates after a completed session
   - calendar day details still show records if photo temporary URLs fail
5. Record the publish time and keep the matching GitHub commit for traceability.

## If The Review Is Rejected

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

## If Release Is Blocked After Approval

If WeChat still blocks publishing after the code review passes, check these platform items first:

- WeChat account verification status
- mini program filing or record status
- required app profile fields such as name, icon, and description
- required category completeness

Follow the exact prompt shown in the backend before retrying release.

## Recommended Versioning Rule

- Patch release for fixes during review: `0.1.11`, `0.1.12`
- Minor release for new user-facing functionality: `0.2.0`, `0.3.0`

## Release Checklist

- `npm test` passes
- `npm run typecheck` passes
- `npm run build:server` passes
- cloud service is healthy
- database and object storage environment variables are present
- uploaded mini program version matches the intended GitHub commit
- WeChat backend shows the expected version description
