import { createHmac, timingSafeEqual } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';

const SIGNATURE_PATTERN = /^t=(\d+),s=([a-fA-F0-9]{64})$/;
const CLOCK_TOLERANCE_SECONDS = 300;

export function verifyMockSignature(
  raw: Buffer,
  header: string,
  secret: string,
  nowSeconds: number,
): void {
  const match = SIGNATURE_PATTERN.exec(header.trim());
  if (!match) throw new UnauthorizedException('Invalid TikTok signature');
  const timestamp = Number(match[1]);
  if (
    !Number.isSafeInteger(timestamp) ||
    Math.abs(nowSeconds - timestamp) > CLOCK_TOLERANCE_SECONDS
  ) {
    throw new UnauthorizedException('Invalid TikTok signature');
  }
  const supplied = Buffer.from(match[2], 'hex');
  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.`, 'utf8')
    .update(raw)
    .digest();
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new UnauthorizedException('Invalid TikTok signature');
  }
}
