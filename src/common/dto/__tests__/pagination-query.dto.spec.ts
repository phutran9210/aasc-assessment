import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { PaginationQueryDto } from '../pagination-query.dto.js';

const toDto = (query: Record<string, unknown>): PaginationQueryDto =>
  plainToInstance(PaginationQueryDto, query);

describe('PaginationQueryDto', () => {
  it('should fall back to defaults when query is empty', async () => {
    const dto = toDto({});

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(20);
  });

  it('should convert numeric strings when values come from the query string', async () => {
    const dto = toDto({ page: '3', limit: '50' });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.page).toBe(3);
    expect(dto.limit).toBe(50);
  });

  it.each([
    ['page', { page: '0' }],
    ['page', { page: '1.5' }],
    ['page', { page: 'abc' }],
    ['limit', { limit: '0' }],
    ['limit', { limit: '101' }],
    ['limit', { limit: '-5' }],
  ])('should report an error on %s when query is %o', async (property, query) => {
    const errors = await validate(toDto(query));

    expect(errors.map((error) => error.property)).toEqual([property]);
  });
});
