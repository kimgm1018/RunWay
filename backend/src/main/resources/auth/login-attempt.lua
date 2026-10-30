-- One SET stores count, absolute deadline and TTL together. Never send credentials here.
if #KEYS ~= 1 or #ARGV ~= 1 or (ARGV[1] ~= 'check' and ARGV[1] ~= 'fail') then
    return -1
end
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local value = redis.call('GET', KEYS[1])
local count = 0
if value then
    local number, deadline = string.match(value, '^([1-5]):(%d+)$')
    count, deadline = tonumber(number), tonumber(deadline)
    if not count or not deadline or redis.call('PTTL', KEYS[1]) < 0 then return -1 end
    if now >= deadline then
        count = 0
    elseif deadline - now > (count == 5 and 600000 or 86400000) then
        return -1
    elseif count == 5 then
        return 5
    end
end
if ARGV[1] == 'check' then return 0 end
count = count + 1
local deadline = now + (count == 5 and 600000 or 86400000)
redis.call('SET', KEYS[1], count .. ':' .. string.format('%.0f', deadline),
    'PXAT', string.format('%.0f', deadline))
return count
