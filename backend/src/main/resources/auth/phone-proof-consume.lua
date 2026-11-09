-- users.md U15·U30: consume a one-time proof atomically. Returns its value once, then nil.
-- GETDEL is not in the app ACL, so GET and DEL run together here.
local value = redis.call('GET', KEYS[1])
if not value then
    return false
end
redis.call('DEL', KEYS[1])
return value
