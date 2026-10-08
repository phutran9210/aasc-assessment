export type BitrixBatchCommand = { key: string; method: string; params: Record<string, unknown> };
export type BitrixBatchError = { code: string; message: string };
export type BitrixBatchOutcome = {
  results: Map<string, unknown>;
  errors: Map<string, BitrixBatchError>;
};
