local _, ns = ...

-- Battle.net friends, for the website to highlight friends' public
-- characters. Only BattleTags are kept, never real names, notes or
-- character friends:
--
--   JourneyForeverDB.friends = { t = time(), tags = { "Name#1234", ... } }
--
-- The upload page hashes each tag in the browser before sending, so the
-- tags themselves never leave the player's computer.

local Call, Str, Num = ns.Call, ns.Str, ns.Num
local MAX = 500
local TAG = "^[^#|%c]+#%d+$"

-- The friend's BattleTag at index i, from whichever API this client has.
local function TagAt(i)
    local info = Call("C_BattleNet.GetFriendAccountInfo", i)
    if type(info) == "table" then
        local tag = Str(info.battleTag)
        if tag then return tag end
    end
    local _, _, tag = Call("BNGetFriendInfo", i)
    return Str(tag)
end

function ns.ReadFriends()
    local count = Num(Call("BNGetNumFriends"))
    if not count then return nil end
    local seen, tags = {}, {}
    for i = 1, math.min(count, MAX) do
        local tag = TagAt(i)
        if tag and #tag <= 64 and tag:find(TAG) and not seen[tag:lower()] then
            seen[tag:lower()] = true
            tags[#tags + 1] = tag
        end
    end
    table.sort(tags, function(a, b) return a:lower() < b:lower() end)
    return tags
end

-- Saves the list, unless the client gave nothing back (offline from
-- Battle.net, or the calls are blocked): an earlier list is kept then.
function ns.SaveFriends()
    if not ns.db or ns.readOnly then return end
    local tags = ns.ReadFriends()
    if not tags or (#tags == 0 and ns.db.friends) then return end
    ns.db.friends = { t = time(), tags = tags }
end

local pending = false
local function Later()
    if pending then return end
    pending = true
    ns.After(3, function()
        pending = false
        ns.SaveFriends()
    end)
end

ns.On("PLAYER_LOGIN", Later)
ns.On("BN_FRIEND_LIST_SIZE_CHANGED", Later)
ns.On("BN_CONNECTED", Later)
