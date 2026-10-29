# Journey Forever addon

A small World of Warcraft addon for WoW Forever (interface 16001). It takes screenshots of the big moments of each character's journey and keeps notes you write along the way, so the Journey Forever website can place them on your journey. Road to Sixty (your path and event timeline) and Journey Tracker (stats and gold) record the rest; install them too.

## What it does

- **Automatic screenshots**, each logged with time, place and what happened:
  - On by default: dungeon completed (final boss killed), epic item looted, level up.
  - Off by default: rare (blue) item looted, death, any boss killed, rare mob killed, first visit to a zone.
  - Optionally hides the interface for the shot (out of combat only).
  - Print Screen shots you take yourself are logged too, so the site can place them.
- **Notes**: `/jf note <text>` saves a note at your current spot.
- A window (`/jf`) with Screenshots, Notes and Settings tabs, and a minimap button.

## Commands

| Command | What it does |
| --- | --- |
| `/jf` | Open or close the window |
| `/jf note <text>` | Add a note at your current spot |
| `/jf pause`, `/jf resume` | Stop or restart automatic screenshots (notes still work) |
| `/jf shot` | Take a screenshot now and log it |
| `/jf status` | What's saved, and whether Road to Sixty and Journey Tracker are running |

Road to Sixty and Journey Tracker can also take a screenshot at every level up. To avoid two of each, turn theirs off: the Settings tab has a button for Road to Sixty, and `/journey screenshots` toggles Journey Tracker's.

## Install

Download `JourneyForever-<version>.zip` from the repository's Releases and unzip it into `World of Warcraft\_forever_\Interface\AddOns\`, so you get `AddOns\JourneyForever\JourneyForever.toc`.

## Uploading

Data is written to `WTF\Account\<account>\<realm>\<character>\SavedVariables\JourneyForever.lua` when you log out (or `/reload`). Drop your `WTF\Account\<account>` folder and your `Screenshots` folder on the website. [FORMAT.md](FORMAT.md) documents the file.

## How detection works on Forever

Forever runs Midnight's addon rules: no combat log, secret health and instance chat, positions outdoors only. So:

- **Dungeon completed**: `ENCOUNTER_END` with a known final boss (classic dungeons, wings, raids and Forever's known new dungeons). For dungeons not on the list, or when boss names are secret, leaving the dungeon after a boss kill counts as clearing it. Releasing after a death doesn't end the run.
- **Loot**: outdoors, the loot chat message. Inside instances (where it is secret), bags and worn gear are compared after each change; items from vendors, mail, the bank, trades and the auction house are skipped.
- **Rare mobs**: a rare or rare elite you targeted that dies while tagged by you.
- Every game value is checked with `issecretvalue`; secret or missing values are skipped, never errors.

## Development

```sh
lua5.1 addon/tests/run.lua                               # offline tests against a stand-in client
(cd addon && luacheck JourneyForever)                    # lint
TZ=America/Los_Angeles lua5.1 addon/tests/sample.lua     # regenerate samples/JourneyForever.lua
```

To release, set `## Version` in `JourneyForever/JourneyForever.toc`, then push a tag `addon-v<version>` (e.g. `addon-v1.0.0`). The release workflow zips `addon/JourneyForever` and attaches it to a GitHub release.
