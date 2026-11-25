// Tag and colour for each screenshot kind the addon takes.
export const KIND_TAG: Record<string, { tag: string; cls: string }> = {
  dungeon: { tag: "Dungeon", cls: "teal" },
  epic: { tag: "Epic loot", cls: "lilac" },
  blue: { tag: "Rare loot", cls: "lilac" },
  level: { tag: "Level up", cls: "gold" },
  halfway: { tag: "Halfway", cls: "gold" },
  death: { tag: "Death", cls: "red" },
  boss: { tag: "Boss", cls: "teal" },
  rare: { tag: "Rare", cls: "gold" },
  zone: { tag: "New zone", cls: "teal" },
  manual: { tag: "By hand", cls: "" },
};
