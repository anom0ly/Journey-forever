# Journey Forever website

Turns the saved files of three WoW Forever addons into a journey page and a
map replay for every character on an account.

| Addon | Saved file | What the site takes from it |
| --- | --- | --- |
| Road to Sixty 1.15 | `RoadToSixty.lua` (`RoadToSixtyCharDB`, layout 4) | Path, event timeline, level snapshots, kills |
| Journey Tracker 0.6 | `JourneyTracker.lua` (`JourneyTrackerDB`, schema 1) | Gold by category, time, XP, loot and kill counts, deaths with killer, dungeon runs |
| Journey Forever (ours, `addon/`) | `JourneyForever.lua` (`JourneyForeverDB`, schema 1) | Screenshot log and `/jf` notes |

A file saved by a newer layout than the site knows is skipped with a message,
and everything else still loads.

## How it fits together

- **The browser does the reading.** `src/lib/` holds the SavedVariables reader
  (`lua.ts`), one parser per addon (`parse/`), the merge into one journey
  (`merge.ts`) and what the pages show (`insights.ts`, `replay.ts`). The upload
  page runs them on the dropped folder, so a Worker never parses tens of MB.
- **Only the finished journey is sent**, as gzipped JSON, plus screenshots.
  Raw saved files never leave the browser: they hold other players' names.
  The parsers drop those names and GUIDs on read (group members become a count).
- **The Worker** (`src/worker/`) handles sign-in, stores journeys and
  screenshots in R2 and a summary per character in D1, and serves public links.
- **The pages** (`src/app/`, Preact): upload, characters (with the
  public/private switch), journey overview, map replay, data sources, and a
  `/demo` journey built from the sample files.

Positions are world yards. The replay draws them over zone outlines taken
from the Forever client's map tables (`src/lib/map-data.json`, written by
`node --experimental-strip-types scripts/fetch-map-data.ts`
from wago.tools). Blizzard's map art isn't used.

## Working on it

```sh
cd website
npm install
cp .dev.vars.example .dev.vars        # AUTH_MODE=dev: local sign-in, no Battle.net needed
npm run db:migrate:local
npm run build && npx wrangler dev     # http://localhost:8787
# or, with hot reload: `npx wrangler dev` in one terminal and `npm run dev` in another
npm test                              # parsers, merge, screenshot matching, replay clock
```

`samples/` is a made-up `WTF\Account` folder (two invented characters) for
tests and for trying the upload page. `node --experimental-strip-types
scripts/make-samples.ts` rebuilds it. Never commit real saved files: the repo
is public.

## Deploying to Cloudflare

1. `npx wrangler login`
2. `npx wrangler d1 create journey-forever` and put the ID it prints in `wrangler.jsonc`.
3. `npx wrangler r2 bucket create journey-forever-files`
4. `npm run db:migrate:remote`
5. Battle.net sign-in: create a client at https://develop.battle.net/access/clients
   with redirect URL `https://<your site>/auth/callback`, then
   `npx wrangler secret put BNET_CLIENT_ID` and `npx wrangler secret put BNET_CLIENT_SECRET`.
   Until then the site runs, and sign-in says it isn't set up yet.
6. `npm run deploy`

Dev sign-in (`AUTH_MODE=dev`) only works on localhost, so it can't be switched
on by accident in production.
