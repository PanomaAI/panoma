## What changes

<!-- One sentence: what does this change make possible or correct? -->

## Why

<!-- Describe the problem rather than the implementation. Link the issue with "Closes #12". -->

## Evidence

<!--
  Tell a reviewer how to verify the change: exact commands, the manual path, the test that
  fails when the change is reverted, and the operating system you used. For a visual change,
  attach before and after images.
-->

## Before requesting review

- [ ] `pnpm lint` passes
- [ ] `pnpm -r typecheck` passes
- [ ] `pnpm test` passes
- [ ] Every promise introduced by this change has a test that fails when it stops being true
- [ ] New interface copy goes through `apps/web/lib/i18n.ts` in both languages
- [ ] New identifiers and repository prose are in English
- [ ] I signed the [CLA](../blob/HEAD/CLA.md), or I will sign it in this pull request with the required comment
