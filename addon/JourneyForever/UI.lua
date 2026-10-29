local _, ns = ...

-- The window (/jf): Screenshots, Notes and Settings tabs. Totals and the
-- event log are left to Road to Sixty and Journey Tracker.

local GOLD = { 0.878, 0.698, 0.322 }
local MUTED = { 0.655, 0.631, 0.588 }
local WIDTH, HEIGHT = 640, 470

local frame, tabs, pages, current = nil, {}, {}, "shots"
local refreshers = {}

local function Text(parent, template, size)
    local fs = parent:CreateFontString(nil, "OVERLAY", template or "GameFontHighlight")
    if size then
        local font, _, flags = fs:GetFont()
        if font then fs:SetFont(font, size, flags) end
    end
    fs:SetJustifyH("LEFT")
    return fs
end

local function Muted(parent, size)
    local fs = Text(parent, "GameFontHighlightSmall", size)
    fs:SetTextColor(unpack(MUTED))
    return fs
end

local function Heading(parent, label)
    local fs = Text(parent, "GameFontNormal")
    fs:SetTextColor(unpack(GOLD))
    fs:SetText(label)
    return fs
end

local function Button(parent, label, width, onClick)
    local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
    b:SetSize(width or 120, 24)
    b:SetText(label)
    b:SetScript("OnClick", function() ns.SafeCall(onClick) end)
    return b
end

-- A checkbox with a label and an optional line under it.
local function Check(parent, label, desc, get, set)
    local cb = CreateFrame("CheckButton", nil, parent, "UICheckButtonTemplate")
    cb:SetSize(24, 24)
    local fs = Text(parent, "GameFontHighlight")
    fs:SetPoint("TOPLEFT", cb, "TOPRIGHT", 4, -4)
    fs:SetText(label)
    cb.label = fs
    if desc then
        local d = Muted(parent)
        d:SetPoint("TOPLEFT", fs, "BOTTOMLEFT", 0, -2)
        d:SetText(desc)
        cb.desc = d
    end
    cb:SetScript("OnClick", function(self)
        ns.SafeCall(set, self:GetChecked() and true or false)
        ns.Refresh()
    end)
    table.insert(refreshers, function() cb:SetChecked(get() and true or false) end)
    return cb
end

local function When(t)
    if not t then return "" end
    local today = date("%x") == date("%x", t)
    return today and date("%H:%M", t) or date("%a %d %b %H:%M", t)
end

---------------------------------------------------------------------------
-- Screenshots tab
---------------------------------------------------------------------------

local SHOT_OPTIONS = {
    { "dungeon", "Dungeon completed (final boss killed)", "Dates every dungeon clear on your journey" },
    { "epic", "Epic (purple) item looted", "Captures the moment it drops" },
    { "level", "Level up", "One shot per level, 1 to 60" },
    { "blue", "Rare (blue) item looted", "More shots early on, when blues are rare" },
    { "death", "Death", "Where it happened" },
    { "boss", "Any boss killed", "Off by default to keep the folder tidy" },
    { "rare", "Rare mob killed", "A rare you tagged and killed" },
    { "zone", "First visit to a new zone", "A postcard from each zone" },
}

local function BuildShots(page)
    local left = Heading(page, "Take a screenshot when...")
    left:SetPoint("TOPLEFT", 0, 0)
    local anchor, gap = left, -8
    for _, opt in ipairs(SHOT_OPTIONS) do
        local key = opt[1]
        local cb = Check(page, opt[2], opt[3],
            function() return ns.db.settings.shots[key] end,
            function(on) ns.db.settings.shots[key] = on end)
        cb:SetPoint("TOPLEFT", anchor, "BOTTOMLEFT", anchor == left and -2 or 0, gap)
        anchor, gap = cb, -14
    end
    local hide = Check(page, "Hide the game interface in screenshots", "Out of combat only",
        function() return ns.db.settings.hideUI end,
        function(on) ns.db.settings.hideUI = on end)
    hide:SetPoint("TOPLEFT", anchor, "BOTTOMLEFT", 0, -22)
    local manual = Check(page, "Log my own Print Screen shots", "Saves when and where, so the site can place them",
        function() return ns.db.settings.shots.manual end,
        function(on) ns.db.settings.shots.manual = on end)
    manual:SetPoint("TOPLEFT", hide, "BOTTOMLEFT", 0, -14)

    local right = Heading(page, "Recent screenshots")
    right:SetPoint("TOPLEFT", 360, 0)
    local rows = {}
    for i = 1, 7 do
        local what = Text(page, "GameFontHighlight")
        what:SetWidth(240)
        what:SetWordWrap(false)
        what:SetPoint("TOPLEFT", right, "BOTTOMLEFT", 0, -10 - (i - 1) * 36)
        local where = Muted(page)
        where:SetWidth(240)
        where:SetWordWrap(false)
        where:SetPoint("TOPLEFT", what, "BOTTOMLEFT", 0, -2)
        rows[i] = { what = what, where = where }
    end
    local empty = Muted(page)
    empty:SetPoint("TOPLEFT", right, "BOTTOMLEFT", 0, -10)
    empty:SetWidth(240)
    empty:SetText("None yet. They'll appear here as you play.")

    local now = Button(page, "Take one now", 120, function() ns.TakeShot("manual", {}, { force = true }) end)
    now:SetPoint("TOPLEFT", right, "BOTTOMLEFT", 0, -270)
    local hint = Muted(page)
    hint:SetPoint("TOPLEFT", now, "BOTTOMLEFT", 0, -8)
    hint:SetWidth(240)
    hint:SetText("Saved to your WoW Screenshots folder. Upload them with your WTF folder and the site places each one on your journey.")

    table.insert(refreshers, function()
        local list = ns.RecentShots(#rows)
        empty:SetShown(#list == 0)
        for i, row in ipairs(rows) do
            local s = list[i]
            if s then
                local label = ns.Describe(s.kind, s.detail or {})
                if s.ok == false then label = label .. " |cffe07a6a(not saved)|r" end
                row.what:SetText(label)
                row.where:SetText((s.zone or "") .. "  ·  " .. When(s.t))
            else
                row.what:SetText("")
                row.where:SetText("")
            end
        end
    end)
end

---------------------------------------------------------------------------
-- Notes tab
---------------------------------------------------------------------------

local function BuildNotes(page)
    local heading = Heading(page, "Add a note at your current spot")
    heading:SetPoint("TOPLEFT", 0, 0)
    local box = CreateFrame("EditBox", nil, page, "InputBoxTemplate")
    box:SetSize(470, 24)
    box:SetPoint("TOPLEFT", heading, "BOTTOMLEFT", 6, -8)
    box:SetAutoFocus(false)
    box:SetMaxLetters(500)
    local function Save()
        if ns.AddNote(box:GetText()) then box:SetText("") end
        box:ClearFocus()
    end
    box:SetScript("OnEnterPressed", Save)
    box:SetScript("OnEscapePressed", function(self) self:ClearFocus() end)
    page.box = box
    local add = Button(page, "Add note", 100, Save)
    add:SetPoint("LEFT", box, "RIGHT", 10, 0)

    local scroll = CreateFrame("ScrollFrame", nil, page, "UIPanelScrollFrameTemplate")
    scroll:SetPoint("TOPLEFT", box, "BOTTOMLEFT", -6, -16)
    scroll:SetPoint("BOTTOMRIGHT", page, "BOTTOMRIGHT", -26, 0)
    local content = CreateFrame("Frame", nil, scroll)
    content:SetSize(560, 10)
    scroll:SetScrollChild(content)

    local empty = Muted(page)
    empty:SetPoint("TOPLEFT", scroll, "TOPLEFT", 0, 0)
    empty:SetText("No notes yet. Type one above, or /jf note <text> anywhere.")

    local rows = {}
    local function Row(i)
        if rows[i] then return rows[i] end
        local r = CreateFrame("Frame", nil, content)
        r:SetSize(560, 44)
        r.text = Text(r, "GameFontHighlight")
        r.text:SetPoint("TOPLEFT", 0, -2)
        r.text:SetWidth(520)
        r.where = Muted(r)
        r.where:SetPoint("TOPLEFT", r.text, "BOTTOMLEFT", 0, -3)
        r.delete = CreateFrame("Button", nil, r, "UIPanelCloseButton")
        r.delete:SetSize(22, 22)
        r.delete:SetPoint("TOPRIGHT", 0, 0)
        r.delete:SetScript("OnClick", function() ns.DeleteNote(r.note) end)
        rows[i] = r
        return r
    end

    table.insert(refreshers, function()
        local notes = ns.db.notes
        empty:SetShown(#notes == 0)
        local y, shown = 0, 0
        for i = #notes, 1, -1 do
            shown = shown + 1
            local n, r = notes[i], Row(shown)
            r.note = n
            r.text:SetText(n.text)
            local place = n.instance or n.subzone or n.zone or ""
            r.where:SetText(place .. (n.level and ("  ·  level " .. n.level) or "") .. "  ·  " .. When(n.t))
            r:SetHeight(r.text:GetStringHeight() + 24)
            r:ClearAllPoints()
            r:SetPoint("TOPLEFT", 0, -y)
            r:Show()
            y = y + r:GetHeight() + 6
        end
        for i = shown + 1, #rows do rows[i]:Hide() end
        content:SetHeight(math.max(10, y))
    end)
end

---------------------------------------------------------------------------
-- Settings tab
---------------------------------------------------------------------------

local function Loaded(name)
    return ns.Call("C_AddOns.IsAddOnLoaded", name) == true
end

-- Road to Sixty and Journey Tracker, and whether they also shoot at level up.
function ns.CompanionLines()
    local lines = {}
    local rts, jt = Loaded("RoadToSixty"), Loaded("JourneyTracker")
    table.insert(lines, "Road to Sixty: " .. (rts and "|cff9fe0dcrunning|r" or "|cffe07a6anot found|r (the map trail comes from it)"))
    table.insert(lines, "Journey Tracker: " .. (jt and "|cff9fe0dcrunning|r" or "|cffe07a6anot found|r (gold and stats come from it)"))
    return lines
end

local function RTSLevelShots()
    return Loaded("RoadToSixty") and type(RoadToSixtyDB) == "table" and RoadToSixtyDB.levelShot ~= false
end

local COMMANDS = {
    { "/jf", "Open or close this window" },
    { "/jf note <text>", "Add a note at your current spot" },
    { "/jf pause  ·  /jf resume", "Stop or restart automatic screenshots" },
    { "/jf shot", "Take a screenshot now and log it" },
    { "/jf status", "What's saved, and which helper addons are running" },
    { "/reload", "Save to disk now without logging out" },
}

local function BuildSettings(page)
    local h = Heading(page, "Journey Forever")
    h:SetPoint("TOPLEFT", 0, 0)
    local chat = Check(page, "Show Journey Forever messages in chat", nil,
        function() return ns.db.settings.chat end,
        function(on) ns.db.settings.chat = on end)
    chat:SetPoint("TOPLEFT", h, "BOTTOMLEFT", -2, -8)
    local mm = Check(page, "Show minimap button", nil,
        function() return not ns.db.settings.minimap.hide end,
        function(on)
            ns.db.settings.minimap.hide = not on
            if ns.UpdateMinimap then ns.UpdateMinimap() end
        end)
    mm:SetPoint("TOPLEFT", chat, "BOTTOMLEFT", 0, -6)

    local h2 = Heading(page, "Helper addons")
    h2:SetPoint("TOPLEFT", mm, "BOTTOMLEFT", 2, -16)
    local status = Text(page, "GameFontHighlight")
    status:SetPoint("TOPLEFT", h2, "BOTTOMLEFT", 0, -8)
    status:SetWidth(280)
    status:SetSpacing(4)
    local dupe = Muted(page)
    dupe:SetPoint("TOPLEFT", status, "BOTTOMLEFT", 0, -10)
    dupe:SetWidth(280)
    dupe:SetSpacing(2)
    local off = Button(page, "Turn theirs off", 130, function()
        if type(RoadToSixtyDB) == "table" then RoadToSixtyDB.levelShot = false end
        ns.Say("Road to Sixty's level-up screenshots are off.")
    end)
    off:SetPoint("TOPLEFT", dupe, "BOTTOMLEFT", 0, -6)

    local h3 = Heading(page, "Slash commands")
    h3:SetPoint("TOPLEFT", 320, 0)
    local anchor = h3
    for _, c in ipairs(COMMANDS) do
        local cmd = Text(page, "GameFontHighlight")
        cmd:SetPoint("TOPLEFT", anchor, "BOTTOMLEFT", 0, anchor == h3 and -8 or -10)
        cmd:SetText(c[1])
        local desc = Muted(page)
        desc:SetPoint("TOPLEFT", cmd, "BOTTOMLEFT", 0, -2)
        desc:SetText(c[2])
        anchor = desc
    end
    local saved = Muted(page)
    saved:SetPoint("TOPLEFT", anchor, "BOTTOMLEFT", 0, -18)
    saved:SetWidth(280)

    table.insert(refreshers, function()
        status:SetText(table.concat(ns.CompanionLines(), "\n"))
        local rts, ours = RTSLevelShots(), ns.db.settings.shots.level
        local lines = {}
        if ours and rts then
            table.insert(lines, "Road to Sixty also takes a screenshot at each level up. Turn one off to avoid two of each.")
        end
        if ours and Loaded("JourneyTracker") then
            table.insert(lines, "Journey Tracker can too: type /journey screenshots to switch its own off.")
        end
        dupe:SetText(table.concat(lines, "\n"))
        off:SetShown(ours and rts)
        saved:SetText(("Saved for this character: %d screenshots, %d notes. Written to disk when you log out or /reload.")
            :format(#ns.db.screenshots, #ns.db.notes))
    end)
end

---------------------------------------------------------------------------
-- The window
---------------------------------------------------------------------------

local TABS = { { "shots", "Screenshots", BuildShots }, { "notes", "Notes", BuildNotes }, { "settings", "Settings", BuildSettings } }

local function Select(id)
    current = id
    for key, page in pairs(pages) do page:SetShown(key == id) end
    for key, tab in pairs(tabs) do
        local on = key == id
        tab.label:SetTextColor(unpack(on and GOLD or MUTED))
        tab.bg:SetColorTexture(on and 0.082 or 0.118, on and 0.094 or 0.133, on and 0.125 or 0.169, 1)
    end
end

local function Build()
    frame = CreateFrame("Frame", "JourneyForeverFrame", UIParent, "BackdropTemplate")
    frame:SetSize(WIDTH, HEIGHT)
    frame:SetPoint("CENTER")
    frame:SetFrameStrata("HIGH")
    frame:SetMovable(true)
    frame:SetClampedToScreen(true)
    frame:EnableMouse(true)
    frame:RegisterForDrag("LeftButton")
    frame:SetScript("OnDragStart", frame.StartMoving)
    frame:SetScript("OnDragStop", frame.StopMovingOrSizing)
    frame:SetBackdrop({
        bgFile = "Interface\\Buttons\\WHITE8x8", edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border",
        edgeSize = 14, insets = { left = 3, right = 3, top = 3, bottom = 3 },
    })
    frame:SetBackdropColor(0.055, 0.063, 0.086, 0.96)
    frame:SetBackdropBorderColor(0.55, 0.48, 0.31, 1)
    table.insert(UISpecialFrames, "JourneyForeverFrame")   -- Escape closes it

    local title = Text(frame, "GameFontNormalLarge")
    title:SetPoint("TOPLEFT", 16, -14)
    title:SetTextColor(unpack(GOLD))
    local close = CreateFrame("Button", nil, frame, "UIPanelCloseButton")
    close:SetPoint("TOPRIGHT", -4, -4)

    local dot = frame:CreateTexture(nil, "OVERLAY")
    dot:SetSize(8, 8)
    dot:SetPoint("TOPLEFT", title, "BOTTOMLEFT", 0, -10)
    local state = Text(frame, "GameFontHighlightSmall")
    state:SetPoint("LEFT", dot, "RIGHT", 6, 0)
    local pause = Button(frame, "Pause", 90, function() ns.SetPaused(not ns.db.paused) end)
    pause:SetPoint("TOPRIGHT", -36, -36)

    local x = 16
    for _, def in ipairs(TABS) do
        local id = def[1]
        local tab = CreateFrame("Button", nil, frame)
        tab:SetSize(110, 28)
        tab:SetPoint("TOPLEFT", x, -66)
        tab.bg = tab:CreateTexture(nil, "BACKGROUND")
        tab.bg:SetAllPoints()
        tab.label = Text(tab, "GameFontNormal")
        tab.label:SetPoint("CENTER")
        tab.label:SetText(def[2])
        tab:SetScript("OnClick", function() Select(id) end)
        tabs[id] = tab
        x = x + 114

        local page = CreateFrame("Frame", nil, frame)
        page:SetPoint("TOPLEFT", 20, -110)
        page:SetPoint("BOTTOMRIGHT", -20, 16)
        def[3](page)
        pages[id] = page
    end

    table.insert(refreshers, 1, function()
        local name = ns.db.char and ns.db.char.name
        title:SetText("Journey Forever" .. (name and ("  ·  " .. name) or ""))
        local recording = ns.Recording()
        if recording then dot:SetColorTexture(0.878, 0.478, 0.416, 1) else dot:SetColorTexture(0.55, 0.58, 0.62, 1) end
        state:SetText(ns.readOnly and "Not recording: this character's data is from a newer version"
            or recording and "Recording: automatic screenshots are on" or "Paused: no automatic screenshots")
        pause:SetText(ns.db.paused and "Resume" or "Pause")
        pause:SetShown(not ns.readOnly)
    end)
    frame:SetScript("OnShow", function() ns.Refresh() end)
    frame:Hide()
end

function ns.Refresh()
    if not frame or not frame:IsShown() or not ns.db then return end
    for _, fn in ipairs(refreshers) do ns.SafeCall(fn) end
end

function ns.Show(tab)
    if not ns.db then return end
    if not frame then Build() end
    Select(tab or current)
    frame:Show()
    ns.Refresh()
    if tab == "notes" and pages.notes.box then pages.notes.box:SetFocus() end
end

function ns.Toggle()
    if frame and frame:IsShown() then frame:Hide() else ns.Show() end
end
