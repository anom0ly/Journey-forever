import { describe, expect, it } from "vitest";
import { newCheckLines } from "../src/worker/boards";

describe("review items from automatic checks", () => {
  it("only lines not seen at the last clear are new", () => {
    const seen = ["Level 46 took 17 minutes of played time.", "An upload changed when level 56 was reached."];
    expect(newCheckLines(seen, seen)).toEqual([]);
    expect(newCheckLines([...seen, "Level 59 took 6 minutes of played time."], seen)).toEqual(["Level 59 took 6 minutes of played time."]);
    expect(newCheckLines(["Level 47 took 8 minutes of played time."], [])).toEqual(["Level 47 took 8 minutes of played time."]);
  });

  it("a line that went away is not new when it comes back", () => {
    expect(newCheckLines(["Level 46 took 17 minutes of played time."], ["Level 46 took 17 minutes of played time.", "gone"])).toEqual([]);
  });
});
