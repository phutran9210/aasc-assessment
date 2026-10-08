import { BitrixStore } from '../../../modules/tiktok/testing/bitrix-store.js';
import { ProviderServer } from '../../../modules/tiktok/testing/provider-server.js';
import { TiktokStore } from '../../../modules/tiktok/testing/tiktok-store.js';

function portFromEnvironment(value: string | undefined): number {
  if (value === undefined) return 3002;
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new RangeError('TIKTOK_MOCK_PORT must be an integer from 1 to 65535');
  }
  return port;
}

const server = new ProviderServer({
  bitrix: new BitrixStore(),
  tiktok: new TiktokStore(),
  exposeControl: process.env.NODE_ENV !== 'production',
  tiktokApiKey: process.env.TIKTOK_MOCK_API_KEY ?? 'local-only-mock-key',
});
await server.listen(portFromEnvironment(process.env.TIKTOK_MOCK_PORT));
console.log(`TikTok and Bitrix mock APIs listening on ${server.bitrixEndpoint}`);

let closing = false;
async function close(): Promise<void> {
  if (closing) return;
  closing = true;
  await server.close();
}

process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());
