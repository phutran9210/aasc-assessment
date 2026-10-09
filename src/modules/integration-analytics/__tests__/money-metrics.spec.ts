import { calculateFinancials, sumMoney, toMoneyString } from '../domain/money-metrics.js';

describe('money metrics', () => {
  it('derives CPL, ROI and ROAS for the acceptance cohort', () => {
    expect(
      calculateFinancials({
        spend: '1000000',
        revenue: '3000000',
        leads: 10,
        costComplete: true,
        revenueComplete: true,
      }),
    ).toMatchObject({ cpl: '100000', roi: '200', roas: '3', spendComplete: true });
  });

  it('keeps a real zero spend distinct from a missing spend', () => {
    const zero = calculateFinancials({
      spend: '0',
      revenue: '500',
      leads: 4,
      costComplete: true,
      revenueComplete: true,
    });
    const missing = calculateFinancials({
      spend: null,
      revenue: '500',
      leads: 4,
      costComplete: false,
      revenueComplete: true,
    });

    expect(zero).toMatchObject({
      knownSpend: '0',
      cpl: '0',
      roi: null,
      roas: null,
      reasons: { roi: 'zero_spend', roas: 'zero_spend' },
    });
    expect(missing).toMatchObject({
      knownSpend: null,
      spendComplete: false,
      cpl: null,
      roi: null,
      roas: null,
      reasons: { cpl: 'spend_incomplete', roi: 'spend_incomplete', roas: 'spend_incomplete' },
    });
  });

  it('withholds every spend ratio when one day of cost is missing but reports the known spend', () => {
    expect(
      calculateFinancials({
        spend: '900000',
        revenue: '3000000',
        leads: 10,
        costComplete: false,
        revenueComplete: true,
      }),
    ).toMatchObject({ knownSpend: '900000', cpl: null, roi: null, roas: null });
  });

  it('returns null CPL with a reason when there are no leads', () => {
    expect(
      calculateFinancials({
        spend: '100',
        revenue: '0',
        leads: 0,
        costComplete: true,
        revenueComplete: true,
      }),
    ).toMatchObject({ cpl: null, roi: '-100', roas: '0', reasons: { cpl: 'zero_leads' } });
  });

  it('does not treat an incomplete revenue as zero', () => {
    expect(
      calculateFinancials({
        spend: '100',
        revenue: '50',
        leads: 2,
        costComplete: true,
        revenueComplete: false,
      }),
    ).toMatchObject({
      cpl: '50',
      revenue: '50',
      revenueComplete: false,
      roi: null,
      roas: null,
      reasons: { roi: 'revenue_incomplete', roas: 'revenue_incomplete' },
    });
  });

  it('rounds half up to four decimal places', () => {
    expect(
      calculateFinancials({
        spend: '1',
        revenue: '1.00005',
        leads: 3,
        costComplete: true,
        revenueComplete: true,
      }),
    ).toMatchObject({ cpl: '0.3333', roi: '0.005', roas: '1.0001' });
    expect(toMoneyString('2.00005')).toBe('2.0001');
    expect(toMoneyString('2.00004')).toBe('2');
  });

  it('round-trips large amounts without floating point loss', () => {
    expect(toMoneyString('9999999999999999.9999')).toBe('9999999999999999.9999');
    expect(sumMoney(['9999999999999999.9999', '0.0001'])).toBe('10000000000000000');
    expect(sumMoney(['0.1', '0.2'])).toBe('0.3');
    expect(sumMoney([])).toBe('0');
    expect(
      calculateFinancials({
        spend: '9007199254740993',
        revenue: '18014398509481986',
        leads: 1,
        costComplete: true,
        revenueComplete: true,
      }),
    ).toMatchObject({ cpl: '9007199254740993', roas: '2', roi: '100' });
  });
});
