import { parseBitrixDealEvent } from '../domain/bitrix-event-envelope.js';

describe('parseBitrixDealEvent', () => {
  it('parses Bitrix nested form fields and fingerprints the authenticated deal signal', () => {
    const event = parseBitrixDealEvent(
      Buffer.from(
        'event=ONCRMDEALUPDATE&data%5BFIELDS%5D%5BID%5D=42&ts=1736405807&auth%5Bdomain%5D=crm.example.test&auth%5Bmember_id%5D=member-1&auth%5Bapplication_token%5D=app-token',
      ),
    );

    expect(event).toEqual({
      eventType: 'deal.update',
      remoteId: '42',
      timestamp: new Date(1736405807 * 1000),
      domain: 'crm.example.test',
      memberId: 'member-1',
      applicationToken: 'app-token',
      eventKey: 'ONCRMDEALUPDATE:42:1736405807',
    });
  });

  it('parses the mock event contract without accepting remote callback URLs', () => {
    const event = parseBitrixDealEvent({
      event_id: 'mock-event-1',
      event: 'deal.delete',
      portal_key: 'mock-portal',
      deal_id: '42',
      timestamp: '2026-10-08T12:00:00.000Z',
      fields: { stageId: 'C2:WON' },
      client_endpoint: 'https://attacker.example/rest/',
    });

    expect(event).toMatchObject({
      eventType: 'deal.delete',
      remoteId: '42',
      eventKey: 'mock-event-1',
      mockPortalKey: 'mock-portal',
    });
    expect(event).not.toHaveProperty('clientEndpoint');
  });

  it('parses the raw JSON bytes used by the mock webhook transport', () => {
    const event = parseBitrixDealEvent(
      Buffer.from(
        JSON.stringify({
          event_id: 'mock-json-event',
          event: 'deal.add',
          portal_key: 'mock-portal',
          deal_id: '43',
          timestamp: '2026-10-08T12:00:00.000Z',
        }),
      ),
    );
    expect(event.eventKey).toBe('mock-json-event');
  });

  it('rejects unknown event types and malformed deal IDs', () => {
    expect(() =>
      parseBitrixDealEvent({
        event: 'ONCRMDEALUPDATE',
        data: { FIELDS: { ID: '0' } },
        ts: '1736405807',
        auth: {},
      }),
    ).toThrow('Invalid Bitrix deal event');
  });
});
