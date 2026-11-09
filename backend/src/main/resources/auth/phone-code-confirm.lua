-- users.md U29: check a code, count failures and issue a one-time proof in one step.
-- KEYS: code, proof. ARGV: code hash, proof value. Value format: <hash>:<failures 0-4>:<expiresAtMs>.
-- Returns {1, proofTtlSec}, {-1, 0} no valid code, {-5, failures} mismatch, {-4, 5} locked, {-9, 0} malformed.
if #KEYS ~= 2 or #ARGV ~= 2 then
    return {-9, 0}
end
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local value = redis.call('GET', KEYS[1])
if not value then
    return {-1, 0}
end
local stored, failures, expires = string.match(value, '^([0-9a-f]+):([0-4]):(%d+)$')
failures, expires = tonumber(failures), tonumber(expires)
if not stored or not failures or not expires or redis.call('PTTL', KEYS[1]) < 0 then
    return {-9, 0}
end
if now >= expires then
    redis.call('DEL', KEYS[1])
    return {-1, 0}
end
if stored ~= ARGV[1] then
    failures = failures + 1
    if failures >= 5 then
        redis.call('DEL', KEYS[1])
        return {-4, failures}
    end
    redis.call('SET', KEYS[1], stored .. ':' .. failures .. ':' .. string.format('%.0f', expires),
        'PXAT', string.format('%.0f', expires))
    return {-5, failures}
end
-- Allocation comes first: store the proof, then remove the code so it cannot be confirmed twice.
redis.call('SET', KEYS[2], ARGV[2], 'PXAT', string.format('%.0f', now + 600000))
redis.call('DEL', KEYS[1])
return {1, 600}
