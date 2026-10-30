if redis.call('TYPE', KEYS[1]).ok == 'none' then return 1 end
if redis.call('TYPE', KEYS[1]).ok ~= 'hash' then return 0 end
if redis.call('HGET', KEYS[1], 'userId') ~= ARGV[1]
    or redis.call('HGET', KEYS[1], 'currentTokenHash') ~= ARGV[2] then return 0 end
redis.call('HSET', KEYS[1], 'state', 'REVOKED')
return 1
