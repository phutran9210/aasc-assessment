import { BitrixDealWebhookController } from '../controllers/bitrix-deal-webhook.controller.js';

describe('BitrixDealWebhookController', () => {
  it('passes original request bytes and headers to the inbox', async () => {
    const receipt = { eventId: 'event-1', operationId: 'operation-1', duplicate: false };
    const inbox = { receive: jest.fn().mockResolvedValue(receipt) };
    const controller = new BitrixDealWebhookController(inbox as never);
    const rawBody = Buffer.from('event=ONCRMDEALUPDATE');
    const headers = { 'x-bitrix-signature': 'signature' };

    await expect(
      controller.receive({ rawBody, body: { ignored: true }, headers } as never),
    ).resolves.toBe(receipt);
    expect(inbox.receive).toHaveBeenCalledWith(rawBody, headers);
  });

  it('falls back to the parsed body when raw bytes are unavailable', async () => {
    const inbox = { receive: jest.fn().mockResolvedValue({}) };
    const controller = new BitrixDealWebhookController(inbox as never);
    const body = { event: 'ONCRMDEALUPDATE' };
    const headers = {};

    await expect(controller.receive({ body, headers } as never)).resolves.toEqual({});

    expect(inbox.receive).toHaveBeenCalledWith(body, headers);
  });
});
