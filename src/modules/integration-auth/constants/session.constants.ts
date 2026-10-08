export const RATE_LIMIT_SCRIPT = `
local ipCount = redis.call('INCR', KEYS[1])
if ipCount == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
local userCount = redis.call('INCR', KEYS[2])
if userCount == 1 then redis.call('EXPIRE', KEYS[2], ARGV[1]) end
return math.max(ipCount, userCount)
`;

export const RESET_RATE_LIMIT_SCRIPT = `redis.call('DEL', KEYS[1], KEYS[2]); return 1`;
