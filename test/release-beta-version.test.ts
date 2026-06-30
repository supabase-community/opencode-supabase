import { describe, expect, test } from "bun:test";

import { makeTimestampedBetaVersion } from "../scripts/release-beta";

describe("release beta version suffix", () => {
  test("replaces changesets beta counter with UTC datetime and git SHA", () => {
    const date = new Date("2026-06-30T14:30:15Z");

    expect(makeTimestampedBetaVersion("0.5.0-beta.0", date, "abcdef123456")).toBe(
      "0.5.0-beta.20260630T143015Z.sha.gabcdef123456",
    );
  });

  test("preserves changesets semantic base version", () => {
    const date = new Date("2026-06-30T14:30:15Z");

    expect(makeTimestampedBetaVersion("1.0.0-beta.0", date, "123456abcdef")).toBe(
      "1.0.0-beta.20260630T143015Z.sha.g123456abcdef",
    );
  });

  test("rejects non changesets beta prerelease versions", () => {
    const date = new Date("2026-06-30T14:30:15Z");

    expect(() => makeTimestampedBetaVersion("0.5.0", date, "abcdef123456")).toThrow(
      'generated version "0.5.0" is not a -beta.<number> prerelease',
    );
  });
});
