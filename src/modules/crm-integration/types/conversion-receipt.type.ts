export type ConversionReceipt =
  | { status: 'pending'; operationId: string; dealId: string }
  | { status: 'completed'; dealId: string; bitrixDealId: string };
