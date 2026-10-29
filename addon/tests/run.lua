-- Offline tests for the addon, against the stand-in client in wow.lua.
-- Run from the repo root: lua5.1 addon/tests/run.lua

package.path = "addon/tests/?.lua;" .. package.path
local W = require("wow")
local ns = {}
W.Load("addon/JourneyForever", ns)

local passed, failed = 0, 0
local function test(name, fn)
    local ok, err = pcall(fn)
    if ok then
        passed = passed + 1
        io.write("ok   " .. name .. "\n")
    else
        failed = failed + 1
        io.stderr:write("FAIL " .. name .. "\n     " .. tostring(err) .. "\n")
    end
end
local function eq(a, b, what)
    if a ~= b then error(("%s: expected %s, got %s"):format(what or "value", tostring(b), tostring(a)), 2) end
end
local function last(list) return list[#list] end

-- Login
W.Fire("ADDON_LOADED", "JourneyForever")
W.Fire("PLAYER_LOGIN")
W.Fire("PLAYER_ENTERING_WORLD", true, false)
W.Advance(5)
local db = JourneyForeverDB

test("saved data is set up", function()
    eq(db.schemaVersion, 1, "schemaVersion")
    eq(db.char.name, "Testchar", "name")
    eq(db.char.realm, "TestRealm", "realm")
    eq(db.char.class, "WARRIOR", "class")
    eq(db.char.guid, "Player-1234-0ABCDEF0", "guid")
    eq(db.settings.shots.epic, true, "epic on")
    eq(db.settings.shots.blue, false, "blue off")
    eq(type(db.utcOffset), "number", "utcOffset")
    eq(db.zones[1431], true, "starting zone noted")
    eq(#db.screenshots, 0, "zone shots are off by default")
end)

test("utcOffset matches the system time zone", function()
    local z = os.date("%z", time())
    local sign, h, m = z:match("([+-])(%d%d)(%d%d)")
    local expected = (tonumber(h) * 3600 + tonumber(m) * 60) * (sign == "-" and -1 or 1)
    eq(ns.UTCOffset(), expected, "offset for " .. z)
end)

test("level up takes a screenshot a second later", function()
    local before = W.screenshots
    W.player.level = 24
    W.Fire("PLAYER_LEVEL_UP", 24)
    W.Advance(0.5)
    eq(W.screenshots, before, "not yet")
    W.Advance(1)
    eq(W.screenshots, before + 1, "taken")
    eq(W.uiVisible, false, "interface hidden")
    W.Fire("SCREENSHOT_SUCCEEDED")
    eq(W.uiVisible, true, "interface back")
    local s = last(db.screenshots)
    eq(s.kind, "level", "kind")
    eq(s.detail.level, 24, "level")
    eq(s.ok, true, "confirmed")
    eq(s.mapID, 1431, "mapID")
    eq(s.x, 0.42, "x")
    eq(s.y, 0.61, "y")
    eq(s.zone, "Duskwood", "zone")
    eq(s.hiddenUI, true, "hiddenUI")
    assert(s.shot:match("^WoWScrnShot_%d%d%d%d%d%d_%d%d%d%d%d%d$"), "shot stem " .. tostring(s.shot))
    eq(s.shot, "WoWScrnShot_" .. date("%m%d%y_%H%M%S", s.t), "stem matches t")
    assert(s.wx and s.wy and s.continent == 0, "world position")
end)

test("epic loot outdoors from the loot message", function()
    local n = #db.screenshots
    W.Fire("CHAT_MSG_LOOT", "You receive loot: " .. W.Link(1234, "Gutrender", "a335ee") .. ".")
    W.Advance(1)
    W.Fire("SCREENSHOT_SUCCEEDED")
    eq(#db.screenshots, n + 1, "logged")
    local s = last(db.screenshots)
    eq(s.kind, "epic", "kind")
    eq(s.detail.itemID, 1234, "itemID")
    eq(s.detail.name, "Gutrender", "name")
    eq(s.detail.quality, 4, "quality")
    eq(s.detail.item, "item:1234::::::::23:::::", "item string")
end)

test("blue loot is off by default, green never counts", function()
    local n = #db.screenshots
    W.Fire("CHAT_MSG_LOOT", "You receive loot: " .. W.Link(2000, "Blue Thing", "0070dd") .. ".")
    W.Fire("CHAT_MSG_LOOT", "You receive loot: " .. W.Link(2001, "Green Thing", "1eff00") .. "x2.")
    W.Advance(2)
    eq(#db.screenshots, n, "nothing")
end)

test("a secret loot message is ignored", function()
    local n = #db.screenshots
    W.Fire("CHAT_MSG_LOOT", W.SECRET)
    W.Advance(2)
    eq(#db.screenshots, n, "nothing")
end)

test("dungeon: final boss kill takes a shot", function()
    W.player.instance, W.player.instanceID = "The Deadmines", 36
    W.Fire("PLAYER_ENTERING_WORLD", false, false)
    W.Advance(5)
    eq(db.run.instance, "The Deadmines", "run started")
    local n = #db.screenshots
    W.Fire("ENCOUNTER_END", 1, "Rhahk'Zor", 1, 5, 1)
    W.Advance(3)
    eq(#db.screenshots, n, "boss shots off by default")
    W.Fire("ENCOUNTER_END", 5, "Edwin VanCleef", 1, 5, 1)
    W.Advance(3)
    W.Fire("SCREENSHOT_SUCCEEDED")
    local s = last(db.screenshots)
    eq(s.kind, "dungeon", "kind")
    eq(s.detail.instance, "The Deadmines", "instance")
    eq(s.detail.instanceID, 36, "instanceID")
    eq(s.detail.boss, "Edwin VanCleef", "boss")
    eq(s.detail.via, "encounter", "via")
    eq(s.x, nil, "no position inside")
    eq(db.run.bosses, 2, "bosses counted")
end)

test("epic loot inside an instance from the bags", function()
    local n = #db.screenshots
    W.quality = { [5555] = 4 }
    W.bags[0] = { [3] = { itemID = 5555, hyperlink = W.Link(5555, "Cruel Barb", "a335ee"), stackCount = 1, quality = 4 } }
    W.Fire("CHAT_MSG_LOOT", W.SECRET)
    W.Fire("BAG_UPDATE_DELAYED")
    W.Advance(1.5)
    W.Fire("SCREENSHOT_SUCCEEDED")
    eq(#db.screenshots, n + 1, "logged once")
    eq(last(db.screenshots).detail.name, "Cruel Barb", "name")
    -- Equipping it moves it from bags to worn: not a new item.
    W.bags[0][3] = nil
    W.worn[16] = W.Link(5555, "Cruel Barb", "a335ee")
    W.Fire("PLAYER_EQUIPMENT_CHANGED", 16, false)
    W.Fire("BAG_UPDATE_DELAYED")
    W.Advance(20)
    eq(#db.screenshots, n + 1, "no second shot")
end)

test("items from a vendor inside don't count", function()
    local n = #db.screenshots
    W.quality[6666] = 4
    W.Fire("MERCHANT_SHOW")
    W.bags[1] = { [1] = { itemID = 6666, hyperlink = W.Link(6666, "Bought", "a335ee"), stackCount = 1, quality = 4 } }
    W.Fire("BAG_UPDATE_DELAYED")
    W.Advance(1)
    W.Fire("MERCHANT_CLOSED")
    W.Advance(5)
    eq(#db.screenshots, n, "nothing")
end)

test("leaving after a release keeps the run going", function()
    W.player.dead = true
    W.player.instance = nil
    W.Fire("ZONE_CHANGED_NEW_AREA")
    W.Advance(3)
    assert(db.run, "run kept")
    W.player.dead = false
    W.player.instance = "The Deadmines"
    W.Fire("PLAYER_ENTERING_WORLD", false, false)
    W.Advance(5)
    eq(db.run.bosses, 2, "same run")
end)

test("leaving an unknown dungeon after a boss counts as cleared", function()
    W.player.instance, W.player.instanceID = "Blackmaw Hold", 9001
    W.Fire("PLAYER_ENTERING_WORLD", false, false)
    W.Advance(5)
    eq(db.run.instance, "Blackmaw Hold", "new run")
    W.Fire("ENCOUNTER_END", 77, "Some New Boss", 1, 5, 1)
    W.Advance(3)
    local n = #db.screenshots
    W.player.instance = nil
    W.Fire("PLAYER_ENTERING_WORLD", false, false)
    W.Advance(6)
    W.Fire("SCREENSHOT_SUCCEEDED")
    eq(#db.screenshots, n + 1, "fallback shot")
    local s = last(db.screenshots)
    eq(s.kind, "dungeon", "kind")
    eq(s.detail.via, "left", "via")
    eq(s.detail.boss, "Some New Boss", "boss")
    eq(db.run, nil, "run over")
end)

test("leaving a known dungeon before its end boss is not a clear", function()
    W.player.instance, W.player.instanceID = "Shadowfang Keep", 33
    W.Fire("PLAYER_ENTERING_WORLD", false, false)
    W.Advance(5)
    W.Fire("ENCOUNTER_END", 1, "Rethilgore", 1, 5, 1)
    W.Advance(3)
    local n = #db.screenshots
    W.player.instance = nil
    W.Fire("PLAYER_ENTERING_WORLD", false, false)
    W.Advance(6)
    eq(#db.screenshots, n, "no shot")
end)

test("secret boss names fall back to leaving", function()
    W.player.instance, W.player.instanceID = "Shadowfang Keep", 33
    W.Fire("PLAYER_ENTERING_WORLD", false, false)
    W.Advance(5)
    W.Fire("ENCOUNTER_END", W.SECRET, W.SECRET, 1, 5, 1)
    W.Advance(3)
    local n = #db.screenshots
    W.player.instance = nil
    W.Fire("PLAYER_ENTERING_WORLD", false, false)
    W.Advance(6)
    W.Fire("SCREENSHOT_SUCCEEDED")
    eq(#db.screenshots, n + 1, "fallback shot")
    eq(last(db.screenshots).detail.instance, "Shadowfang Keep", "instance")
end)

test("two triggers at once share one screenshot", function()
    db.settings.shots.boss = true
    W.player.instance, W.player.instanceID = "Gnomeregan", 90
    W.Fire("PLAYER_ENTERING_WORLD", false, false)
    W.Advance(5)
    local before, n = W.screenshots, #db.screenshots
    W.Fire("ENCOUNTER_END", 9, "Mekgineer Thermaplugg", 1, 5, 1)
    W.Advance(3)
    W.Fire("SCREENSHOT_SUCCEEDED")
    eq(W.screenshots, before + 1, "one picture")
    eq(#db.screenshots, n + 2, "two entries")
    eq(db.screenshots[n + 1].shot, db.screenshots[n + 2].shot, "same file")
    eq(db.screenshots[n + 1].kind, "boss", "boss first")
    eq(db.screenshots[n + 2].kind, "dungeon", "then dungeon")
    eq(db.screenshots[n + 2].ok, true, "both confirmed")
    db.settings.shots.boss = false
    W.player.instance = nil
    W.Fire("PLAYER_ENTERING_WORLD", false, false)
    W.Advance(6)
end)

test("no interface hiding in combat", function()
    W.combat = true
    W.uiVisible = true
    W.player.level = 25
    W.Fire("PLAYER_LEVEL_UP", 25)
    W.Advance(1.5)
    eq(W.uiVisible, true, "still shown")
    W.Fire("SCREENSHOT_SUCCEEDED")
    eq(last(db.screenshots).hiddenUI, nil, "not hidden")
    W.combat = false
end)

test("a failed screenshot is marked", function()
    W.Fire("PLAYER_LEVEL_UP", 26)
    W.Advance(1.5)
    W.Fire("SCREENSHOT_FAILED")
    eq(last(db.screenshots).ok, false, "ok = false")
    eq(W.uiVisible, true, "interface back")
end)

test("an unconfirmed screenshot times out and the next one runs", function()
    W.Fire("PLAYER_LEVEL_UP", 27)
    W.Advance(1.5)
    W.Advance(11)
    eq(last(db.screenshots).ok, nil, "unknown")
    local before = W.screenshots
    W.Fire("PLAYER_LEVEL_UP", 28)
    W.Advance(1.5)
    eq(W.screenshots, before + 1, "next shot taken")
    W.Fire("SCREENSHOT_SUCCEEDED")
end)

test("Print Screen shots are logged as manual", function()
    local n = #db.screenshots
    W.Fire("SCREENSHOT_SUCCEEDED")
    eq(#db.screenshots, n + 1, "logged")
    eq(last(db.screenshots).kind, "manual", "kind")
    eq(last(db.screenshots).ok, true, "ok")
end)

test("pause stops automatic shots but not notes", function()
    SlashCmdList.JOURNEYFOREVER("pause")
    eq(db.paused, true, "paused")
    local n = #db.screenshots
    W.Fire("PLAYER_LEVEL_UP", 29)
    W.Advance(2)
    W.Fire("SCREENSHOT_SUCCEEDED")
    eq(#db.screenshots, n, "no level shot, no manual log")
    SlashCmdList.JOURNEYFOREVER("note   Stitches came out of nowhere.  ")
    eq(last(db.notes).text, "Stitches came out of nowhere.", "note saved")
    SlashCmdList.JOURNEYFOREVER("resume")
    eq(db.paused, false, "resumed")
end)

test("notes carry time and place", function()
    W.player.map, W.player.x, W.player.y = 9999, 0.5, 0.25
    local note = ns.AddNote("Finally got my mount!")
    eq(note.mapID, 9999, "mapID")
    eq(note.x, 0.5, "x")
    eq(note.zone, "Duskwood", "zone")
    eq(note.subzone, "Darkshire", "subzone")
    eq(note.level, W.player.level, "level")
    eq(type(note.t), "number", "t")
    eq(ns.AddNote("   "), nil, "empty note not saved")
    ns.DeleteNote(note)
    eq(last(db.notes).text, "Stitches came out of nowhere.", "deleted")
end)

test("first visit to a zone, when switched on", function()
    db.settings.shots.zone = true
    W.player.map = 1433
    W.Fire("ZONE_CHANGED_NEW_AREA")
    W.Advance(5)
    W.Fire("SCREENSHOT_SUCCEEDED")
    local s = last(db.screenshots)
    eq(s.kind, "zone", "kind")
    eq(s.detail.zone, "Redridge Mountains", "zone")
    local n = #db.screenshots
    W.Fire("ZONE_CHANGED_NEW_AREA")
    W.Advance(5)
    eq(#db.screenshots, n, "only once")
    db.settings.shots.zone = false
end)

test("rare mob kill, when switched on", function()
    db.settings.shots.rare = true
    W.target = { guid = "Creature-0-1-2-3-4-5", name = "Mor'Ladim", classification = "rareelite" }
    W.Fire("PLAYER_TARGET_CHANGED")
    W.target.dead = true
    W.Fire("UNIT_HEALTH", "target")
    W.Advance(1)
    W.Fire("SCREENSHOT_SUCCEEDED")
    local s = last(db.screenshots)
    eq(s.kind, "rare", "kind")
    eq(s.detail.name, "Mor'Ladim", "name")
    db.settings.shots.rare = false
    W.target = nil
end)

test("death, when switched on", function()
    db.settings.shots.death = true
    W.Fire("PLAYER_DEAD")
    W.Advance(1.5)
    W.Fire("SCREENSHOT_SUCCEEDED")
    eq(last(db.screenshots).kind, "death", "kind")
    db.settings.shots.death = false
end)

test("the window builds and refreshes", function()
    if JourneyForeverFrame then JourneyForeverFrame:Hide() end   -- an empty /jf note opened it
    SlashCmdList.JOURNEYFOREVER("")
    assert(JourneyForeverFrame and JourneyForeverFrame:IsShown(), "shown")
    ns.Show("notes")
    ns.Show("settings")
    ns.Refresh()
    SlashCmdList.JOURNEYFOREVER("")
    eq(JourneyForeverFrame:IsShown(), false, "toggled off")
    SlashCmdList.JOURNEYFOREVER("status")
    JourneyForever_OnAddonCompartmentClick()
    assert(JourneyForeverMinimapButton, "minimap button")
end)

test("data from a newer version is left alone", function()
    local ns2 = {}
    JourneyForeverDB = { schemaVersion = 99, screenshots = { { t = 1 } } }
    W.events = {}
    W.Load("addon/JourneyForever", ns2)
    W.Fire("ADDON_LOADED", "JourneyForever")
    W.Fire("PLAYER_LOGIN")
    eq(ns2.readOnly, true, "read only")
    eq(JourneyForeverDB.schemaVersion, 99, "version kept")
    W.Fire("PLAYER_LEVEL_UP", 30)
    W.Advance(2)
    eq(#JourneyForeverDB.screenshots, 1, "nothing added")
    eq(ns2.AddNote("hi"), nil, "no notes")
end)

test("no errors were caught along the way", function()
    eq(#ns.errors, 0, "errors: " .. table.concat(ns.errors, " | "))
end)

io.write(("%d passed, %d failed\n"):format(passed, failed))
os.exit(failed == 0 and 0 or 1)
