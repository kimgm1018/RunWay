-- Return 1: rotated, 0: invalid/reused (family revoked), -1: malformed storage.
-- Only hashes are arguments. One final HSET makes history and current hash indivisible.
local key = KEYS[1]
local old, replacement = ARGV[1], ARGV[2]
local function digest(value)
    return value and #value == 64 and string.match(value, '^[0-9a-f]+$')
end
if #KEYS ~= 1 or #ARGV ~= 6 or not digest(old) or not digest(replacement) or old == replacement
    or not string.match(ARGV[3], '^[1-9]%d*$') then return -1 end
local kind = redis.call('TYPE', key).ok
if kind == 'none' then return 0 end
if kind ~= 'hash' then return -1 end
local fields = redis.call('HMGET', key, 'schemaVersion', 'userId', 'createdAt',
    'expiresAt', 'state', 'currentTokenHash', 'used:' .. old)
local ttl = redis.call('PTTL', key)
if fields[5] == 'PENDING' or fields[5] == 'REVOKED' or ttl <= 0 then return 0 end
if fields[1] ~= '1' or fields[5] ~= 'ACTIVE' or not digest(fields[6])
    or not fields[2] or not fields[3] or not fields[4] then return 0 end
local created, expires = tonumber(fields[3]), tonumber(fields[4])
local appMillis = tonumber(ARGV[6])
if not created or not expires or not appMillis or expires <= created
    or expires - created > 2592000 or created ~= math.floor(created)
    or expires ~= math.floor(expires) then return -1 end
local time = redis.call('TIME')
local nowMillis = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
if nowMillis >= expires * 1000 then return 0 end
if fields[2] ~= ARGV[3] or fields[3] ~= ARGV[4] or fields[4] ~= ARGV[5] then return 0 end
if fields[7] == '1' then
    redis.call('HSET', key, 'state', 'REVOKED')
    return 0
end
if fields[6] ~= old then return 0 end
if expires * 1000 - math.max(nowMillis, appMillis) < 1000 then return 0 end
-- No TTL/index mutation: both remain tied to the original absolute deadline.
redis.call('HSET', key, 'used:' .. old, '1', 'currentTokenHash', replacement)
return 1
