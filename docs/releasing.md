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

- Create a fine-grained personal access token for changesets:
  - Go to GitHub Settings > Developer settings > Fine-grained tokens
  - Repository access: only this repository
  - Token expiration: maximum allowed (1 year). Set a calendar reminder to renew at ~10 months.
  - Permissions:

    | Permission    | Access       | Why                                                      |
    | ------------- | ------------ | -------------------------------------------------------- |
    | Contents      | Read and write | Checkout, push version commits, create release PR branch |
    | Pull requests | Read and write | Create and update the Version Packages PR                |
    | Metadata      | Read         | Required by GitHub for all API access                    |

    Note: The "Workflows" permission is **not** needed. Only the built-in `GITHUB_TOKEN` cannot trigger other workflows; a PAT push triggers CI automatically.

  - Add the token as GitHub Actions secret `CHANGESETS_TOKEN`
  - Why: `GITHUB_TOKEN` pushes from GitHub Actions do not trigger other workflows. The changesets release PR would never get CI checks without a separate token. See [GitHub docs on GITHUB_TOKEN limitations](https://docs.github.com/en/actions/concepts/security/github_token#when-github_token-triggers-workflow-runs).
  - Ownership: the token is tied to the GitHub account that created it. If that account leaves the org or is deactivated, the token stops working immediately. Prefer creating the token from a shared bot account or a team-owned account. If neither is available, document which maintainer owns the token and track renewal in a shared calendar.
  - Renewal steps:
    1. Create a new fine-grained PAT with the same permissions listed above.
    2. Update the `CHANGESETS_TOKEN` GitHub Actions secret with the new value.
    3. Delete the old token in GitHub Settings > Developer settings > Fine-grained tokens.
    4. Re-trigger the Release workflow to verify the new token works.
- Create required labels:
  - `no-changeset` for PRs that should skip Changesets enforcement
- Protect `main`
- Require PR review before merge
- Require status checks before merge:
  - `core`
  - `changeset-check`
- Ensure GitHub Actions are enabled
- Ensure default branch is `main`

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
- Verify `CHANGESETS_TOKEN` is configured correctly (see [One-Time Setup > GitHub](#github))
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
- recreate `CHANGESETS_TOKEN` fine-grained PAT (the old token is scoped to the original repo and will not transfer); see [One-Time Setup > GitHub](#github) for required permissions and creation steps
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
- `CHANGESETS_TOKEN` configured
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
