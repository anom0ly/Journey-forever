import { useEffect, useState } from "preact/hooks";
import type { Journey } from "../lib/journey";
import { readUpload } from "../lib/parse/upload";
import { api, type Screenshot, type StoredCharacter } from "./api";

// Where a journey page gets its journey: the signed-in owner's character,
// a public link, or the built-in sample (nothing saved).
export type JourneySource = { kind: "owner"; key: string } | { kind: "public"; slug: string } | { kind: "demo" };

export interface Loaded {
  journey: Journey;
  stored?: StoredCharacter;
  screenshots: Screenshot[];
  base: string; // this journey's page, for links
}

export async function loadDemoJourneys(): Promise<Journey[]> {
  const modules = import.meta.glob("../../samples/**/*.lua", { query: "?raw", import: "default" });
  const files = await Promise.all(
    Object.entries(modules).map(async ([path, load]) => ({
      path: path.slice(path.indexOf("Account/") + "Account/".length),
      text: (await load()) as string,
    })),
  );
  return readUpload(files).journeys;
}

export function useJourney(source: JourneySource): { data?: Loaded; error?: string } {
  const [state, setState] = useState<{ data?: Loaded; error?: string }>({});
  const id = JSON.stringify(source);
  useEffect(() => {
    let live = true;
    setState({});
    (async (): Promise<Loaded> => {
      if (source.kind === "demo") {
        const journeys = await loadDemoJourneys();
        return { journey: journeys[0], screenshots: [], base: "/demo" };
      }
      if (source.kind === "public") {
        const [meta, journey] = await Promise.all([api.publicJourney(source.slug), api.publicJourneyData(source.slug)]);
        return { journey, stored: meta.character, screenshots: meta.screenshots, base: `/j/${encodeURIComponent(source.slug)}` };
      }
      const [stored, journey, shots] = await Promise.all([api.character(source.key), api.journey(source.key), api.screenshots(source.key)]);
      return { journey, stored, screenshots: shots.screenshots, base: `/c/${encodeURIComponent(source.key)}` };
    })()
      .then((data) => live && setState({ data }))
      .catch((err: Error) => live && setState({ error: err.message }));
    return () => {
      live = false;
    };
  }, [id]);
  return state;
}
