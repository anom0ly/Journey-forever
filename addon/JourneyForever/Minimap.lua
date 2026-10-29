local _, ns = ...

-- Minimap button: left-click opens the window, right-click pauses or
-- resumes, drag to move it around the minimap.

local button

local function Place()
    local angle = math.rad(ns.db.settings.minimap.angle or 205)
    local radius = (Minimap:GetWidth() / 2) + 6
    button:ClearAllPoints()
    button:SetPoint("CENTER", Minimap, "CENTER", math.cos(angle) * radius, math.sin(angle) * radius)
end

local function OnDrag()
    local mx, my = Minimap:GetCenter()
    local scale = Minimap:GetEffectiveScale()
    local cx, cy = GetCursorPosition()
    local dx, dy = cx / scale - mx, cy / scale - my
    local angle = math.deg(math.atan2 and math.atan2(dy, dx) or math.atan(dy, dx))
    ns.db.settings.minimap.angle = angle % 360
    Place()
end

local function Build()
    button = CreateFrame("Button", "JourneyForeverMinimapButton", Minimap)
    button:SetSize(32, 32)
    button:SetFrameStrata("MEDIUM")
    button:SetFrameLevel(8)
    button:RegisterForClicks("LeftButtonUp", "RightButtonUp")
    button:RegisterForDrag("LeftButton")
    button:SetHighlightTexture("Interface\\Minimap\\UI-Minimap-ZoomButton-Highlight")

    local icon = button:CreateTexture(nil, "BACKGROUND")
    icon:SetSize(20, 20)
    icon:SetPoint("CENTER", 0, 1)
    icon:SetTexture("Interface\\Icons\\INV_Misc_Book_09")
    local border = button:CreateTexture(nil, "OVERLAY")
    border:SetSize(54, 54)
    border:SetPoint("TOPLEFT")
    border:SetTexture("Interface\\Minimap\\MiniMap-TrackingBorder")

    button:SetScript("OnClick", function(_, which)
        if which == "RightButton" then ns.SetPaused(not ns.db.paused) else ns.Toggle() end
    end)
    button:SetScript("OnDragStart", function(self) self:SetScript("OnUpdate", OnDrag) end)
    button:SetScript("OnDragStop", function(self) self:SetScript("OnUpdate", nil) end)
    button:SetScript("OnEnter", function(self)
        GameTooltip:SetOwner(self, "ANCHOR_LEFT")
        GameTooltip:AddLine("Journey Forever", 0.878, 0.698, 0.322)
        GameTooltip:AddLine(ns.Recording() and "Recording" or "Paused", 1, 1, 1)
        GameTooltip:AddLine(("%d screenshots, %d notes"):format(#ns.db.screenshots, #ns.db.notes), 0.65, 0.63, 0.59)
        GameTooltip:AddLine("Left-click: open  ·  Right-click: pause or resume", 0.65, 0.63, 0.59)
        GameTooltip:Show()
    end)
    button:SetScript("OnLeave", function() GameTooltip:Hide() end)
end

function ns.UpdateMinimap()
    if not ns.db or not Minimap then return end
    if ns.db.settings.minimap.hide then
        if button then button:Hide() end
        return
    end
    if not button then Build() end
    Place()
    button:Show()
end

ns.On("PLAYER_LOGIN", function() ns.UpdateMinimap() end)
