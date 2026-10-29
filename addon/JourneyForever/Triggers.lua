local _, ns = ...

-- What sets off an automatic screenshot. On by default: dungeon completed,
-- epic loot, level up. Off by default: rare (blue) loot, death, any boss,
-- a rare mob killed, first visit to a zone. Settings live in
-- JourneyForeverDB.settings.shots.

local Call, Num, Str, Safe = ns.Call, ns.Num, ns.Str, ns.Safe

local EPIC, RARE = 4, 3

---------------------------------------------------------------------------
-- Level up
---------------------------------------------------------------------------

ns.On("PLAYER_LEVEL_UP", function(level)
    -- A second later, so the level-up glow is in the picture.
    ns.TakeShot("level", { level = Num(level) }, { delay = 1 })
end)

---------------------------------------------------------------------------
-- Dungeon completed and boss kills
---------------------------------------------------------------------------

-- Each dungeon's (or wing's) last boss, by the name the game gives the
-- encounter. Killing one clears the dungeon.
local FINAL_BOSSES = {}
for _, name in ipairs({
    "Taragaman the Hungerer", "Mutanus the Devourer", "Edwin VanCleef", "Archmage Arugal", "Aku'mai",
    "Bazil Thredd", "Mekgineer Thermaplugg", "Charlga Razorflank", "Amnennar the Coldbringer", "Archaedas",
    "Chief Ukorz Sandscalp", "Princess Theradras", "Shade of Eranikus", "Emperor Dagran Thaurissan",
    "Overlord Wyrmthalak", "General Drakkisath", "Darkmaster Gandling",
    "Bloodmage Thalnos", "Arcanist Doan", "Herod", "High Inquisitor Whitemane",          -- Scarlet Monastery
    "Alzzin the Wildshaper", "Prince Tortheldrin", "King Gordok",                        -- Dire Maul
    "Balnazzar", "Baron Rivendare",                                                      -- Stratholme
    "Durgen Dirgehammer", "Bjork", "Relic Guardian",                                     -- Forever's new dungeons
    "Onyxia", "Ragnaros", "Nefarian", "Hakkar", "Ossirian the Unscarred", "C'Thun", "Kel'Thuzad", -- raids
}) do FINAL_BOSSES[name:lower()] = true end

-- Dungeons whose last boss is listed above. Leaving any other dungeon after
-- a boss kill counts as clearing it (the fallback), as does leaving one
-- whose boss names the game kept secret.
local KNOWN = {}
for _, name in ipairs({
    "Ragefire Chasm", "Wailing Caverns", "The Deadmines", "Shadowfang Keep", "Blackfathom Deeps",
    "The Stockade", "Stormwind Stockade", "Gnomeregan", "Razorfen Kraul", "Razorfen Downs", "Uldaman",
    "Zul'Farrak", "Maraudon", "The Temple of Atal'Hakkar", "Sunken Temple", "Blackrock Depths",
    "Blackrock Spire", "Lower Blackrock Spire", "Upper Blackrock Spire", "Scholomance", "Scarlet Monastery",
    "Dire Maul", "Stratholme", "Hall of Thanes", "Ruins of Lordaeron", "Excavation Site",
    "Onyxia's Lair", "Molten Core", "Blackwing Lair", "Zul'Gurub", "Ruins of Ahn'Qiraj", "Ahn'Qiraj Temple",
    "Temple of Ahn'Qiraj", "Naxxramas",
}) do KNOWN[name:lower()] = true end

-- The run in progress, kept in the saved data so a /reload or relog inside
-- carries on: { instance, instanceID, kind, bosses, lastBoss, secret, cleared }.
local function Run() return ns.db and ns.db.run end

local function InstanceNow()
    local kind = ns.InInstance()
    if kind ~= "party" and kind ~= "raid" then return nil end
    local name, _, _, _, _, _, _, instanceID = Call("GetInstanceInfo")
    return Str(name), Num(instanceID), kind
end

local function Cleared(run, boss, via)
    run.cleared = run.cleared or {}
    local key = boss or via
    if run.cleared[key] then return end
    run.cleared[key] = true
    ns.TakeShot("dungeon", { instance = run.instance, instanceID = run.instanceID, boss = boss, via = via },
        { delay = via == "encounter" and 2 or 3 })
end

-- Left a dungeon: if bosses died but the end was never seen, call it cleared.
local function EndRun(run)
    ns.db.run = nil
    if not run or (run.bosses or 0) == 0 or (run.cleared and next(run.cleared)) then return end
    local known = run.instance and KNOWN[run.instance:lower()]
    if not known or run.secret then Cleared(run, run.lastBoss, "left") end
end

local function CheckInstance()
    if not ns.db or ns.readOnly then return end
    local name, instanceID, kind = InstanceNow()
    local run = Run()
    if kind then
        if run and run.instanceID == instanceID and run.instance == name then return end
        if run then EndRun(run) end
        ns.db.run = { instance = name, instanceID = instanceID, kind = kind, bosses = 0 }
    elseif run then
        -- Released after a death: the corpse is still inside, so the run goes on.
        if Call("UnitIsDeadOrGhost", "player") == true then return end
        EndRun(run)
    end
end

ns.On("PLAYER_ENTERING_WORLD", function() ns.After(2, CheckInstance) end)
ns.On("ZONE_CHANGED_NEW_AREA", function() ns.After(1, CheckInstance) end)
ns.On("PLAYER_UNGHOST", function() ns.After(1, CheckInstance) end)

ns.On("ENCOUNTER_END", function(_, name, _, _, success)
    if not ns.db or ns.readOnly then return end
    success = Safe(success)
    if not (success == 1 or success == true) then return end
    name = Str(name)
    local run = Run()
    if not run then
        local instance, instanceID, kind = InstanceNow()
        if kind then
            run = { instance = instance, instanceID = instanceID, kind = kind, bosses = 0 }
            ns.db.run = run
        end
    end
    local where = run or {}
    if run then
        run.bosses = (run.bosses or 0) + 1
        run.lastBoss = name or run.lastBoss
        if not name then run.secret = true end
    end
    if run and name and FINAL_BOSSES[name:lower()] then
        Cleared(run, name, "encounter")
    end
    ns.TakeShot("boss", { boss = name, instance = where.instance, instanceID = where.instanceID }, { delay = 1 })
end)

---------------------------------------------------------------------------
-- Loot: epic (and, if switched on, rare) items
---------------------------------------------------------------------------

local LINK_QUALITY = { ["a335ee"] = EPIC, ["0070dd"] = RARE }
local recentItems = {}   -- itemID -> GetTime() of its last shot, so one item makes one shot

local function Quality(link, itemID)
    local q = itemID and Num(Call("C_Item.GetItemQualityByID", itemID))
    if q then return q end
    if link then
        local _, _, quality = Call("C_Item.GetItemInfo", link)
        if Num(quality) then return quality end
        local color = link:match("|c%x%x(%x%x%x%x%x%x)")
        return color and LINK_QUALITY[color:lower()]
    end
end

local function LootShot(link, itemID, quality)
    if not quality or quality < RARE then return end
    local now = GetTime()
    if itemID and recentItems[itemID] and now - recentItems[itemID] < 10 then return end
    if itemID then recentItems[itemID] = now end
    local itemString = link and link:match("|H(item:[^|]+)|h")
    local name = link and link:match("%[(.-)%]")
    ns.TakeShot(quality >= EPIC and "epic" or "blue",
        { item = itemString, name = name, itemID = itemID, quality = quality }, { delay = 0.5 })
end

-- "You receive loot: %s." as a Lua pattern that captures the link.
local function Matcher(format)
    if type(format) ~= "string" then return nil end
    local pattern = format:gsub("[%^%$%(%)%.%[%]%*%+%-%?%%]", "%%%0")
    pattern = pattern:gsub("%%%%s", "(.+)"):gsub("%%%%d", "%%d+")
    return "^" .. pattern .. "$"
end

local LOOT_PATTERNS = {}
for _, format in ipairs({ LOOT_ITEM_SELF_MULTIPLE or "You receive loot: %sx%d.", LOOT_ITEM_SELF or "You receive loot: %s." }) do
    local pattern = Matcher(format)
    if pattern then table.insert(LOOT_PATTERNS, pattern) end
end

-- Outdoors: the loot message. Inside instances it is secret and reads as nil.
ns.On("CHAT_MSG_LOOT", function(msg)
    msg = Str(msg)
    if not msg or ns.InInstance() then return end
    for _, pattern in ipairs(LOOT_PATTERNS) do
        local link = msg:match(pattern)
        if link then
            local itemID = tonumber(link:match("item:(%d+)"))
            LootShot(link, itemID, Quality(link, itemID))
            return
        end
    end
end)

-- Inside instances: bags and worn gear compared on every change. Only
-- rare and epic items are counted. Items from a vendor, the mail, the bank,
-- a trade or the auction house don't count as loot.
local owned            -- itemID -> count at the last scan, nil until the first
local links = {}       -- itemID -> link
local busy = {}        -- vendor, mail, bank, trade, auction windows open

local function Busy()
    return next(busy) ~= nil
end

for show, hide in pairs({ MERCHANT_SHOW = "MERCHANT_CLOSED", MAIL_SHOW = "MAIL_CLOSED",
    BANKFRAME_OPENED = "BANKFRAME_CLOSED", TRADE_SHOW = "TRADE_CLOSED",
    AUCTION_HOUSE_SHOW = "AUCTION_HOUSE_CLOSED" }) do
    ns.On(show, function() busy[show] = true end)
    -- A moment's grace after closing, for items that land late.
    ns.On(hide, function() ns.After(2, function() busy[show] = nil end) end)
end

local function Add(counts, itemID, link, count, quality)
    if not itemID then return end
    quality = quality or Quality(link, itemID)
    if not quality or quality < RARE then return end
    counts[itemID] = (counts[itemID] or 0) + (count or 1)
    if link then links[itemID] = link end
end

local function Scan()
    local counts = {}
    local last = (NUM_BAG_SLOTS or 4)
    local bags = {}
    for bag = 0, last do bags[#bags + 1] = bag end
    if Enum and Enum.BagIndex and Enum.BagIndex.ReagentBag then bags[#bags + 1] = Enum.BagIndex.ReagentBag end
    for _, bag in ipairs(bags) do
        local slots = Num(Call("C_Container.GetContainerNumSlots", bag)) or 0
        for slot = 1, slots do
            local info = Call("C_Container.GetContainerItemInfo", bag, slot)
            if type(info) == "table" then
                Add(counts, Num(info.itemID), Str(info.hyperlink), Num(info.stackCount), Num(info.quality))
            end
        end
    end
    for slot = 1, 19 do
        local link = Str(Call("GetInventoryItemLink", "player", slot))
        if link then Add(counts, tonumber(link:match("item:(%d+)")), link, 1) end
    end
    return counts
end

local function CheckBags()
    if not ns.db then return end
    local counts = Scan()
    local before = owned
    owned = counts
    if not before or Busy() or not ns.InInstance() then return end
    for itemID, n in pairs(counts) do
        if n > (before[itemID] or 0) then
            LootShot(links[itemID], itemID, Quality(links[itemID], itemID))
        end
    end
end

local scanQueued = false
local function QueueScan()
    if scanQueued then return end
    scanQueued = true
    ns.After(0.3, function()
        scanQueued = false
        CheckBags()
    end)
end

ns.On("BAG_UPDATE_DELAYED", QueueScan)
ns.On("PLAYER_EQUIPMENT_CHANGED", QueueScan)
ns.On("PLAYER_ENTERING_WORLD", function()
    -- A fresh baseline after each loading screen.
    owned = nil
    ns.After(3, CheckBags)
end)

---------------------------------------------------------------------------
-- Death
---------------------------------------------------------------------------

ns.On("PLAYER_DEAD", function()
    ns.TakeShot("death", {}, { delay = 1 })
end)

---------------------------------------------------------------------------
-- Rare mobs: one you targeted that died while still yours to loot
---------------------------------------------------------------------------

local watched          -- { guid, name, classification }
local seenRares = {}   -- guid or name -> true, this session

local function CheckRare()
    if not watched then return end
    if Call("UnitIsDead", "target") ~= true then return end
    local guid = Str(Call("UnitGUID", "target"))
    if watched.guid and guid and guid ~= watched.guid then return end
    if Call("UnitIsTapDenied", "target") == true then watched = nil return end
    local key = watched.guid or watched.name
    local w = watched
    watched = nil
    if key and seenRares[key] then return end
    if key then seenRares[key] = true end
    ns.TakeShot("rare", { name = w.name, classification = w.classification }, { delay = 0.5 })
end

ns.On("PLAYER_TARGET_CHANGED", function()
    watched = nil
    local classification = Str(Call("UnitClassification", "target"))
    if classification ~= "rare" and classification ~= "rareelite" then return end
    if Call("UnitIsPlayer", "target") == true or Call("UnitIsDead", "target") == true then return end
    watched = { guid = Str(Call("UnitGUID", "target")), name = Str(Call("UnitName", "target")),
                classification = classification }
end)

ns.On("UNIT_HEALTH", function(unit)
    if watched and unit == "target" then CheckRare() end
end)
ns.On("PLAYER_REGEN_ENABLED", CheckRare)

---------------------------------------------------------------------------
-- First visit to a zone
---------------------------------------------------------------------------

local ZONE_TYPE = Enum and Enum.UIMapType and Enum.UIMapType.Zone or 3

-- The zone a map belongs to (sub-zone and floor maps climb to their zone).
local function ZoneMap(mapID)
    for _ = 1, 6 do
        if not mapID then return nil end
        local info = Call("C_Map.GetMapInfo", mapID)
        if type(info) ~= "table" then return nil end
        if Num(info.mapType) == ZONE_TYPE then return mapID, Str(info.name) end
        if Num(info.mapType) and info.mapType < ZONE_TYPE then return nil end  -- a continent or above
        mapID = Num(info.parentMapID)
    end
end

local function CheckZone()
    if not ns.db or ns.readOnly or ns.InInstance() then return end
    local mapID, name = ZoneMap(Num(Call("C_Map.GetBestMapForUnit", "player")))
    if not mapID or ns.db.zones[mapID] then return end
    -- Always noted, so switching the option on later doesn't fire for old zones.
    ns.db.zones[mapID] = true
    ns.TakeShot("zone", { zone = name, mapID = mapID }, { delay = 3 })
end

ns.On("ZONE_CHANGED_NEW_AREA", function() ns.After(1, CheckZone) end)
ns.On("PLAYER_ENTERING_WORLD", function() ns.After(4, CheckZone) end)
