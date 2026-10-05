import { JotformApiError, JotformApiService } from '../services/jotform-api.service.js';

const CONFIG = {
  apiKey: 'key-123',
  formId: '252770000000001',
  webhookSecret: 'secret-0123456789abcdef',
  apiBaseUrl: 'https://api.jotform.com',
  timeoutMs: 10_000,
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('JotformApiService', () => {
  let fetchMock: jest.SpiedFunction<typeof fetch>;
  let service: JotformApiService;

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
    service = new JotformApiService(CONFIG);
  });

  afterEach(() => jest.restoreAllMocks());

  it('should read one submission and keep the API key out of the URL', async () => {
    fetchMock.mockResolvedValue(
      json({ responseCode: 200, message: 'success', content: { id: '6001', form_id: '77' } }),
    );

    await expect(service.getSubmission('6001')).resolves.toEqual({ id: '6001', form_id: '77' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.jotform.com/submission/6001');
    expect(new Headers(init?.headers).get('APIKEY')).toBe('key-123');
  });

  it('should list the latest submissions of a form', async () => {
    fetchMock.mockResolvedValue(
      json({
        responseCode: 200,
        content: [
          { id: '2', form_id: '77' },
          { id: '1', form_id: '77' },
        ],
      }),
    );

    await expect(service.listSubmissions('77', 50)).resolves.toHaveLength(2);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.jotform.com/form/77/submissions?limit=50&orderby=created_at',
    );
  });

  it('should refuse an id that is not numeric without calling Jotform', async () => {
    await expect(service.getSubmission('1/../../user')).rejects.toMatchObject({
      kind: 'not_found',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('should fail with kind "config" when the API key is missing', async () => {
    const unconfigured = new JotformApiService({ ...CONFIG, apiKey: undefined });

    await expect(unconfigured.getSubmission('6001')).rejects.toMatchObject({ kind: 'config' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [404, 'not_found'],
    [500, 'upstream'],
  ] as const)('should map HTTP %i to kind "%s"', async (status, kind) => {
    fetchMock.mockResolvedValue(json({ responseCode: status, message: 'error' }, status));

    await expect(service.getSubmission('6001')).rejects.toMatchObject({ kind, status });
  });

  it('should treat an error responseCode inside a 200 answer as a failure', async () => {
    fetchMock.mockResolvedValue(json({ responseCode: 401, message: 'Invalid API key' }));

    await expect(service.getSubmission('6001')).rejects.toMatchObject({ kind: 'auth' });
  });

  it('should map a timeout, a network failure and a non-JSON body', async () => {
    fetchMock.mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'));
    await expect(service.getSubmission('6001')).rejects.toMatchObject({ kind: 'timeout' });

    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(service.getSubmission('6001')).rejects.toMatchObject({ kind: 'network' });

    fetchMock.mockResolvedValueOnce(new Response('<html>', { status: 200 }));
    await expect(service.getSubmission('6001')).rejects.toBeInstanceOf(JotformApiError);
  });
});
