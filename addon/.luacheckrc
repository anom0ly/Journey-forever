-- luacheck config for the addon: lua5.1, WoW client globals.
std = "lua51"
max_line_length = 140
exclude_files = { "tests/**" }

globals = {
    "JourneyForeverDB", "SlashCmdList", "SLASH_JOURNEYFOREVER1", "SLASH_JOURNEYFOREVER2",
    "JourneyForever_OnAddonCompartmentClick", "UISpecialFrames",
    "RoadToSixtyDB",   -- only to switch its level-up screenshots off, when asked
}

read_globals = {
    "C_AddOns", "C_Container", "C_Item", "C_Map", "C_Timer", "Enum",
    "CreateFrame", "UIParent", "Minimap", "GameTooltip",
    "GetTime", "time", "date", "issecretvalue", "InCombatLockdown", "Screenshot", "SetUIVisibility",
    "GetCursorPosition", "NUM_BAG_SLOTS", "LOOT_ITEM_SELF", "LOOT_ITEM_SELF_MULTIPLE",
}
