import { describe, expect, test } from "bun:test";

import { makeTimestampedBetaVersion, waitForBetaDistTag } from "../scripts/release-beta";

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
});
