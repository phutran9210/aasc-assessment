export type SpendRange = { from: string; to: string; campaignId?: string };
export type CampaignSpend = {
  campaignId: string;
  date: string;
  amount: string;
  currency: string;
};
export type SpendPage = { items: CampaignSpend[]; nextCursor?: string };

export type CampaignSpendProvider = {
  fetchSpend(range: SpendRange, cursor?: string): Promise<SpendPage>;
};

export const CAMPAIGN_SPEND_PROVIDER = Symbol('CAMPAIGN_SPEND_PROVIDER');
