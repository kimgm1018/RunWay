-- Unknown, expired and revoked credentials all yield idempotent success.
-- A visible family identifier alone never authorizes revocation.
if #KEYS ~= 1 or #ARGV ~= 1 or #ARGV[1] ~= 64
    or not string.match(ARGV[1], '^[0-9a-f]+$') then return -1 end
local key, digest = KEYS[1], ARGV[1]
local kind = redis.call('TYPE', key).ok
if kind == 'none' then return 1 end
if kind ~= 'hash' then return -1 end
local fields = redis.call('HMGET', key, 'currentTokenHash', 'used:' .. digest,
    'state', 'expiresAt')
if fields[1] ~= digest and fields[2] ~= '1' then return 1 end
if fields[3] == 'REVOKED' then return 1 end
-- Even incomplete/PENDING state with a matching secret must not retain an active grant.
redis.call('HSET', key, 'state', 'REVOKED')
return 1
