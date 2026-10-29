local _, ns = ...

-- Notes: /jf note <text>, or the Notes tab. Saved in JourneyForeverDB.notes
-- as { t, text, mapID, x, y, wx, wy, continent, zone, subzone, level, instance }.
-- Notes are kept while recording is paused: pausing only stops screenshots.

local MAX_LENGTH = 500

function ns.AddNote(text)
    if not ns.db then return end
    if ns.readOnly then
        ns.Say("Not saved: update Journey Forever first.")
        return
    end
    text = type(text) == "string" and text:gsub("^%s+", ""):gsub("%s+$", "") or ""
    if text == "" then
        if ns.Show then ns.Show("notes") else ns.Say("Type /jf note followed by your note.") end
        return
    end
    if #text > MAX_LENGTH then text = text:sub(1, MAX_LENGTH) end
    local place = ns.Place()
    local note = ns.Stamp({ t = time(), text = text }, place)
    note.subzone, note.instance = place.subzone, place.instance
    table.insert(ns.db.notes, note)
    ns.Trim(ns.db.notes, ns.MAX_NOTES)
    ns.Say(("Note saved%s."):format(place.zone and (" in " .. (place.subzone or place.zone)) or ""))
    if ns.Refresh then ns.Refresh() end
    return note
end

function ns.DeleteNote(note)
    if not ns.db or ns.readOnly then return end
    for i, n in ipairs(ns.db.notes) do
        if n == note then
            table.remove(ns.db.notes, i)
            break
        end
    end
    if ns.Refresh then ns.Refresh() end
end
