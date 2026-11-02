// Finding the second character for a comparison: the name search the Worker
// runs, and reading a pasted journey link. Kept apart from compare.ts so the
// Worker doesn't pull in the stats code.

// The LIKE pattern for a name search: names starting with q, LIKE's own
// wildcards escaped (with "\\"). Undefined for fewer than two letters.
export function searchPattern(q: string): string | undefined {
  const t = q.trim().slice(0, 32);
  if (t.length < 2) return undefined;
  return t.replace(/[\\%_]/g, (c) => "\\" + c) + "%";
}

// A pasted journey link (or just its slug) as a slug.
export function slugFromLink(text: string): string | undefined {
  const t = text.trim();
  const m = t.match(/\/j\/([^/?#\s]+)/) ?? t.match(/^([a-z0-9-]{1,80})$/i);
  if (!m) return undefined;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return undefined;
  }
}
