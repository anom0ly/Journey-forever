local _, ns = ...

-- Takes screenshots and logs each one in JourneyForeverDB.screenshots:
-- { t, kind, mapID, x, y, wx, wy, continent, zone, level, detail, shot, ok,
-- hiddenUI }. The game saves the picture in its Screenshots folder; shot is
-- the name it is expected to get (WoWScrnShot_MMDDYY_HHMMSS, local time),
-- and ok is set when the game says it was saved (SCREENSHOT_SUCCEEDED) or
-- failed. Two triggers at once share one picture.

local SHARE_WINDOW = 3    -- seconds: a trigger this soon after a shot shares it
local TIMEOUT = 10        -- seconds to wait for the game to confirm a shot
local HIDE_DELAY = 0.1    -- seconds between hiding the interface and the shot

local pending             -- { stem, entries, at, hidden }
local queue = {}          -- shots waiting for the one in progress
local uiHidden = false
local restoreAfterCombat = false

ns.KIND_LABELS = {
    dungeon = "Dungeon completed",
    epic = "Epic loot",
    blue = "Rare loot",
    level = "Level up",
    death = "Death",
    boss = "Boss killed",
    rare = "Rare killed",
    zone = "New zone",
    manual = "Screenshot",
}

local function Now()
    return GetTime and GetTime() or time()
end

local function SetUI(show)
    if ns.InCombat() then return false end
    if SetUIVisibility then
        return pcall(SetUIVisibility, show)
    end
    if not UIParent then return false end
    return pcall(show and UIParent.Show or UIParent.Hide, UIParent)
end

local function HideUI()
    if uiHidden then return true end
    if SetUI(false) then uiHidden = true end
    return uiHidden
end

local function RestoreUI()
    if not uiHidden then return end
    if SetUI(true) then
        uiHidden, restoreAfterCombat = false, false
    else
        restoreAfterCombat = true
    end
end

ns.On("PLAYER_REGEN_ENABLED", function()
    if restoreAfterCombat then RestoreUI() end
end)

local function Stem()
    return "WoWScrnShot_" .. date("%m%d%y_%H%M%S")
end

local function Log(kind, detail, stem)
    local entry = ns.Stamp({ t = time(), kind = kind, detail = detail or {}, shot = stem })
    table.insert(ns.db.screenshots, entry)
    ns.Trim(ns.db.screenshots, ns.MAX_SHOTS)
    if ns.Refresh then ns.Refresh() end
    return entry
end

local function Finish(ok)
    local p = pending
    pending = nil
    if not p then return end
    for _, entry in ipairs(p.entries) do entry.ok = ok end
    if p.hidden then RestoreUI() end
    -- Said after the shot, so the line isn't in the picture.
    local first = p.entries[1]
    if ok and first and first.kind ~= "manual" then
        ns.Print(ns.Describe(first.kind, first.detail) .. ". Screenshot saved for your journey.")
    end
    if ns.Refresh then ns.Refresh() end
    local queued = table.remove(queue, 1)
    if queued then ns.After(0.5, function() ns.Shoot(queued.kind, queued.detail, queued.opts) end) end
end

local function Describe(kind, detail)
    local label = ns.KIND_LABELS[kind] or kind
    if kind == "level" and detail.level then return "Level " .. detail.level end
    if (kind == "epic" or kind == "blue") and detail.name then return label .. ": " .. detail.name end
    if kind == "dungeon" and detail.instance then return "Cleared " .. detail.instance end
    if kind == "boss" and detail.boss then return "Killed " .. detail.boss end
    if kind == "rare" and detail.name then return "Killed " .. detail.name end
    if kind == "zone" and detail.zone then return "First visit: " .. detail.zone end
    return label
end
ns.Describe = Describe

-- Takes the screenshot now (or shares the one just taken).
function ns.Shoot(kind, detail, opts)
    opts = opts or {}
    if pending then
        if Now() - pending.at <= SHARE_WINDOW then
            table.insert(pending.entries, Log(kind, detail, pending.stem))
        else
            table.insert(queue, { kind = kind, detail = detail, opts = opts })
        end
        return
    end
    local hidden = ns.db.settings.hideUI and not opts.keepUI and HideUI()
    pending = { stem = nil, entries = {}, at = Now(), hidden = hidden }
    local p = pending
    ns.After(hidden and HIDE_DELAY or 0, function()
        if pending ~= p then return end
        p.stem = Stem()
        p.at = Now()
        table.insert(p.entries, Log(kind, detail, p.stem))
        if hidden then p.entries[1].hiddenUI = true end
        if not pcall(Screenshot) then
            Finish(false)
            return
        end
        ns.After(TIMEOUT, function()
            if pending == p then Finish(nil) end
        end)
    end)
end

-- A trigger fired. Takes a shot if this kind is switched on and recording
-- isn't paused (opts.force skips both checks, for /jf shot). opts.delay
-- waits first, so the moment is in the picture (the level-up glow).
function ns.TakeShot(kind, detail, opts)
    opts = opts or {}
    if not ns.db or ns.readOnly then return end
    if not opts.force then
        if not ns.Recording() or not ns.db.settings.shots[kind] then return end
    end
    detail = detail or {}
    if opts.delay and opts.delay > 0 then
        ns.After(opts.delay, function() ns.Shoot(kind, detail, opts) end)
    else
        ns.Shoot(kind, detail, opts)
    end
end

ns.On("SCREENSHOT_SUCCEEDED", function()
    if pending then
        Finish(true)
        return
    end
    -- A screenshot the player took (Print Screen): log when and where, so
    -- the website can place it on the journey.
    if ns.Recording() and ns.db.settings.shots.manual then
        Log("manual", {}, Stem()).ok = true
    end
end)

ns.On("SCREENSHOT_FAILED", function()
    if pending then Finish(false) end
end)

-- The latest screenshots, newest first.
function ns.RecentShots(n)
    local list, shots = {}, ns.db and ns.db.screenshots or {}
    for i = #shots, math.max(1, #shots - n + 1), -1 do list[#list + 1] = shots[i] end
    return list
end
