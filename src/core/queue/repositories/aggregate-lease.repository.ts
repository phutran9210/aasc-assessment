import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import type { AggregateLease } from '../types/operation.types.js';

type LeaseRow = { ownerToken: string; expiresAt: Date };

@Injectable()
export class AggregateLeaseRepository {
  private readonly table: string;

  constructor(private readonly dataSource: DataSource) {
    const options = this.dataSource.options;
    const schema = 'schema' in options ? (options.schema ?? 'public') : 'public';
    this.table = `"${schema.replaceAll('"', '""')}"."integration_aggregate_lease"`;
  }

  async claim(key: string, ttlMs: number): Promise<AggregateLease | null> {
    validateLeaseInput(key, ttlMs);
    const ownerToken = randomUUID();
    const rows = await this.dataSource.query<LeaseRow[]>(
      `INSERT INTO ${this.table} AS current_lease (lease_key, owner_token, expires_at, updated_at)
       VALUES ($1, $2, NOW() + ($3 * INTERVAL '1 millisecond'), NOW())
       ON CONFLICT (lease_key) DO UPDATE
         SET owner_token = EXCLUDED.owner_token,
             expires_at = EXCLUDED.expires_at,
             updated_at = NOW()
         WHERE current_lease.expires_at <= NOW()
       RETURNING owner_token AS "ownerToken", expires_at AS "expiresAt"`,
      [key, ownerToken, ttlMs],
    );
    const row = rows[0];
    return row ? { key, ownerToken: row.ownerToken, expiresAt: row.expiresAt } : null;
  }

  async renew(lease: AggregateLease, ttlMs: number): Promise<AggregateLease | null> {
    validateLeaseInput(lease.key, ttlMs);
    const result = await this.dataSource.query<unknown>(
      `UPDATE ${this.table}
       SET expires_at = NOW() + ($3 * INTERVAL '1 millisecond'), updated_at = NOW()
       WHERE lease_key = $1 AND owner_token = $2 AND expires_at > NOW()
      RETURNING owner_token AS "ownerToken", expires_at AS "expiresAt"`,
      [lease.key, lease.ownerToken, ttlMs],
    );
    const rows = returnedRows<LeaseRow>(result);
    const row = rows[0];
    return row ? { key: lease.key, ownerToken: row.ownerToken, expiresAt: row.expiresAt } : null;
  }

  async release(lease: AggregateLease): Promise<boolean> {
    const result = await this.dataSource.query<unknown>(
      `DELETE FROM ${this.table}
       WHERE lease_key = $1 AND owner_token = $2
       RETURNING lease_key`,
      [lease.key, lease.ownerToken],
    );
    const rows = returnedRows<{ lease_key: string }>(result);
    return rows.length === 1;
  }
}

function returnedRows<T>(result: unknown): T[] {
  if (
    Array.isArray(result) &&
    result.length === 2 &&
    Array.isArray(result[0]) &&
    typeof result[1] === 'number'
  ) {
    return result[0] as T[];
  }
  return result as T[];
}

function validateLeaseInput(key: string, ttlMs: number): void {
  if (!key || key.length > 512) throw new RangeError('Lease key must contain 1 to 512 characters');
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1) throw new RangeError('ttlMs must be positive');
}
