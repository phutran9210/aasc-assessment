import {
  BitrixHttpError,
  BitrixHttpTransport,
  isTransientBitrixError,
} from '../services/bitrix-http-transport.service.js';

describe('BitrixHttpTransport', () => {
  const transport = new BitrixHttpTransport({ timeoutMs: 1000 } as never);
  const fetchMock = jest.spyOn(globalThis, 'fetch');

  afterEach(() => fetchMock.mockReset());

  it('reads JSON and accepts an empty success body', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"result":{"ok":true}}', { status: 200 }));
    await expect(transport.getJson('https://oauth.example/token')).resolves.toEqual({
      result: { ok: true },
    });
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(transport.getJson('https://oauth.example/empty')).resolves.toEqual({});
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://oauth.example/empty',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('posts portal payloads with and without authorization and uses a method timeout override', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"result":1}', { status: 200 }));
    await transport.postRest(
      'https://portal.example/rest/',
      'crm.item.get',
      { id: 1 },
      'token',
      2500,
    );
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://portal.example/rest/crm.item.get',
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ id: 1, auth: 'token' }),
        signal: expect.any(AbortSignal),
      }),
    );
    fetchMock.mockResolvedValueOnce(new Response('{"result":1}', { status: 200 }));
    await transport.postRest('https://portal.example/rest', 'app.info', {});
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://portal.example/rest/app.info',
      expect.objectContaining({ body: '{}' }),
    );
  });

  it('converts malformed JSON, HTTP errors, and Bitrix errors into typed failures', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{bad', { status: 502 }));
    await expect(transport.getJson('url')).rejects.toMatchObject({
      name: 'BitrixHttpError',
      status: 502,
    });
    fetchMock.mockResolvedValueOnce(
      new Response('{"error":"BAD_REQUEST"}', { status: 400, statusText: 'Bad Request' }),
    );
    await expect(transport.getJson('url')).rejects.toMatchObject({
      message: 'Bitrix24 HTTP 400',
      code: 'BAD_REQUEST',
      status: 400,
    });
    fetchMock.mockResolvedValueOnce(
      new Response('{"error":"INVALID","error_description":"bad token"}', { status: 200 }),
    );
    await expect(transport.getJson('url')).rejects.toMatchObject({
      message: 'bad token',
      code: 'INVALID',
      status: 200,
    });
  });

  it('maps timeout and network failures and classifies only transient Bitrix errors', async () => {
    fetchMock.mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'));
    await expect(transport.getJson('url')).rejects.toMatchObject({
      timeout: true,
      status: undefined,
    });
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await expect(transport.getJson('url')).rejects.toMatchObject({
      timeout: false,
      status: undefined,
    });

    expect(isTransientBitrixError(new Error('offline'))).toBe(false);
    expect(isTransientBitrixError(new BitrixHttpError('timeout', undefined, undefined, true))).toBe(
      true,
    );
    expect(isTransientBitrixError(new BitrixHttpError('network', undefined, undefined))).toBe(true);
    expect(isTransientBitrixError(new BitrixHttpError('server', undefined, 503))).toBe(true);
    expect(isTransientBitrixError(new BitrixHttpError('client', undefined, 400))).toBe(false);
    expect(
      isTransientBitrixError(new BitrixHttpError('throttled', 'OPERATION_TIME_LIMIT', 503)),
    ).toBe(false);
  });
});
