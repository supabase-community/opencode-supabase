# Releasing opencode-supabase

Release runbook for maintainers.

This repo uses Changesets and a release PR workflow:

1. Feature PRs add `.changeset/*.md` for user-visible or package-relevant changes.
2. Merges to `main` trigger the release workflow.
3. `changesets/action` opens or updates a release PR.
4. Merging the release PR publishes to npm.

Publish auth uses npm trusted publishing with GitHub OIDC.

This doc also acts as the transfer checklist for moving the repo to `supabase-community`.

## Current Release Model

- Package manager: Bun
- Node version: 24
- Registry: npm
- Versioning and changelog: Changesets
- Publish trigger: merge release PR on `main`
- Release workflow: `.github/workflows/release.yml`
- CI workflow: `.github/workflows/ci.yml`

## OpenCode Compatibility Policy

Supported OpenCode host versions are declared in `.github/opencode-versions.json`:

- `floor`: oldest supported version
- `pinned`: current verified version

The required `tui-e2e` CI job renders the packed plugin in a real OpenCode + tmux host against both versions on every PR. `package-smoke` verifies the Windows install boundary at `pinned`.

A scheduled canary (`.github/workflows/opencode-compatibility-canary.yml`, weekly Monday at 06:17 UTC + manual) runs the TUI harness against a **dynamic frontier matrix** — the last 2 minor lines × the latest 2 patches each (e.g. 1.17.19, 1.17.20, 1.18.3, 1.18.4). It never blocks PRs.

**Manual dispatch** (triggered from the Actions tab) accepts an optional `opencode-version` (exact version or dist-tag like `beta`, `0.0.0-beta-…`, `2.0.0-beta.1`) and an optional `reason` label. When supplied, the dynamic matrix is skipped and a single cell runs against that version. This is the prescribed way to smoke unreleased or snapshot builds before they appear as stable releases. The resolved version, matrix contents, and overall result are surfaced as run annotations, in the step summary, and in the uploaded evidence.

Promotion process when the canary passes on a newer release:

1. Open a PR editing only `.github/opencode-versions.json` (advance `pinned`; advance `floor` only when dropping support intentionally).
2. The required matrix must pass on that PR.
3. Merge advances the supported current version.

If the canary fails on a new release, investigate before users hit it; do not advance `pinned`.

## One-Time Setup

### npm

- Ensure the `opencode-supabase` package is owned by the intended npm maintainer or org.
- Configure npm Trusted Publisher for `opencode-supabase`:
  - Provider: `GitHub Actions`
  - Organization or user: `supabase-community`
  - Repository: `opencode-supabase`
  - Workflow filename: `release.yml`
  - Environment name: leave blank unless GitHub Environment gating is added intentionally
- Ensure npm publish rights are granted to the final maintainer or org setup before release day.
- Trusted publishing requires GitHub-hosted runners.

Quick validation before first release:

- confirm the package name on npm is exactly `opencode-supabase`
- confirm the trusted publisher entry matches `supabase-community/opencode-supabase/.github/workflows/release.yml`
- confirm the package maintainers can publish that package

### GitHub

- Create an organization-owned GitHub App for Changesets. Do not configure a webhook.
- Give the app these repository permissions:

  | Permission | Access | Why |
  | --- | --- | --- |
  | Contents | Read and write | Checkout, push version commits, create release PR branch |
  | Pull requests | Read and write | Create and update the Version Packages PR |

  Metadata read access is included automatically by GitHub. The "Workflows" permission is not needed.

- Install the app on only `supabase-community/opencode-supabase`.
- Generate a private key for the app. Store the app ID as GitHub Actions secret `CHANGESETS_APP_ID` and the full private-key value as `CHANGESETS_APP_PRIVATE_KEY`.
- Why: `GITHUB_TOKEN` pushes from GitHub Actions do not trigger other workflows. The short-lived GitHub App installation token can create the release PR and its updates trigger CI. See [GitHub docs on GITHUB_TOKEN limitations](https://docs.github.com/en/actions/concepts/security/github_token#when-github_token-triggers-workflow-runs).
- Ownership: the app belongs to the organization, so release access does not depend on an individual maintainer account.
- Key rotation:
  1. Generate a new private key for the GitHub App.
  2. Update the `CHANGESETS_APP_PRIVATE_KEY` GitHub Actions secret.
  3. Revoke the old private key in the GitHub App settings.
  4. Re-trigger the Release workflow to verify the new key works.
- Create required labels:
  - `no-changeset` for PRs that should skip Changesets enforcement
- Protect `main`
- Require PR review before merge
- Require status checks before merge:
  - `core`
  - `changeset-check`
- Ensure GitHub Actions are enabled
- Ensure default branch is `main`

Note: the `core` check is the aggregate of the full package boundary (`build-package`, `package-smoke`, and the `tui-e2e` matrix in `.github/workflows/ci.yml`). The context names are unchanged, so existing branch protection already gates all package jobs — no protection update is needed when package jobs are added or renamed, as long as the aggregate keeps `name: core`.

Create the required label with GitHub CLI:

```bash
gh label create "no-changeset" \
  --description "Skip changeset requirement for non-user-visible changes" \
  --color FBCA04
```

If the label already exists, this command will fail; check current labels with:

```bash
gh label list
```

Apply the expected branch protection with GitHub CLI:

```bash
gh api --method PUT repos/<owner>/<repo>/branches/main/protection --input - <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["core", "changeset-check"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": false,
    "require_code_owner_reviews": false,
    "require_last_push_approval": false
  },
  "restrictions": null,
  "required_linear_history": false,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_conversation_resolution": false,
  "lock_branch": false,
  "allow_fork_syncing": false
}
EOF
```

Verify branch protection:

```bash
gh api repos/<owner>/<repo>/branches/main/protection
```

## Contributor Workflow

Add a changeset for user-visible or package-relevant changes:

```bash
bun run changeset
```

Commit the generated `.changeset/*.md` file with the code change.

Use the `no-changeset` label only for changes that should not affect package consumers, for example:

- docs-only updates
- CI-only updates
- internal refactors with no consumer impact
- test-only changes

## Maintainer Workflow

### Normal feature PR

1. Review code and changeset.
2. Merge the PR to `main`.

### Release PR

After merges with pending changesets, GitHub Actions will open or update a release PR.

Review the release PR for:

- expected version bump
- expected `CHANGELOG.md` contents
- no accidental package metadata changes

Merge the release PR to publish to npm.

Expected result:

- npm gets the new version
- git history includes the release commit
- `CHANGELOG.md` updates land in `main`

Note: `CHANGELOG.md` will appear on the first real release PR.

## Required Repo Files

These files must stay aligned:

- `package.json`
- `.changeset/config.json`
- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`

Expected scripts in `package.json`:

```json
{
  "changeset": "changeset",
  "version-packages": "changeset version",
  "release": "changeset publish"
}
```

## Security Posture

Current choice: npm trusted publishing with GitHub OIDC

Auth model: `changesets/action` delegates publish auth to npm trusted publishing during the publish path. The release workflow grants `id-token: write`, uses GitHub-hosted runners, and does not inject `NPM_TOKEN` or commit an `.npmrc`.

Why:

- removes the long-lived npm publish secret from GitHub
- binds publish rights to the exact repo and workflow identity
- enables npm provenance for public publishes from GitHub Actions

Rules:

- keep publish on GitHub-hosted runners
- keep the trusted publisher entry aligned to the exact owner, repo, and workflow filename
- do not add token-based npm publish auth back into the workflow unless there is a deliberate rollback
- publish only from protected `main`
- keep the release PR merge as the approval gate

Optional hardening:

- add a GitHub Environment approval for publish if manual gating is needed
- disable token-based publishing in npm package settings after OIDC is proven in production

## Failure Handling

### Release workflow fails to publish with trusted publishing

- confirm the repo is `supabase-community/opencode-supabase`
- confirm npm Trusted Publisher matches the exact workflow filename `release.yml`
- confirm the job still runs on GitHub-hosted runners
- confirm workflow permissions still include `id-token: write`
- rerun the failed workflow after fixing the configuration mismatch

### PR fails `changeset-check`

- add a real changeset with `bun run changeset`
- or apply `no-changeset` if the PR truly has no consumer-visible impact

### Release PR has no CI checks

- `GITHUB_TOKEN` pushes do not trigger workflows — this is a GitHub Actions limitation
- Verify `CHANGESETS_APP_ID` and `CHANGESETS_APP_PRIVATE_KEY` are configured correctly (see [One-Time Setup > GitHub](#github))
- Re-trigger the Release workflow after fixing the secret

### Bad release PR contents

- do not merge
- fix the source PR or a follow-up PR
- let Changesets regenerate the release PR

### Publish partially failed or version already exists

- inspect workflow logs
- confirm whether npm already has the version
- avoid trying to republish the same version blindly
- fix the root cause, then generate a new release version if needed

## Transfer Checklist: supabase-community

When the repo moves:

- transfer GitHub repository ownership
- update `package.json` repository metadata to `git+https://github.com/supabase-community/opencode-supabase.git`
- verify GitHub Actions remain enabled
- verify the default branch is still `main`
- confirm the GitHub App is installed only on `supabase-community/opencode-supabase` and `CHANGESETS_APP_ID` and `CHANGESETS_APP_PRIVATE_KEY` are configured; see [One-Time Setup > GitHub](#github)
- recreate required labels if missing:
  - `no-changeset`
- reapply branch protection rules
- confirm npm package ownership includes the new maintainers or org
- configure npm Trusted Publisher for `supabase-community/opencode-supabase/release.yml`
- verify workflow permissions still allow release PR creation and publish
- verify `release.yml` auth still works with OIDC and no `NPM_TOKEN`
- run one test release after transfer
- remove the GitHub secret `NPM_TOKEN` if it still exists
- revoke the old npm automation token

Recommended post-transfer label command:

```bash
gh label create "no-changeset" \
  --description "Skip changeset requirement for non-user-visible changes" \
  --color FBCA04
```

Recommended post-transfer branch-protection command:

```bash
gh api --method PUT repos/<owner>/<repo>/branches/main/protection --input - <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["core", "changeset-check"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": false,
    "require_code_owner_reviews": false,
    "require_last_push_approval": false
  },
  "restrictions": null,
  "required_linear_history": false,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_conversation_resolution": false,
  "lock_branch": false,
  "allow_fork_syncing": false
}
EOF
```

## First Release Checklist

- Changesets setup branch merged
- GitHub App installed only on `supabase-community/opencode-supabase`
- `CHANGESETS_APP_ID` and `CHANGESETS_APP_PRIVATE_KEY` configured
- npm Trusted Publisher configured for `supabase-community/opencode-supabase/release.yml`
- `no-changeset` label exists
- branch protection configured
- real bugfix PR includes a real changeset
- bugfix PR merged to `main`
- release PR created automatically
- release PR reviewed
- release PR merged
- npm package version confirmed
- npm provenance confirmed on the published package page

## Beta prerelease

For local-dev beta smoke before a stable release. Uses Changesets prerelease mode under the npm `beta` dist-tag, scoped to a throwaway git worktree so the main working copy is never mutated.

```bash
bun run release:beta
```

### Local npm authorization

Run from an interactive terminal without piping or redirecting output. The publisher inherits stdin, stdout, and stderr so npm can handle browser authorization or prompt for an OTP. Browser authorization is available when the registry returns a web challenge; numeric OTP remains the fallback. Account 2FA stays enabled.

Inside agent-sandbox, use the configured host-browser bridge as npm's browser command:

```bash
npm_config_browser="$PLANNOTATOR_BROWSER" bun run release:beta
```

`PLANNOTATOR_BROWSER` must point to an available executable bridge. The existing Plannotator bridge opens on both the host and the forwarded laptop; use a local-only bridge if authorization should open on one machine only. No browser profile or cookie mount is needed.

### Publish flow

What the script does:

1. Refuses to run in CI or without an interactive TTY.
2. Refuses to run if the working copy is dirty.
3. Snapshots npm `latest` and aborts if it is not a stable version.
4. Creates a detached git worktree off `HEAD`.
5. In the worktree: `bun install`, `changeset pre enter beta`, `version-packages`, then `lint`, `typecheck`, `test`, `verify:pack`.
6. Aborts if the generated version is not a `-beta.*` prerelease.
7. Requires typing `publish beta` before publishing.
8. Publishes with `changeset publish --no-git-tag` (no commit, no push, no git tag).
9. Verifies npm `latest` is unchanged and `beta` points at the new version.
10. Removes the temp worktree.

Expected npm state after a successful run:

```json
{
  "latest": "0.4.2",
  "beta": "0.5.0-beta.0"
}
```

Install the beta to smoke test:

```bash
npm install opencode-supabase@beta
```

### Revert

The main working copy is never touched, so no local revert is needed. If cleanup fails:

```bash
git worktree prune
```

If npm tags are wrong after publish, fix them with:

```bash
npm dist-tag add opencode-supabase@<stable> latest
npm dist-tag add opencode-supabase@<beta> beta
```

npm publishes are irreversible. To hide a bad beta, deprecate it:

```bash
npm deprecate opencode-supabase@0.5.0-beta.0 "Bad beta; use latest stable"
```

After beta smoke passes, publish stable through the normal release PR workflow. The main repo never enters prerelease mode (the temp worktree did), so pending changesets in `main` are still consumed by the Changesets release PR. Do not run `bun run release` directly for the stable release; let the release PR handle it.

## Quick Commands

Create changeset:

```bash
bun run changeset
```

Generate versions and changelog locally:

```bash
bun run version-packages
```

Publish locally if ever needed for debugging only:

```bash
bun run release
```

List current labels:

```bash
gh label list
```
