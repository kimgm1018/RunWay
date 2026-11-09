-- users.md U28: issue a phone verification code. Only hashes arrive here; never phone numbers or codes.
-- KEYS: code, resend wait, phone 24h window, IP 24h window. ARGV: code hash, unique window member.
-- Returns {1, expiresInSec}, {-2, retryAfterSec} resend wait, {-3, retryAfterSec} 24h limit, {-1, 0} malformed.
if #KEYS ~= 4 or #ARGV ~= 2 or not string.match(ARGV[1], '^[0-9a-f]+$') then
    return {-1, 0}
end
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local day = 86400000
local wait = redis.call('PTTL', KEYS[2])
if wait > 0 then
    return {-2, math.ceil(wait / 1000)}
end
-- Allocation comes first so Redis noeviction/OOM cannot be bypassed by a delete-first script.
local windowEnd = math.floor((now + day) / 1000) + 1
redis.call('ZADD', KEYS[3], now, ARGV[2])
redis.call('ZADD', KEYS[4], now, ARGV[2])
redis.call('EXPIREAT', KEYS[3], windowEnd)
redis.call('EXPIREAT', KEYS[4], windowEnd)
redis.call('ZREMRANGEBYSCORE', KEYS[3], '-inf', now - day)
redis.call('ZREMRANGEBYSCORE', KEYS[4], '-inf', now - day)
local over = nil
if redis.call('ZCARD', KEYS[3]) > 5 then
    over = KEYS[3]
elseif redis.call('ZCARD', KEYS[4]) > 20 then
    over = KEYS[4]
end
if over then
    redis.call('ZREM', KEYS[3], ARGV[2])
    redis.call('ZREM', KEYS[4], ARGV[2])
    local oldest = redis.call('ZRANGE', over, 0, 0, 'WITHSCORES')
    local retry = 1
    if oldest[2] then
        retry = math.max(1, math.ceil((tonumber(oldest[2]) + day - now) / 1000))
    end
    return {-3, retry}
end
local expires = now + 180000
redis.call('SET', KEYS[2], '1', 'PXAT', string.format('%.0f', now + 60000))
-- A new code replaces the previous one and its failure count.
redis.call('SET', KEYS[1], ARGV[1] .. ':0:' .. string.format('%.0f', expires),
    'PXAT', string.format('%.0f', expires))
return {1, 180}
