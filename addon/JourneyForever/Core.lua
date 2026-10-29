local ADDON, ns = ...

-- Journey Forever: screenshots of the big moments of a character's journey
-- and notes along the way, saved per character in JourneyForeverDB for the
-- Journey Forever website. Road to Sixty and Journey Tracker record the
-- rest; this addon only adds what they don't. FORMAT.md (next to this
-- folder in the repo) documents the saved file.
--
-- WoW Forever runs the retail client with Midnight's addon rules: no
-- network, no combat log, health and auras are secret values, instance chat
-- is secret and positions are readable outdoors only. Every game value goes
-- through Call()/Safe() so a secret or missing value comes back as nil.

ns.VERSION = C_AddOns and C_AddOns.GetAddOnMetadata and C_AddOns.GetAddOnMetadata(ADDON, "Version") or "1.0.0"
ns.SCHEMA = 1
ns.PREFIX = "|cffe0b252[Journey Forever]|r"
ns.MAX_SHOTS = 5000
ns.MAX_NOTES = 5000

---------------------------------------------------------------------------
-- Safe access
---------------------------------------------------------------------------

local function IsSecret(v)
    return issecretvalue ~= nil and issecretvalue(v) == true
end
ns.IsSecret = IsSecret

-- The value, or nil if it's secret.
local function Safe(v)
    if IsSecret(v) then return nil end
    return v
end
ns.Safe = Safe

local function Clean(...)
    if select("#", ...) == 0 then return end
    return Safe((...)), Clean(select(2, ...))
end

local function Lookup(name)
    local space, fname = name:match("^([%w_]+)%.([%w_]+)$")
    if space then
        local t = _G[space]
        return type(t) == "table" and t[fname] or nil
    end
    return _G[name]
end

local function Unwrap(ok, ...)
    if not ok or select("#", ...) == 0 then return nil end
    return Clean(...)
end

-- Calls a game API by name ("C_Map.GetBestMapForUnit" works). A missing
-- function, an error or a secret return value all come back as nil.
function ns.Call(name, ...)
    local fn = Lookup(name)
    if type(fn) ~= "function" then return nil end
    return Unwrap(pcall(fn, ...))
end
local Call = ns.Call

function ns.Num(v)
    v = Safe(v)
    return type(v) == "number" and v or nil
end
function ns.Str(v)
    v = Safe(v)
    return type(v) == "string" and v ~= "" and v or nil
end
local Num, Str = ns.Num, ns.Str

local function Round(v, places)
    if not v then return nil end
    local m = 10 ^ (places or 0)
    return math.floor(v * m + 0.5) / m
end
ns.Round = Round

function ns.Print(...)
    if ns.db and ns.db.settings and ns.db.settings.chat == false then return end
    print(ns.PREFIX, ...)
end

-- Always printed, for answers to slash commands.
function ns.Say(...)
    print(ns.PREFIX, ...)
end

function ns.InCombat()
    return InCombatLockdown and InCombatLockdown() == true
end

function ns.InInstance()
    local inside, kind = Call("IsInInstance")
    if inside == true then return kind or "unknown" end
end

---------------------------------------------------------------------------
-- Events
---------------------------------------------------------------------------

local frame = CreateFrame("Frame")
local handlers = {}
ns.errors = {}

local function Report(event, err)
    if #ns.errors < 20 then table.insert(ns.errors, event .. ": " .. tostring(err)) end
end

function ns.SafeCall(fn, ...)
    local ok, err = pcall(fn, ...)
    if not ok then Report("call", err) end
end

function ns.On(event, fn)
    if not handlers[event] then
        handlers[event] = {}
        frame:RegisterEvent(event)
    end
    table.insert(handlers[event], fn)
end

frame:SetScript("OnEvent", function(_, event, ...)
    for _, fn in ipairs(handlers[event] or {}) do
        local ok, err = pcall(fn, ...)
        if not ok then Report(event, err) end
    end
end)

function ns.After(seconds, fn)
    if C_Timer and C_Timer.After then
        C_Timer.After(seconds, function() ns.SafeCall(fn) end)
    else
        ns.SafeCall(fn)
    end
end

---------------------------------------------------------------------------
-- Where and when
---------------------------------------------------------------------------

-- Seconds the PC clock is ahead of UTC, so the website can read the local
-- times in screenshot file names.
function ns.UTCOffset(now)
    now = now or time()
    -- UTC's wall clock read as local time (with today's daylight saving)
    -- lands exactly the offset before now.
    local utc = date("!*t", now)
    utc.isdst = date("*t", now).isdst
    return now - time(utc)
end

function ns.Level()
    return Num(Call("UnitLevel", "player"))
end

-- Where the player is now: { mapID, x, y, wx, wy, continent, zone, subzone,
-- instance, instanceID, level }. x and y are 0-1 on mapID, outdoors only;
-- wx, wy and continent are world yards as Road to Sixty records them.
function ns.Place()
    local p = { level = ns.Level() }
    local mapID = Num(Call("C_Map.GetBestMapForUnit", "player"))
    p.mapID = mapID
    p.zone = Str(Call("GetRealZoneText")) or Str(Call("GetZoneText"))
    p.subzone = Str(Call("GetSubZoneText"))
    if ns.InInstance() then
        local name, _, _, _, _, _, _, instanceID = Call("GetInstanceInfo")
        p.instance, p.instanceID = Str(name), Num(instanceID)
    elseif mapID then
        local pos = Call("C_Map.GetPlayerMapPosition", mapID, "player")
        if type(pos) == "table" and pos.GetXY then
            local ok, x, y = pcall(pos.GetXY, pos)
            x, y = ok and Num(x), ok and Num(y)
            if x and y and (x > 0 or y > 0) then
                p.x, p.y = Round(x, 4), Round(y, 4)
                local continent, world = Call("C_Map.GetWorldPosFromMapPos", mapID, pos)
                if Num(continent) and type(world) == "table" and Num(world.x) and Num(world.y) then
                    p.continent, p.wx, p.wy = continent, Round(world.x, 1), Round(world.y, 1)
                end
            end
        end
    end
    return p
end

-- Copies a Place() into an entry.
function ns.Stamp(entry, place)
    place = place or ns.Place()
    for _, k in ipairs({ "mapID", "x", "y", "wx", "wy", "continent", "zone", "level" }) do
        entry[k] = place[k]
    end
    return entry
end

---------------------------------------------------------------------------
-- Saved variables
---------------------------------------------------------------------------

ns.DEFAULTS = {
    paused = false,
    settings = {
        shots = {
            dungeon = true, epic = true, level = true,
            blue = false, death = false, boss = false, rare = false, zone = false,
            manual = true,   -- log Print Screen shots too (no shot is taken for these)
        },
        hideUI = true,       -- hide the interface for automatic shots (out of combat only)
        chat = true,         -- [Journey Forever] lines in chat
        minimap = { hide = false, angle = 205 },
    },
}

local function Fill(t, defaults)
    for k, v in pairs(defaults) do
        if type(v) == "table" then
            if type(t[k]) ~= "table" then t[k] = {} end
            Fill(t[k], v)
        elseif t[k] == nil then
            t[k] = v
        end
    end
end

-- Upgrades from older schema versions go here, one step per version.
local MIGRATIONS = {}

local function Load()
    local db = JourneyForeverDB
    if type(db) ~= "table" then db = {} end
    local version = tonumber(db.schemaVersion)
    if version and version > ns.SCHEMA then
        -- Written by a newer version of the addon: leave it as it is.
        ns.readOnly = true
        ns.db = db
        Fill(db, ns.DEFAULTS)
        ns.Say("This character's data is from a newer version of Journey Forever. Update the addon; nothing is recorded until then.")
        return
    end
    for v = (version or ns.SCHEMA) + 1, ns.SCHEMA do
        if MIGRATIONS[v] then MIGRATIONS[v](db) end
    end
    db.schemaVersion = ns.SCHEMA
    if type(db.screenshots) ~= "table" then db.screenshots = {} end
    if type(db.notes) ~= "table" then db.notes = {} end
    if type(db.zones) ~= "table" then db.zones = {} end   -- uiMapID = true, zones visited (for "first visit")
    Fill(db, ns.DEFAULTS)
    JourneyForeverDB = db
    ns.db = db
end

local function UpdateCharacter()
    local db = ns.db
    db.addon = ns.VERSION
    db.utcOffset = ns.UTCOffset()
    local c = type(db.char) == "table" and db.char or {}
    c.guid = Str(Call("UnitGUID", "player")) or c.guid
    c.name = Str(Call("UnitName", "player")) or c.name
    c.realm = Str(Call("GetNormalizedRealmName")) or Str(Call("GetRealmName")) or c.realm
    local _, class = Call("UnitClass", "player")
    local _, race = Call("UnitRace", "player")
    c.class, c.race = Str(class) or c.class, Str(race) or c.race
    c.faction = Str((Call("UnitFactionGroup", "player"))) or c.faction
    c.level = ns.Level() or c.level
    db.char = c
end

-- Runs fn once the saved data is loaded (or now if it already is).
local ready = {}
function ns.OnReady(fn)
    if ns.db then ns.SafeCall(fn) else table.insert(ready, fn) end
end

ns.On("ADDON_LOADED", function(name)
    if name ~= ADDON then return end
    Load()
    for _, fn in ipairs(ready) do ns.SafeCall(fn) end
    ready = {}
end)

ns.On("PLAYER_LOGIN", function()
    if not ns.db or ns.readOnly then return end
    UpdateCharacter()
    ns.Print(ns.db.paused and "Paused. Type /jf resume to start taking screenshots again."
        or "Recording. /jf opens the window, /jf note <text> adds a note.")
end)

ns.On("PLAYER_LEVEL_UP", function(level)
    if ns.db and ns.db.char then ns.db.char.level = Num(level) or ns.db.char.level end
end)

-- Recording means automatic screenshots are on.
function ns.Recording()
    return ns.db ~= nil and not ns.readOnly and not ns.db.paused
end

function ns.SetPaused(paused)
    if not ns.db or ns.readOnly then return end
    ns.db.paused = paused and true or false
    ns.Say(paused and "Paused. No automatic screenshots until /jf resume." or "Recording again.")
    if ns.Refresh then ns.Refresh() end
end

-- Keeps a list from growing without end: drops the oldest entries.
function ns.Trim(list, max)
    while #list > max do table.remove(list, 1) end
end

---------------------------------------------------------------------------
-- Slash commands
---------------------------------------------------------------------------

local HELP = {
    "/jf  open or close the window",
    "/jf note <text>  add a note at your current spot",
    "/jf pause  ·  /jf resume  stop or restart automatic screenshots",
    "/jf shot  take a screenshot now and log it",
    "/jf status  what's recorded and which helper addons are running",
}

function ns.Help()
    for _, line in ipairs(HELP) do ns.Say(line) end
end

SLASH_JOURNEYFOREVER1 = "/jf"
SLASH_JOURNEYFOREVER2 = "/journeyforever"
SlashCmdList.JOURNEYFOREVER = function(msg)
    msg = type(msg) == "string" and msg or ""
    local cmd, rest = msg:match("^%s*(%S*)%s*(.-)%s*$")
    cmd = (cmd or ""):lower()
    if not ns.db then return end
    if cmd == "" then
        if ns.Toggle then ns.Toggle() end
    elseif cmd == "note" then
        ns.AddNote(rest)
    elseif cmd == "pause" then
        ns.SetPaused(true)
    elseif cmd == "resume" then
        ns.SetPaused(false)
    elseif cmd == "shot" or cmd == "screenshot" then
        ns.TakeShot("manual", {}, { force = true })
    elseif cmd == "status" then
        ns.Status()
    else
        ns.Help()
    end
end

function ns.Status()
    local db = ns.db
    ns.Say(("v%s. %s. %d screenshots and %d notes saved for this character."):format(ns.VERSION,
        ns.readOnly and "Not recording (data from a newer version)" or db.paused and "Paused" or "Recording",
        #db.screenshots, #db.notes))
    for _, line in ipairs(ns.CompanionLines and ns.CompanionLines() or {}) do ns.Say(line) end
    if #ns.errors > 0 then
        ns.Say(#ns.errors .. " error(s) caught this session. The first: " .. ns.errors[1])
    end
end

-- Addon compartment (the addons button by the minimap).
function JourneyForever_OnAddonCompartmentClick()
    if ns.Toggle then ns.Toggle() end
end
