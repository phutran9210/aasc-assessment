import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import { AssignmentCursorRepository } from '../repositories/assignment-cursor.repository.js';
import type { AssignmentPolicy } from '../types/rule.types.js';

type AssignmentLead = { firstTouchCampaignId: string | null; city: string | null };

@Injectable()
export class AssignmentService {
  constructor(private readonly cursors: AssignmentCursorRepository) {}

  async reserve(
    policy: AssignmentPolicy,
    lead: AssignmentLead,
    tx: EntityManager,
  ): Promise<string> {
    const campaignMatch = policy.campaign_rules?.find(
      (rule) => rule.campaign_id === lead.firstTouchCampaignId,
    );
    if (campaignMatch) return campaignMatch.sales_id;

    const city = lead.city?.normalize('NFC').toLocaleLowerCase('und');
    const cityMatch = policy.city_rules?.find(
      (rule) => rule.city.normalize('NFC').toLocaleLowerCase('und') === city,
    );
    if (cityMatch) return cityMatch.sales_id;

    if (policy.strategy === 'round_robin') {
      return this.cursors.next('default', policy.sales_ids, tx);
    }
    if (policy.fallback_sales_id) return policy.fallback_sales_id;
    throw new Error('ASSIGNEE_UNAVAILABLE');
  }
}
