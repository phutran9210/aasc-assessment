import { BitrixStore } from '@modules/tiktok/testing/bitrix-store.js';
import { ProviderServer } from '@modules/tiktok/testing/provider-server.js';
import { TiktokStore } from '@modules/tiktok/testing/tiktok-store.js';

export function portFromEnvironment(value: string | undefined): number {
  if (value === undefined) return 3002;
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new RangeError('TIKTOK_MOCK_PORT must be an integer from 1 to 65535');
  }
  return port;
}

export async function startMockServer(
  env: NodeJS.ProcessEnv = process.env,
  createServer: (options: ConstructorParameters<typeof ProviderServer>[0]) => ProviderServer = (
    options,
  ) => new ProviderServer(options),
  registerSignal: (signal: NodeJS.Signals, listener: () => void) => unknown = (signal, listener) =>
    process.once(signal, listener),
  log: (message: string) => void = (message) => console.log(message),
): Promise<{ close: () => Promise<void> }> {
  const server = createServer({
    bitrix: new BitrixStore(),
    tiktok: new TiktokStore(),
    exposeControl: env.NODE_ENV !== 'production',
    tiktokApiKey: env.TIKTOK_MOCK_API_KEY ?? 'local-only-mock-key',
  });
  await server.listen(
    portFromEnvironment(env.TIKTOK_MOCK_PORT),
    env.TIKTOK_MOCK_HOST ?? '127.0.0.1',
  );
  log(`TikTok and Bitrix mock APIs listening on ${server.bitrixEndpoint}`);

  let closing = false;
  const close = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    await server.close();
  };

  registerSignal('SIGINT', () => void close());
  registerSignal('SIGTERM', () => void close());
  return { close };
}

if (process.argv[1]?.endsWith('/mock-server.js')) {
  void startMockServer().catch((error: unknown) => {
    console.error(
      `Mock server failed: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
    process.exitCode = 1;
  });
}
