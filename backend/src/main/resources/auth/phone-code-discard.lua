-- users.md U28: remove a code the SMS provider clearly rejected, only if it was not replaced meanwhile.
-- KEYS: code. ARGV: code hash. Returns 1 removed, 0 untouched.
local value = redis.call('GET', KEYS[1])
if value and string.sub(value, 1, #ARGV[1] + 1) == ARGV[1] .. ':' then
    redis.call('DEL', KEYS[1])
    return 1
end
return 0
