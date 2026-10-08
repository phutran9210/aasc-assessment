import { TiktokWebhookController } from '../controllers/tiktok-webhook.controller.js';
import type { VerifiedEvent } from '../domain/webhook-envelope.js';

describe('TiktokWebhookController', () => {
  it('passes the verified event and original bytes to the inbox', async () => {
    const receipt = { received: true, eventId: 'event-1', duplicate: false };
    const inbox = { receive: jest.fn().mockResolvedValue(receipt) };
    const controller = new TiktokWebhookController(inbox as never);
    const event = { eventId: 'event-1' } as VerifiedEvent;
    const rawBody = Buffer.from('{"event":"lead.generate"}');

    await expect(
      controller.receive({ verifiedTiktokEvent: event, rawBody } as never),
    ).resolves.toBe(receipt);
    expect(inbox.receive).toHaveBeenCalledWith(event, rawBody);
  });
});
