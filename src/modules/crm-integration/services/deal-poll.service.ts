import { Injectable, Inject } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import { OperationRepository } from '@core/queue/repositories/operation.repository.js';
import { OutboxRepository } from '@core/queue/repositories/outbox.repository.js';
import { validateTiktokEnv } from '@config/tiktok-app/env.validation.js';
import { CRM_GATEWAY } from '../ports/crm-gateway.port.js';
import type { CrmGateway, RemoteDeal } from '../ports/crm-gateway.port.js';
import { DealPollRepository } from '../repositories/deal-poll.repository.js';
import type { DealPollCheckpointEntity } from '../entities/deal-poll-checkpoint.entity.js';
import { OPERATION_KINDS, QUEUE_NAMES } from '@core/queue/constants/operation.constants.js';
import type { PollSummary } from '../types/deal-poll-summary.type.js';

const PAGE_SIZE = 50;
const OVERLAP_MS = 10 * 60 * 1000;

@Injectable()
export class DealPollService {
  constructor(
    private readonly dataSource: DataSource,
    @Inject(CRM_GATEWAY) private readonly gateway: CrmGateway,
    private readonly operations: OperationRepository,
    private readonly outbox: OutboxRepository,
    private readonly pollData: DealPollRepository,
  ) {}

  async run(mode: 'incremental' | 'full'): Promise<PollSummary> {
    const portalKey = validateTiktokEnv(process.env).portalKey;
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    const lockKey = `aasc-bitrix-deal-poll/${portalKey}`;
    try {
      const lockRows = (await queryRunner.query(
        "SELECT pg_try_advisory_lock(hashtext($1), hashtext('deal-poll')) AS locked",
        [lockKey],
      )) as Array<{ locked: boolean }>;
      if (!lockRows[0]?.locked) {
        const checkpoint = await this.checkpoint(portalKey);
        return {
          mode,
          scanned: 0,
          queued: 0,
          ignored: 0,
          complete: true,
          skippedLocked: true,
          watermark: checkpoint.incrementalWatermark,
        };
      }

      let checkpoint = await this.checkpoint(portalKey);
      const startWatermark = checkpoint.incrementalWatermark;
      const runKey =
        mode === 'incremental'
          ? (startWatermark?.toISOString() ?? 'initial')
          : (checkpoint.fullScanAt?.toISOString() ?? 'initial');
      if (checkpoint.activeMode !== mode) {
        checkpoint = await this.pollData.saveCheckpoint({
          ...checkpoint,
          activeMode: mode,
          pageOffset: 0,
        });
      }

      let offset = checkpoint.pageOffset;
      let scanned = 0;
      let queued = 0;
      let ignored = 0;
      while (true) {
        const page =
          mode === 'full'
            ? await this.listManagedPage(portalKey, offset)
            : await this.gateway.listDealsPage({
                offset,
                limit: PAGE_SIZE,
                ...(startWatermark
                  ? { modifiedSince: new Date(startWatermark.getTime() - OVERLAP_MS) }
                  : {}),
              });
        scanned += page.length;
        for (const remote of page) {
          const managed = mode === 'full' || (await this.isManaged(portalKey, remote));
          if (!managed) {
            ignored += 1;
            continue;
          }
          await this.enqueue(mode, runKey, remote.id);
          queued += 1;
        }
        offset += page.length;
        checkpoint.pageOffset = offset;
        checkpoint.activeMode = mode;
        await this.pollData.saveCheckpoint(checkpoint);
        if (page.length < PAGE_SIZE) break;
      }

      const completedAt = new Date();
      checkpoint = await this.pollData.saveCheckpoint({
        ...checkpoint,
        activeMode: null,
        pageOffset: 0,
        ...(mode === 'full' ? { fullScanAt: completedAt } : { incrementalWatermark: completedAt }),
      });
      return {
        mode,
        scanned,
        queued,
        ignored,
        complete: true,
        skippedLocked: false,
        watermark: checkpoint.incrementalWatermark,
      };
    } finally {
      try {
        await queryRunner.query("SELECT pg_advisory_unlock(hashtext($1), hashtext('deal-poll'))", [
          lockKey,
        ]);
      } finally {
        await queryRunner.release();
      }
    }
  }

  async isFullScanDue(): Promise<boolean> {
    const portalKey = validateTiktokEnv(process.env).portalKey;
    const checkpoint = await this.checkpoint(portalKey);
    return (
      !checkpoint.fullScanAt || Date.now() - checkpoint.fullScanAt.getTime() >= 24 * 60 * 60 * 1000
    );
  }

  private async checkpoint(portalKey: string): Promise<DealPollCheckpointEntity> {
    return this.pollData.checkpoint(portalKey);
  }

  private async listManagedPage(portalKey: string, offset: number): Promise<RemoteDeal[]> {
    const deals = await this.pollData.listManagedPage(portalKey, offset, PAGE_SIZE);
    return deals.flatMap((deal) =>
      deal.bitrixDealId
        ? [
            {
              id: deal.bitrixDealId,
              title: deal.title,
              marker: null,
              fields: {},
            },
          ]
        : [],
    );
  }

  private async isManaged(portalKey: string, remote: RemoteDeal): Promise<boolean> {
    if (await this.pollData.isManaged(portalKey, remote.id)) return true;
    const localId = remote.marker?.match(/^aasc-tiktok\/deal\/([0-9a-f-]{36})$/i)?.[1];
    return localId ? this.pollData.hasLocalId(portalKey, localId) : false;
  }

  private async enqueue(
    mode: 'incremental' | 'full',
    runKey: string,
    remoteId: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const operation = await this.operations.ensure(
        {
          operationKey: `bitrix-deal-poll/${mode}/${runKey}/${remoteId}`,
          kind: OPERATION_KINDS.bitrixDealRefresh,
          payload: { remoteId },
        },
        manager,
      );
      if (operation.status !== 'pending') return;
      if (!(await this.outbox.hasUnpublished(operation.id, manager)))
        await this.outbox.append(operation.id, QUEUE_NAMES.bitrixDealRefresh, new Date(), manager);
    });
  }
}
