# JourneyForever.lua saved file format

The addon writes one file per character, when the player logs out or types `/reload`:

```
World of Warcraft\_forever_\WTF\Account\<account>\<realm>\<character>\SavedVariables\JourneyForever.lua
```

It holds one global, `JourneyForeverDB`, written by the game as a plain Lua table. See [samples/JourneyForever.lua](samples/JourneyForever.lua) for a made-up example.

Readers should refuse a `schemaVersion` they don't know, accept unknown `kind` values and ignore fields they don't use. Any field below can be missing; positions are often missing.

## Top level

| Field | Type | Meaning |
| --- | --- | --- |
| `schemaVersion` | number | `1`. Raised only for changes that break readers. |
| `addon` | string | Addon version that last wrote the file, e.g. `"1.0.0"`. |
| `utcOffset` | number | Seconds the player's PC clock is ahead of UTC, refreshed at each login (e.g. `-25200` for PDT). Needed to read the local times in screenshot file names. |
| `char` | table | The character: `guid` (`"Player-..."`), `name`, `realm` (normalised, no spaces), `class` and `race` (tokens such as `"WARRIOR"`, `"Human"`), `faction`, `level`. Merge key with the other addons: `guid`, or `name-realm`. |
| `screenshots` | array | One entry per screenshot logged, oldest first (below). Capped at 5000. |
| `notes` | array | One entry per note, oldest first (below). Capped at 5000. |
| `paused`, `settings`, `zones`, `run` | | The addon's own state. Ignore. |

## Place fields (screenshots and notes)

| Field | Type | Meaning |
| --- | --- | --- |
| `t` | number | `time()`: epoch seconds from the player's PC clock (the clock that names screenshot files), not `GetServerTime()`. |
| `mapID` | number | `C_Map.GetBestMapForUnit("player")`, the uiMapID. Set inside instances too. |
| `x`, `y` | number | 0 to 1 on `mapID`, 4 decimals. Outdoors only (nil inside instances). |
| `wx`, `wy`, `continent` | number | World position in yards, the same system Road to Sixty uses (`C_Map.GetWorldPosFromMapPos`: `wx` north, `wy` west). Outdoors only. |
| `zone` | string | `GetRealZoneText()`: the zone, or the instance's name inside one. |
| `level` | number | The player's level at that moment. |

## Screenshot entries

Place fields, plus:

| Field | Type | Meaning |
| --- | --- | --- |
| `kind` | string | What set it off (below). |
| `detail` | table | Depends on `kind` (below). Always a table, maybe empty. |
| `shot` | string | The file name the game is expected to give the picture, without extension: `WoWScrnShot_MMDDYY_HHMMSS` in the PC's local time. The extension follows the player's screenshot format (`.jpg` by default, `.png`, `.tga`). Match on this first, then on `t` (converted with `utcOffset`) within a couple of seconds, since the file can be stamped a second later. |
| `ok` | boolean | `true` once the game confirmed the file was saved (`SCREENSHOT_SUCCEEDED`), `false` if it failed (no file), missing if never confirmed. |
| `hiddenUI` | boolean | `true` if the interface was hidden for the shot. |

Two triggers at the same moment (a boss kill that also clears the dungeon) share one picture: their entries have the same `shot`.

| `kind` | Default | `detail` |
| --- | --- | --- |
| `dungeon` | on | `instance` (name), `instanceID`, `boss` (final boss, may be missing), `via`: `"encounter"` (final boss kill seen) or `"left"` (fallback: left the dungeon after a boss kill, shot taken outside) |
| `epic` | on | `item` (item string `"item:..."`), `name`, `itemID`, `quality` (4) |
| `level` | on | `level` (the new level) |
| `blue` | off | as `epic`, `quality` 3 |
| `death` | off | (empty; the killer is unknown on Forever) |
| `boss` | off | `boss`, `instance`, `instanceID` |
| `rare` | off | `name` (the rare mob), `classification` (`"rare"` or `"rareelite"`) |
| `zone` | off | `zone` (name), `mapID` (the zone's uiMapID) — first visit to a zone |
| `manual` | logged | (empty) A picture the player took with Print Screen, or with `/jf shot`. |

## Note entries

Place fields, plus `text` (up to 500 characters), `subzone` and `instance` (name, inside instances only).

## Privacy

The addon never stores other players' names, chat or the combat log. `char` is the player's own character; boss, rare and item names are game data.
