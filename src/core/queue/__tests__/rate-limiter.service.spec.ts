import { clientIp, LocalRateLimiter } from '../services/rate-limiter.service.js';

describe('local rate limiter', () => {
  it('allows the limit inside a window and reports when to retry', () => {
    let now = 1_000_000;
    const limiter = new LocalRateLimiter(() => now);

    const results = Array.from({ length: 4 }, () => limiter.consume('ip:1.2.3.4', 3, 60_000));

    expect(results.map((result) => result.allowed)).toEqual([true, true, true, false]);
    expect(results[2].remaining).toBe(0);
    expect(results[3].retryAfterMs).toBeGreaterThan(0);
    expect(results[3].retryAfterMs).toBeLessThanOrEqual(60_000);

    now += results[3].retryAfterMs;
    expect(limiter.consume('ip:1.2.3.4', 3, 60_000).allowed).toBe(true);
  });

  it('counts keys independently and stays bounded under many distinct keys', () => {
    const limiter = new LocalRateLimiter(() => 0, 100);

    for (let index = 0; index < 1_000; index += 1) limiter.consume(`ip:${index}`, 1, 60_000);

    expect(limiter.size).toBeLessThanOrEqual(100);
    expect(limiter.consume('ip:fresh', 1, 60_000).allowed).toBe(true);
  });
});

describe('client address', () => {
  const request = (remoteAddress: string, forwardedFor?: string | string[]) => ({
    socket: { remoteAddress },
    headers: forwardedFor === undefined ? {} : { 'x-forwarded-for': forwardedFor },
  });

  it('ignores X-Forwarded-For from a peer that is not an allowed proxy', () => {
    expect(clientIp(request('203.0.113.9', '1.1.1.1'), [])).toBe('203.0.113.9');
    expect(clientIp(request('203.0.113.9', '1.1.1.1'), ['10.0.0.1'])).toBe('203.0.113.9');
  });

  it('takes the nearest untrusted hop when the peer is an allowed proxy', () => {
    const proxies = ['10.0.0.1', '10.0.0.2'];

    expect(clientIp(request('10.0.0.1', '6.6.6.6, 198.51.100.7'), proxies)).toBe('198.51.100.7');
    expect(clientIp(request('10.0.0.1', '6.6.6.6, 198.51.100.7, 10.0.0.2'), proxies)).toBe(
      '198.51.100.7',
    );
    expect(clientIp(request('::ffff:10.0.0.1', ['198.51.100.7']), proxies)).toBe('198.51.100.7');
  });

  it('falls back to the peer when the header is empty or only names proxies', () => {
    expect(clientIp(request('10.0.0.1'), ['10.0.0.1'])).toBe('10.0.0.1');
    expect(clientIp(request('10.0.0.1', '10.0.0.2'), ['10.0.0.1', '10.0.0.2'])).toBe('10.0.0.1');
    expect(clientIp({ socket: {}, headers: {} }, [])).toBe('unknown');
  });
});
