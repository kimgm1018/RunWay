-- All accessed keys are supplied explicitly. PostgreSQL user locking serializes
-- legitimate login/refresh with the calling withdrawal transaction.
if #ARGV ~= 1 or #KEYS < 1 or not string.match(ARGV[1], '^[1-9]%d*$') then return -1 end
local user = ARGV[1]
if KEYS[1] ~= 'runway:auth:user:' .. user .. ':families' then return -1 end
local kind = redis.call('TYPE', KEYS[1]).ok
if kind == 'none' then
    if #KEYS == 1 then return 1 end
    -- The index may expire between candidate read and execution. Every supplied
    -- family must also have expired; never certify a lost index with live keys.
    for i = 2, #KEYS do
        if redis.call('TYPE', KEYS[i]).ok ~= 'none' then return -1 end
    end
    return 1
end
if kind ~= 'zset' then return -1 end
local families = redis.call('ZRANGE', KEYS[1], 0, -1)
if #families ~= #KEYS - 1 then return -1 end
local present = {}
-- Validate every key and its owner before the first write. Redis script errors
-- do not roll back earlier writes, so malformed data/ACL failures must not
-- cause an avoidable partial revocation.
for i, family in ipairs(families) do
    local key = KEYS[i + 1]
    if #family ~= 22 or not string.match(family, '^[%w_-]+$')
        or key ~= 'runway:auth:family:' .. family then return -1 end
    local familyKind = redis.call('TYPE', key).ok
    if familyKind ~= 'none' then
        if familyKind ~= 'hash' then return -1 end
        local owner = redis.call('HGET', key, 'userId')
        if owner ~= user or not redis.acl_check_cmd('HSET', key, 'state', 'REVOKED') then
            return -1
        end
        present[#present + 1] = key
    end
end
for _, key in ipairs(present) do
    redis.call('HSET', key, 'state', 'REVOKED')
end
-- Do not delete the index or change TTLs. They allow retries and retain the
-- same absolute lifetime as ordinary logout, including the used-token history.
return 1
