-- Atomic rolling window, Redis server time, at most 60 retained requests per IP.
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
-- Allocation comes first so Redis noeviction/OOM cannot be bypassed by a delete-first script.
redis.call('ZADD', KEYS[1], now, ARGV[1])
redis.call('EXPIREAT', KEYS[1], math.floor(now / 1000) + 61)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - 60000)
if redis.call('ZCARD', KEYS[1]) > 60 then
    redis.call('ZREM', KEYS[1], ARGV[1])
    return 0
end
return 1
