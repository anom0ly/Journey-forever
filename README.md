# Journey Forever

Record your WoW: Forever journey from level 1 to 60, then relive it on the web.

Journey Forever turns the saved files your addons already write into a recap page for each character: the path you walked, levels, quests, dungeons, loot, gold, deaths, and screenshots of the big moments.

## How it works

1. **Play.** Install the Journey Forever addon (plus, optionally, Road to Sixty and Journey Tracker for path and stats data).
2. **Log out.** WoW writes each addon's SavedVariables file to disk.
3. **Upload.** Drag your `WTF\Account\<account>` folder and your Screenshots folder onto the website.
4. **Share.** Each character gets a journey page, private by default, public with one switch.

## What's in this repo

| Folder | What it is |
| --- | --- |
| [`addon/`](addon/) | The in-game addon: automatic screenshots (dungeon cleared, epic loot, level up) and `/jf note` entries. |
| [`website/`](website/) | The site that reads your saved files and builds the journey pages. Hosted on Cloudflare; its README covers running it locally and deploying. |

## Install the addon

Copy `addon/JourneyForever` into:

```
World of Warcraft\_forever_\Interface\AddOns\
```

Then type `/jf` in game to open the window, or `/jf note <text>` to add a note.

## Status

Early development, targeting the WoW: Forever launch on 4 November 2026.

## Credits

Journey Forever builds on the data recorded by two other addons. Thanks to their authors:

- **Road to Sixty** by Jordan Burch records your path and event timeline. [GitHub](https://github.com/Jordanburch101/road-to-sixty) · [CurseForge](https://www.curseforge.com/wow/addons/road-to-sixty) · MIT licensed.
- **Journey Tracker** records stats and gold. [journeytracker.dev](https://journeytracker.dev)

The website reads these addons' saved-file formats. The addons belong to their authors, no code from them is included here, and Journey Forever is not affiliated with them.

## License

[MIT](LICENSE)

World of Warcraft and Blizzard Entertainment are trademarks or registered trademarks of Blizzard Entertainment, Inc. This project is not affiliated with or endorsed by Blizzard.
