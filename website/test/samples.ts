import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { InputFile } from "../src/lib/parse/upload";

export const SAMPLES = join(import.meta.dirname, "..", "samples", "WTF", "Account", "SAMPLEACCOUNT");

// The sample account folder as the browser would hand it over (paths start
// at the dropped folder).
export function sampleFiles(): InputFile[] {
  const out: InputFile[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push({ path: "SAMPLEACCOUNT/" + relative(SAMPLES, p).split("\\").join("/"), text: readFileSync(p, "utf8") });
    }
  };
  walk(SAMPLES);
  return out;
}
