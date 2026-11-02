# Release business gate

GitHub does not reset running services when code is fetched. Deployment of a different/older artifact can remove already-delivered features. Keep source revision, build directory, compile parameters, artifact digest and live verification tied to a release.

Use the openelfai repository. The validated integration line is codex/integrate-latest-20261030; main has diverged with a different web recharge implementation. Do not replace either side wholesale or claim the branches are reconciled. Review API protocol, account/environment isolation, checkout application routing and pending orders before merging. Integration changes do not automatically update production or the private iOS builder repository.

The Business continuity workflow runs source-contract checks, server payment/security tests, all client VM tests, a real web build and compiled-bundle recharge/captcha checks. It needs no production secrets and does not deploy or take payment. Keep the iOS StoreKit entry, Android Alipay entry, web diamond/API-topup entries and enforced web captcha default. A deliberate implementation redesign requires equivalent tests and review, not simply deleting the guard.

Before deploying web, require a green Business continuity result for the exact commit, use the checked artifact/build parameters, then run the scoped installer --check and --install. The installer backs up the current site and validates public hashes; it does not change payments, environment files, database or Nginx. Signed mobile packages remain separate releases. Recheck logged-in product lists, balances and checkout handoff on each relevant platform; CI does not certify live payment settlement.

Repository owners must select this workflow's business-continuity check as required in the main branch protection/ruleset, forbid direct pushes and require review. Adding a workflow alone cannot block administrators, local uploads or legacy deployment scripts. This task does not change repository protection settings or auto-merge a PR. Do not use git reset --hard, force-push or overwrite an entire server checkout to deploy a partial fix.

The Media3 1.12.0-alpha02 override is explicitly test-only (OPENELF_MEDIA3_RETRY_TEST=true); ordinary builds do not enable it. Do not silently turn a playback experiment into a production dependency upgrade.
