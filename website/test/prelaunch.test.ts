import { describe, expect, it } from "vitest";
import type { Journey } from "../src/lib/journey";
import { FOREVER_LAUNCH, isPreLaunch } from "../src/lib/merge";

const at = (t?: number) => ({ events: t ? [{ t, k: "zone" }] : [], segments: [], sessions: [] }) as unknown as Journey;

describe("isPreLaunch", () => {
  it("flags characters last seen before Forever's launch", () => {
    expect(isPreLaunch(at(FOREVER_LAUNCH - 86400))).toBe(true);
  });
  it("keeps characters played since launch", () => {
    expect(isPreLaunch(at(FOREVER_LAUNCH + 60))).toBe(false);
  });
  it("keeps characters with no dated data", () => {
    expect(isPreLaunch(at())).toBe(false);
  });
});
