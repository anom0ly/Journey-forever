import { describe, expect, it } from "vitest";
import { entries, list, LuaParseError, parseSavedVariables } from "../src/lib/lua";

describe("parseSavedVariables", () => {
  it("reads the game's layout: keyed tables, lists with index comments, nil holes", () => {
    const src = `
Foo = {
	["version"] = 4,
	["name"] = "Brann\\"oc\\\\",
	["events"] = {
		{
			1730000000, -- [1]
			"on", -- [2]
			-1, -- [3]
			nil, -- [4]
			5.5, -- [5]
		}, -- [1]
	},
	[12] = true,
	["empty"] = {
	},
}
Bar = nil
`;
    const g = parseSavedVariables(src);
    expect(Object.keys(g)).toEqual(["Foo", "Bar"]);
    const foo = g.Foo as Record<string, unknown>;
    expect(foo.version).toBe(4);
    expect(foo.name).toBe('Brann"oc\\');
    expect(list(foo.events)[0]).toEqual([1730000000, "on", -1, null, 5.5]);
    expect(foo["12"]).toBe(true);
    expect(foo.empty).toEqual([]);
    expect(g.Bar).toBeNull();
  });

  it("keeps sparse integer keys as their numbers", () => {
    const g = parseSavedVariables(`X = { [1426] = { [312] = 900 }, [0] = 1 }`);
    const x = g.X as Record<string, unknown>;
    expect(x["1426"]).toBeDefined();
    expect(entries(x["1426"])).toEqual([["312", 900]]);
    expect(x["0"]).toBe(1);
  });

  it("reads escapes, long strings, comments and odd numbers", () => {
    const g = parseSavedVariables(`--[[ header ]] X = { "a\\nb", "\\65\\066", [[long
text]], 1e3, -0.25, 0x1F, "|cffa335ee|Hitem:1|h[Gizmo]|h|r" } -- tail`);
    expect(g.X).toEqual(["a\nb", "AB", "long\ntext", 1000, -0.25, 31, "|cffa335ee|Hitem:1|h[Gizmo]|h|r"]);
  });

  it("says where a broken file breaks", () => {
    expect(() => parseSavedVariables(`X = {\n  ["a"] = 1\n  ["b"] = 2\n}`)).toThrow(LuaParseError);
    try {
      parseSavedVariables(`X = {\n  ["a"] = 1\n  ["b"] = 2\n}`);
    } catch (e) {
      expect((e as LuaParseError).line).toBe(3);
    }
  });

  it("handles a large file quickly", () => {
    const parts = ["X = {"];
    for (let i = 0; i < 100000; i++) parts.push(`\t{ ${1730000000 + i}, "lvl", 0, -5000, 200, ${i % 60}, }, -- [${i + 1}]`);
    parts.push("}");
    const started = performance.now();
    const g = parseSavedVariables(parts.join("\n"));
    expect(list(g.X)).toHaveLength(100000);
    expect(performance.now() - started).toBeLessThan(3000);
  });
});
