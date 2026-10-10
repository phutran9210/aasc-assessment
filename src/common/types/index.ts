export type PaginationMeta = {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

export type PaginatedResponse<T> = {
  data: T[];
  meta: PaginationMeta;
};

/** Shape of every error body produced by `HttpExceptionFilter`. */
export type ErrorResponse = {
  statusCode: number;
  error: string;
  message: string | string[];
  // Stable machine-readable reason, present only when the error defines one.
  code?: string;
  path: string;
  timestamp: string;
};
