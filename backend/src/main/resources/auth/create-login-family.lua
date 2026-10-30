-- No raw credentials are passed. Incomplete mutations never become an ACTIVE grant.
local family, user, digest = ARGV[1], ARGV[2], ARGV[3]
local created, expires = tonumber(ARGV[4]), tonumber(ARGV[5])
if (#KEYS ~= 2 and #KEYS ~= 3) or not family or #family ~= 22 or not string.match(family, '^[%w_-]+$')
    or not user or not string.match(user, '^[1-9]%d*$')
    or not digest or #digest ~= 64 or not string.match(digest, '^[0-9a-f]+$')
    or not created or not expires or created ~= math.floor(created) or expires ~= math.floor(expires)
    or expires <= created or expires - created > 2592000 then return -1 end
local kind = redis.call('TYPE', KEYS[1]).ok
local indexKind = redis.call('TYPE', KEYS[2]).ok
if kind ~= 'none' or (indexKind ~= 'none' and indexKind ~= 'zset') then return -1 end
local now = tonumber(redis.call('TIME')[1])
if now >= expires then return -1 end
if #KEYS == 3 then
    -- This check and the final reset share the activation script with every competing failure.
    local time = redis.call('TIME')
    local millis = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
    local value = redis.call('GET', KEYS[3])
    if value then
        local count, deadline = string.match(value, '^([1-5]):(%d+)$')
        count, deadline = tonumber(count), tonumber(deadline)
        if not count or not deadline or redis.call('PTTL', KEYS[3]) < 0 then return -1 end
        if deadline > millis then
            if deadline - millis > (count == 5 and 600000 or 86400000) then return -1 end
            if count == 5 then return 5 end
        end
    end
    -- DEL is the only command after activation. Check its ACL before any mutation.
    if not redis.acl_check_cmd('DEL', KEYS[3]) then return -1 end
end
-- Allocate first: a delete-first script can bypass Redis's OOM gate.
redis.call('ZADD', KEYS[2], expires, family)
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now)
local last = redis.call('ZRANGE', KEYS[2], -1, -1, 'WITHSCORES')
redis.call('EXPIREAT', KEYS[2], last[2])
redis.call('HSET', KEYS[1], 'schemaVersion', '1', 'userId', user,
    'createdAt', ARGV[4], 'expiresAt', ARGV[5], 'state', 'PENDING', 'currentTokenHash', digest)
redis.call('EXPIREAT', KEYS[1], expires)
-- Final authority mutation: nothing fallible is written after activation.
redis.call('HSET', KEYS[1], 'state', 'ACTIVE')
if #KEYS == 3 then redis.call('DEL', KEYS[3]) end
return 1
