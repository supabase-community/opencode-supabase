/**
 * Local-dev beta prerelease publisher.
 *
 * Runs the full Changesets prerelease flow in a throwaway git worktree so the
 * main working copy is never mutated. Publishes under the npm `beta` dist-tag
 * and verifies `latest` is unchanged afterwards.
 *
 * Usage: bun run release:beta
 *
 * Guards:
 *   - refuses to run in CI
 *   - refuses to run without an interactive TTY
 *   - refuses to run if the working copy is dirty
 *   - refuses to run if npm `latest` is not a stable (non-prerelease) version
 *   - aborts if the generated version is not a `-beta.*` prerelease
 *   - requires typed confirmation before publishing
 *   - never commits, pushes, or creates git tags (--no-git-tag)
 */

import { $ } from "bun";

const CONFIRM_PHRASE = "publish beta";
const PACKAGE_NAME = "opencode-supabase";

class ReleaseBetaError extends Error {}

function abort(message: string): never {
  throw new ReleaseBetaError(message);
}

function utcTimestamp(date: Date): string {
  const year = date.getUTCFullYear().toString().padStart(4, "0");
  const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = date.getUTCDate().toString().padStart(2, "0");
  const hour = date.getUTCHours().toString().padStart(2, "0");
  const minute = date.getUTCMinutes().toString().padStart(2, "0");
  const second = date.getUTCSeconds().toString().padStart(2, "0");
  return `${year}${month}${day}t${hour}${minute}${second}z`;
}

export function makeTimestampedBetaVersion(
  generatedVersion: string,
  date: Date,
  shortSha: string,
): string {
  const match = /^(?<base>\d+\.\d+\.\d+)-beta\.\d+$/.exec(generatedVersion);
  if (!match?.groups?.base) {
    abort(`generated version "${generatedVersion}" is not a -beta.<number> prerelease`);
  }
  return `${match.groups.base}-beta.${utcTimestamp(date)}.sha.g${shortSha}`;
}

type DistTags = Record<string, string>;

type WaitForBetaDistTagOptions = {
  expectedBeta: string;
  expectedLatest: string;
  readTags: () => Promise<DistTags>;
  sleep: (ms: number) => Promise<void>;
  timeoutMs: number;
  intervalMs: number;
};

export async function waitForBetaDistTag({
  expectedBeta,
  expectedLatest,
  readTags,
  sleep,
  timeoutMs,
  intervalMs,
}: WaitForBetaDistTagOptions): Promise<DistTags> {
  const deadline = Date.now() + timeoutMs;
  let tags = await readTags();
  while (tags.beta !== expectedBeta && tags.latest === expectedLatest && Date.now() < deadline) {
    await sleep(intervalMs);
    tags = await readTags();
  }
  return tags;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function npmDistTags(): Promise<Record<string, string>> {
  const out = await $`npm view ${PACKAGE_NAME} dist-tags --json --silent`.text();
  return JSON.parse(out) as Record<string, string>;
}

async function gitIsClean(cwd: string): Promise<boolean> {
  const status = await $`git status --porcelain`.cwd(cwd).text();
  return status.trim() === "";
}

async function runVerify(cwd: string): Promise<void> {
  console.log("\n— lint");
  await $`bun run lint`.cwd(cwd).quiet();
  console.log("— typecheck");
  await $`bun run typecheck`.cwd(cwd).quiet();
  console.log("— test");
  await $`bun run test`.cwd(cwd).quiet();
  console.log("— verify:pack");
  await $`bun run verify:pack`.cwd(cwd).quiet();
}

async function main() {
  if (process.env.CI) abort("refusing to run in CI; beta publishes are local-dev only");
  if (!process.stdin.isTTY) abort("refusing to run without an interactive TTY");

  const repoRoot = (await $`git rev-parse --show-toplevel`.text()).trim();

  if (!(await gitIsClean(repoRoot))) {
    abort("working copy is dirty; commit or stash before running release:beta");
  }

  // Snapshot npm state before doing anything.
  const beforeTags = await npmDistTags();
  const latestBefore = beforeTags.latest;
  if (!latestBefore || /-/.test(latestBefore)) {
    abort(`npm latest is "${latestBefore}", expected a stable version; aborting`);
  }
  console.log(`npm latest before: ${latestBefore}`);

  if (beforeTags.beta) {
    console.log(`npm beta before:   ${beforeTags.beta}`);
  }

  // Throwaway worktree off HEAD so the main working copy stays untouched.
  const tmp = (await $`mktemp -d`.text()).trim();
  console.log(`\ntemp worktree: ${tmp}`);

  let publishAttempted = false;
  try {
    await $`git worktree add --detach ${tmp} HEAD`.quiet();
    await $`bun install --frozen-lockfile`.cwd(tmp).quiet();

    console.log("\n— changeset pre enter beta");
    await $`bun run changeset pre enter beta`.cwd(tmp).quiet();

    console.log("— version-packages");
    await $`bun run version-packages`.cwd(tmp).quiet();

    const packageJsonFile = Bun.file(`${tmp}/package.json`);
    const pkg = JSON.parse(await packageJsonFile.text()) as { version: string };
    const generatedVersion = pkg.version;
    console.log(`generated version: ${generatedVersion}`);

    const shortSha = (await $`git rev-parse --short=12 HEAD`.cwd(tmp).text()).trim();
    const newVersion = makeTimestampedBetaVersion(generatedVersion, new Date(), shortSha);
    pkg.version = newVersion;
    await Bun.write(`${tmp}/package.json`, `${JSON.stringify(pkg, null, 2)}\n`);
    console.log(`timestamped beta version: ${newVersion}`);

    if (beforeTags.beta === newVersion) {
      abort(`npm beta already points at ${newVersion}; bump prerelease before publishing`);
    }

    await runVerify(tmp);

    console.log(`\nAbout to publish ${PACKAGE_NAME}@${newVersion} under the npm "beta" dist-tag.`);
    console.log(`Type exactly: ${CONFIRM_PHRASE}`);
    const answer = (prompt("> ") ?? "").trim();
    if (answer !== CONFIRM_PHRASE) {
      abort("confirmation mismatch; aborting before publish");
    }

    console.log("\n— publish (no git tag)");
    publishAttempted = true;
    try {
      await $`bun run release -- --no-git-tag`.cwd(tmp);
    } catch (publishErr) {
      // npm publish is irreversible; the CLI may error after the registry
      // accepted the package. Probe dist-tags before deciding next steps.
      console.error("\nrelease:beta: publish command failed; probing npm state.");
      let probed: Record<string, string>;
      try {
        probed = await npmDistTags();
      } catch (probeErr) {
        abort(
          `publish command failed and npm dist-tag probe failed; state unknown. Inspect npm manually before retrying. Underlying error: ${
            publishErr instanceof Error ? publishErr.message : String(publishErr)
          }; probe error: ${probeErr instanceof Error ? probeErr.message : String(probeErr)}`,
        );
      }
      probed = await waitForBetaDistTag({
        expectedBeta: newVersion,
        expectedLatest: latestBefore,
        readTags: npmDistTags,
        sleep,
        timeoutMs: 90_000,
        intervalMs: 5_000,
      });
      const betaOk = probed.beta === newVersion;
      const latestOk = probed.latest === latestBefore;
      const publishErrMsg = publishErr instanceof Error ? publishErr.message : String(publishErr);
      if (betaOk && latestOk) {
        abort(
          `publish command failed but npm beta is already ${newVersion} and latest is unchanged; do NOT retry. Inspect npm and smoke test opencode-supabase@${newVersion}. Underlying error: ${publishErrMsg}`,
        );
      }
      if (betaOk && !latestOk) {
        abort(
          `publish command failed; npm beta is ${newVersion} but latest drifted to ${probed.latest}. Restore with: npm dist-tag add ${PACKAGE_NAME}@${latestBefore} latest; then smoke test opencode-supabase@${newVersion}. Underlying error: ${publishErrMsg}`,
        );
      }
      if (!betaOk && latestOk) {
        abort(
          `publish command failed; npm beta is "${probed.beta}", expected "${newVersion}". Inspect npm before retrying. Underlying error: ${publishErrMsg}`,
        );
      }
      abort(
        `publish command failed; npm beta is "${probed.beta}" (expected "${newVersion}") and latest is "${probed.latest}" (expected "${latestBefore}"). Inspect npm before retrying. Underlying error: ${publishErrMsg}`,
      );
    }

    const afterTags = await waitForBetaDistTag({
      expectedBeta: newVersion,
      expectedLatest: latestBefore,
      readTags: npmDistTags,
      sleep,
      timeoutMs: 90_000,
      intervalMs: 5_000,
    });
    console.log(`\nnpm latest after:  ${afterTags.latest}`);
    console.log(`npm beta after:    ${afterTags.beta}`);

    if (afterTags.latest !== latestBefore) {
      abort(
        `npm latest changed from ${latestBefore} to ${afterTags.latest}; ` +
          `restore with: npm dist-tag add ${PACKAGE_NAME}@${latestBefore} latest`,
      );
    }
    if (afterTags.beta !== newVersion) {
      abort(
        `npm beta is "${afterTags.beta}", expected "${newVersion}"; ` +
          `fix with: npm dist-tag add ${PACKAGE_NAME}@${newVersion} beta`,
      );
    }
    console.log("latest unchanged, beta points at new version. OK.");
  } finally {
    if (publishAttempted) {
      // publish already ran; surface guidance if cleanup itself fails
      try {
        await $`git worktree remove ${tmp} --force`.quiet();
      } catch {
        console.error(
          `release:beta: cleanup failed; worktree may remain at ${tmp}. Run: git worktree prune`,
        );
      }
    } else {
      try {
        await $`git worktree remove ${tmp} --force`.quiet();
      } catch {
        // worktree may already be gone or removal failed; prune below
      }
    }
    await $`git worktree prune`.quiet().catch(() => {
      console.error("release:beta: git worktree prune failed; stale worktree entries may remain.");
    });
    console.log("\ncleaned up temp worktree.");
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (err) {
    if (err instanceof ReleaseBetaError) {
      console.error(`release:beta: ${err.message}`);
    } else {
      console.error("\nrelease:beta: unexpected failure:");
      console.error(err instanceof Error ? err.message : String(err));
    }
    process.exitCode = 1;
  }
}
