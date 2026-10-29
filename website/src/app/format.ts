import type { CharacterSummary } from "../lib/journey";
import { className, CLASS_COLORS, raceName } from "../lib/wow";

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const dayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });
const timeFmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

export const date = (t: number) => dateFmt.format(new Date(t * 1000));
export const day = (t: number) => dayFmt.format(new Date(t * 1000));
export const time = (t: number) => timeFmt.format(new Date(t * 1000)).toLowerCase().replace(" ", " ");
export const dateTime = (t: number) => `${day(t)}, ${time(t)}`;

export function classColor(file?: string): string {
  return (file && CLASS_COLORS[file]) || "#8C949F";
}

export function describeCharacter(s: Pick<CharacterSummary, "race" | "className">): string {
  return [raceName(s.race), className(s.className)].filter(Boolean).join(" ") || "Adventurer";
}

export function plural(n: number, word: string, many = word + "s"): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? word : many}`;
}
