import type { PaginationMeta } from '../types/index.js';

/** Builds the `meta` block of a paginated response. */
export function buildPaginationMeta(total: number, page: number, limit: number): PaginationMeta {
  return {
    total,
    page,
    limit,
    totalPages: limit > 0 ? Math.ceil(total / limit) : 0,
  };
}

/** Converts 1-based `page`/`limit` into the row offset used by `skip`/`OFFSET`. */
export function toSkip(page: number, limit: number): number {
  return (page - 1) * limit;
}
