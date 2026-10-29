-- A small stand-in for the WoW client, enough to load the addon and drive
-- its events offline: lua5.1 addon/tests/run.lua

local W = { events = {}, timers = {}, clock = 1000, printed = {}, screenshots = 0 }

-- Frames: every method is accepted; the ones the addon reads answer.
local Frame = {}
function Frame:__index(key)
    local v = rawget(Frame, key)
    if v ~= nil then return v end
    return function() end
end
function Frame.new(kind)
    return setmetatable({ kind = kind, scripts = {}, shown = true, text = "", checked = false }, Frame)
end
function Frame:RegisterEvent(e) W.events[e] = W.events[e] or {}; table.insert(W.events[e], self) end
function Frame:SetScript(name, fn) self.scripts[name] = fn end
function Frame:GetScript(name) return self.scripts[name] end
function Frame:Show() local was = self.shown; self.shown = true; if not was and self.scripts.OnShow then self.scripts.OnShow(self) end end
function Frame:Hide() self.shown = false end
function Frame:SetShown(on) if on then self:Show() else self:Hide() end end
function Frame:IsShown() return self.shown end
function Frame:SetText(t) self.text = t end
function Frame:GetText() return self.text end
function Frame:SetChecked(on) self.checked = on end
function Frame:GetChecked() return self.checked end
function Frame:GetFont() return "Fonts\\FRIZQT__.TTF", 12, "" end
function Frame:GetStringHeight() return 12 end
function Frame:GetHeight() return self.height or 20 end
function Frame:SetHeight(h) self.height = h end
function Frame:GetWidth() return 140 end
function Frame:GetCenter() return 500, 500 end
function Frame:GetEffectiveScale() return 1 end
function Frame:CreateFontString() return Frame.new("FontString") end
function Frame:CreateTexture() return Frame.new("Texture") end
function Frame:Click(button) if self.scripts.OnClick then self.scripts.OnClick(self, button or "LeftButton") end end

function CreateFrame(kind, name, parent, template)
    local f = Frame.new(kind)
    if kind ~= "Frame" or name then f.shown = true end
    if name then _G[name] = f end
    return f
end

UIParent = Frame.new("Frame")
Minimap = Frame.new("Frame")
GameTooltip = Frame.new("GameTooltip")
UISpecialFrames = {}
SlashCmdList = {}
Enum = { UIMapType = { Zone = 3 }, BagIndex = {} }
NUM_BAG_SLOTS = 4
LOOT_ITEM_SELF = "You receive loot: %s."
LOOT_ITEM_SELF_MULTIPLE = "You receive loot: %sx%d."

function print(...)
    local parts = {}
    for i = 1, select("#", ...) do parts[#parts + 1] = tostring((select(i, ...))) end
    table.insert(W.printed, table.concat(parts, " "))
end

-- Secret values: any table marked secret.
W.SECRET = setmetatable({}, { __tostring = function() return "<secret>" end })
function issecretvalue(v) return v == W.SECRET end

function GetTime() return W.clock end
local realTime = os.time
W.now = realTime({ year = 2026, month = 11, day = 4, hour = 19, min = 30, sec = 0 })
time = function(t) if t then return realTime(t) end return W.now + math.floor(W.clock - 1000) end
date = function(fmt, t) return os.date(fmt, t or time()) end
InCombatLockdown = function() return W.combat == true end

C_Timer = { After = function(seconds, fn) table.insert(W.timers, { at = W.clock + seconds, fn = fn }) end }
C_AddOns = {
    GetAddOnMetadata = function() return "1.0.0" end,
    IsAddOnLoaded = function(name) return W.loaded[name] == true end,
}
W.loaded = { RoadToSixty = true }

-- The player and the world, set by tests.
W.player = { level = 23, map = 1431, x = 0.42, y = 0.61, zone = "Duskwood", subzone = "Darkshire",
    instance = nil, dead = false }
W.bags = {}      -- { [bag] = { [slot] = info } }
W.worn = {}      -- { [slot] = link }

UnitLevel = function() return W.player.level end
UnitGUID = function(unit)
    if unit == "player" then return "Player-1234-0ABCDEF0" end
    return W.target and W.target.guid
end
UnitName = function(unit) if unit == "player" then return "Testchar" end return W.target and W.target.name end
UnitClass = function() return "Warrior", "WARRIOR" end
UnitRace = function() return "Human", "Human" end
UnitFactionGroup = function() return "Alliance" end
GetNormalizedRealmName = function() return "TestRealm" end
UnitIsDeadOrGhost = function() return W.player.dead end
UnitClassification = function() return W.target and W.target.classification or "normal" end
UnitIsPlayer = function() return false end
UnitIsDead = function() return W.target and W.target.dead or false end
UnitIsTapDenied = function() return false end
GetRealZoneText = function() return W.player.instance or W.player.zone end
GetZoneText = GetRealZoneText
GetSubZoneText = function() return W.player.subzone end
IsInInstance = function()
    if W.player.instance then return true, W.player.instanceKind or "party" end
    return false, "none"
end
GetInstanceInfo = function()
    return W.player.instance, "party", 1, "Normal", 5, 0, false, W.player.instanceID
end
SetUIVisibility = function(show) W.uiVisible = show end
Screenshot = function() W.screenshots = W.screenshots + 1 end

local Vector = {}
Vector.__index = Vector
function Vector:GetXY() return self.x, self.y end

C_Map = {
    GetBestMapForUnit = function() return W.player.map end,
    GetPlayerMapPosition = function()
        if W.player.instance then return nil end
        return setmetatable({ x = W.player.x, y = W.player.y }, Vector)
    end,
    GetWorldPosFromMapPos = function(_, pos) return 0, { x = -10100 - pos.y * 1500, y = 1400 - pos.x * 1300 } end,
    GetMapInfo = function(id)
        if id == 1431 then return { mapID = 1431, name = "Duskwood", mapType = 3, parentMapID = 1415 } end
        if id == 1433 then return { mapID = 1433, name = "Redridge Mountains", mapType = 3, parentMapID = 1415 } end
        if id == 9999 then return { mapID = 9999, name = "Darkshire", mapType = 5, parentMapID = 1431 } end
        return { mapID = id, name = "Continent", mapType = 2 }
    end,
}
C_Container = {
    GetContainerNumSlots = function(bag) return 16 end,
    GetContainerItemInfo = function(bag, slot) return W.bags[bag] and W.bags[bag][slot] end,
}
C_Item = {
    GetItemQualityByID = function(id) return W.quality and W.quality[id] end,
    GetItemInfo = function() return nil end,
}
GetInventoryItemLink = function(_, slot) return W.worn[slot] end

-- Fires an event at every frame that registered it.
function W.Fire(event, ...)
    for _, f in ipairs(W.events[event] or {}) do
        if f.scripts.OnEvent then f.scripts.OnEvent(f, event, ...) end
    end
end

-- Moves the clock on, running timers as they come due.
function W.Advance(seconds)
    local target = W.clock + seconds
    while true do
        table.sort(W.timers, function(a, b) return a.at < b.at end)
        local t = W.timers[1]
        if not t or t.at > target then break end
        table.remove(W.timers, 1)
        W.clock = math.max(W.clock, t.at)
        t.fn()
    end
    W.clock = target
end

function W.Load(dir, ns)
    local toc = assert(io.open(dir .. "/JourneyForever.toc")):read("*a")
    for file in toc:gmatch("\n([%w_]+%.lua)") do
        local chunk = assert(loadfile(dir .. "/" .. file))
        chunk("JourneyForever", ns)
    end
end

function W.Link(id, name, color)
    return ("|cff%s|Hitem:%d::::::::23:::::|h[%s]|h|r"):format(color, id, name)
end

return W
