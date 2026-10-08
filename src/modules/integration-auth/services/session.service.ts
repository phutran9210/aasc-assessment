import { createHash } from 'node:crypto';

import type { Redis } from 'ioredis';

import { HttpException, HttpStatus, ServiceUnavailableException } from '@nestjs/common';
import { ensureRedisConnected } from '../../../core/queue/ensure-redis-connected.js';

type SessionRecord = { subject: string; authVersion: number; roleFingerprint: string };

const RATE_LIMIT_SCRIPT = `
local ipCount = redis.call('INCR', KEYS[1])
if ipCount == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
local userCount = redis.call('INCR', KEYS[2])
if userCount == 1 then redis.call('EXPIRE', KEYS[2], ARGV[1]) end
return math.max(ipCount, userCount)
`;

const RESET_RATE_LIMIT_SCRIPT = `redis.call('DEL', KEYS[1], KEYS[2]); return 1`;

/** Redis session and login-throttle state, shared across TikTok API replicas. */
export class SessionService {
  constructor(
    private readonly redis: Redis,
    private readonly namespace: string,
    private readonly rateLimitMax = 10,
    private readonly rateLimitWindowSeconds = 900,
  ) {}

  async create(
    sessionId: string,
    subject: string,
    authVersion: number,
    ttlSeconds: number,
    roles: readonly string[],
  ): Promise<void> {
    try {
      await ensureRedisConnected(this.redis);
      const result = await this.redis.set(
        this.sessionKey(sessionId),
        JSON.stringify({ subject, authVersion, roleFingerprint: fingerprintRoles(roles) }),
        'EX',
        ttlSeconds,
        'NX',
      );
      if (result !== 'OK') throw new ServiceUnavailableException('Could not create session');
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException('Session service is unavailable');
    }
  }

  async isActive(
    sessionId: string,
    subject: string,
    authVersion: number,
    roles: readonly string[],
  ): Promise<boolean> {
    try {
      await ensureRedisConnected(this.redis);
      const stored = await this.redis.get(this.sessionKey(sessionId));
      if (!stored) return false;
      const record = JSON.parse(stored) as SessionRecord;
      return (
        record.subject === subject &&
        record.authVersion === authVersion &&
        record.roleFingerprint === fingerprintRoles(roles)
      );
    } catch (error) {
      if (error instanceof SyntaxError) return false;
      throw new ServiceUnavailableException('Session service is unavailable');
    }
  }

  async revoke(sessionId: string): Promise<void> {
    try {
      await ensureRedisConnected(this.redis);
      await this.redis.del(this.sessionKey(sessionId));
    } catch {
      throw new ServiceUnavailableException('Session service is unavailable');
    }
  }

  async assertLoginAllowed(ipAddress: string, username: string): Promise<void> {
    try {
      await ensureRedisConnected(this.redis);
      const attempts = Number(
        await this.redis.eval(
          RATE_LIMIT_SCRIPT,
          2,
          this.loginIpKey(ipAddress),
          this.loginUsernameKey(username),
          this.rateLimitWindowSeconds,
        ),
      );
      if (attempts > this.rateLimitMax) {
        throw new HttpException('Too many login attempts', HttpStatus.TOO_MANY_REQUESTS);
      }
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException('Session service is unavailable');
    }
  }

  async resetLoginAttempts(ipAddress: string, username: string): Promise<void> {
    try {
      await ensureRedisConnected(this.redis);
      await this.redis.eval(
        RESET_RATE_LIMIT_SCRIPT,
        2,
        this.loginIpKey(ipAddress),
        this.loginUsernameKey(username),
      );
    } catch {
      throw new ServiceUnavailableException('Session service is unavailable');
    }
  }

  private sessionKey(sessionId: string): string {
    return `${this.namespace}:auth:session:${sessionId}`;
  }

  private loginIpKey(ipAddress: string): string {
    return `${this.namespace}:auth:login:ip:${digest(ipAddress)}`;
  }

  private loginUsernameKey(username: string): string {
    return `${this.namespace}:auth:login:user:${digest(username.toLowerCase())}`;
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function fingerprintRoles(roles: readonly string[]): string {
  return digest([...roles].sort().join('\0'));
}
