import { describe, expect, spyOn, test } from "bun:test";

import { BETA_DIST_TAG_TIMEOUT_MS, makeTimestampedBetaVersion, waitForBetaDistTag } from "../scripts/release-beta";

describe("release beta version suffix", () => {
  test("replaces changesets beta counter with UTC datetime and git SHA", () => {
    const date = new Date("2026-06-30T14:30:15Z");

    expect(makeTimestampedBetaVersion("0.5.0-beta.0", date, "abcdef123456")).toBe(
      "0.5.0-beta.20260630t143015z.sha.gabcdef123456",
    );
  });

  test("preserves changesets semantic base version", () => {
    const date = new Date("2026-06-30T14:30:15Z");

    expect(makeTimestampedBetaVersion("1.0.0-beta.0", date, "123456abcdef")).toBe(
      "1.0.0-beta.20260630t143015z.sha.g123456abcdef",
    );
  });

  test("uses lowercase timestamp identifiers for installer compatibility", () => {
    const date = new Date("2026-06-30T14:30:15Z");

    expect(makeTimestampedBetaVersion("0.5.0-beta.0", date, "abcdef123456")).not.toMatch(
      /[A-Z]/,
    );
  });

  test("rejects non changesets beta prerelease versions", () => {
    const date = new Date("2026-06-30T14:30:15Z");

    expect(() => makeTimestampedBetaVersion("0.5.0", date, "abcdef123456")).toThrow(
      'generated version "0.5.0" is not a -beta.<number> prerelease',
    );
  });
});

describe("release beta dist-tag polling", () => {
  test("waits through stale beta dist-tag reads after publish", async () => {
    const reads = [
      { latest: "0.4.2", beta: "0.5.0-beta.0" },
      { latest: "0.4.2", beta: "0.5.0-beta.0" },
      { latest: "0.4.2", beta: "0.5.0-beta.20260630t143015z.sha.gabcdef123456" },
    ];
    const sleeps: number[] = [];

    const result = await waitForBetaDistTag({
      expectedBeta: "0.5.0-beta.20260630t143015z.sha.gabcdef123456",
      expectedLatest: "0.4.2",
      readTags: async () => reads.shift() ?? { latest: "0.4.2", beta: "stale" },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      timeoutMs: 5_000,
      intervalMs: 1_000,
    });

    expect(result).toEqual({
      latest: "0.4.2",
      beta: "0.5.0-beta.20260630t143015z.sha.gabcdef123456",
    });
    expect(sleeps).toEqual([1_000, 1_000]);
  });

  test("production polling budget tolerates two-minute npm processing after a successful publish", async () => {
    const expectedBeta = "0.5.0-beta.20260630t143015z.sha.gabcdef123456";
    let elapsed = 0;
    const clock = spyOn(Date, "now").mockImplementation(() => elapsed);
    try {
      const result = await waitForBetaDistTag({
        expectedBeta,
        expectedLatest: "0.4.2",
        readTags: async () => ({
          latest: "0.4.2",
          beta: elapsed >= 120_000 ? expectedBeta : "0.5.0-beta.0",
        }),
        sleep: async (ms) => { elapsed += ms; },
        timeoutMs: BETA_DIST_TAG_TIMEOUT_MS,
        intervalMs: 5_000,
      });

      expect(result.beta).toBe(expectedBeta);
      expect(elapsed).toBe(120_000);
    } finally {
      clock.mockRestore();
    }
  });

  test("stops polling immediately if latest changes", async () => {
    const changed = { latest: "0.5.0-beta.0", beta: "0.5.0-beta.0" };
    let reads = 0;
    const sleeps: number[] = [];
    const result = await waitForBetaDistTag({
      expectedBeta: "new-beta",
      expectedLatest: "0.4.2",
      readTags: async () => {
        reads++;
        return changed;
      },
      sleep: async (ms) => { sleeps.push(ms); },
      timeoutMs: BETA_DIST_TAG_TIMEOUT_MS,
      intervalMs: 5_000,
    });

    expect(result).toEqual(changed);
    expect(reads).toBe(1);
    expect(sleeps).toEqual([]);
  });

  test("stops at the deadline if npm beta never changes", async () => {
    const stale = { latest: "0.4.2", beta: "0.5.0-beta.0" };
    let elapsed = 0;
    const clock = spyOn(Date, "now").mockImplementation(() => elapsed);
    try {
      const result = await waitForBetaDistTag({
        expectedBeta: "new-beta",
        expectedLatest: "0.4.2",
        readTags: async () => stale,
        sleep: async (ms) => { elapsed += ms; },
        timeoutMs: BETA_DIST_TAG_TIMEOUT_MS,
        intervalMs: 5_000,
      });

      expect(result).toEqual(stale);
      expect(elapsed).toBe(BETA_DIST_TAG_TIMEOUT_MS);
    } finally {
      clock.mockRestore();
    }
  });
});
