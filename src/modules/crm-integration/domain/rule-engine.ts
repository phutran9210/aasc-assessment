import { BadRequestException } from '@nestjs/common';

import { allowedRuleFields, rulesSchema } from '../schemas/rules.schema.js';
import type {
  LeadRuleContext,
  RuleCondition,
  RuleDefinition,
  RuleMatch,
  RulesConfig,
} from '../types/rule.types.js';

export function evaluateRules(context: LeadRuleContext, rules: RulesConfig): RuleMatch | null {
  const parsed = rulesSchema.safeParse(rules);
  if (!parsed.success) throw new BadRequestException('Invalid rules configuration');
  const config = parsed.data as unknown as RulesConfig;
  const enabledRules = config.rules.filter((rule) => rule.enabled).sort(compareRules);
  for (const rule of enabledRules) {
    validateCondition(rule.conditions);
    if (matches(rule.conditions, context)) return { rule };
  }
  return null;
}

function validateCondition(condition: RuleCondition): void {
  if ('all' in condition) return condition.all.forEach(validateCondition);
  if ('any' in condition) return condition.any.forEach(validateCondition);
  if (!allowedRuleFields.has(condition.field))
    throw new BadRequestException('Rule field is not allowed');
}

function matches(condition: RuleCondition, context: LeadRuleContext): boolean {
  if ('all' in condition) return condition.all.every((item) => matches(item, context));
  if ('any' in condition) return condition.any.some((item) => matches(item, context));
  const predicate = condition;
  const segments = predicate.field.split('.');
  let value: unknown = context;
  for (const segment of segments) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, segment)) {
      return false;
    }
    value = (value as Record<string, unknown>)[segment];
  }
  if (predicate.op === 'exists') return value !== undefined && value !== null;
  if (value === undefined || value === null) return false;
  switch (predicate.op) {
    case 'eq':
      return sameValue(value, predicate.value);
    case 'in':
      return (
        Array.isArray(predicate.value) && predicate.value.some((item) => sameValue(value, item))
      );
    case 'contains':
      return (
        typeof value === 'string' &&
        typeof predicate.value === 'string' &&
        normalize(value).includes(normalize(predicate.value))
      );
    case 'gte':
      return (
        typeof value === 'number' && typeof predicate.value === 'number' && value >= predicate.value
      );
    case 'lte':
      return (
        typeof value === 'number' && typeof predicate.value === 'number' && value <= predicate.value
      );
  }
}

function compareRules(a: RuleDefinition, b: RuleDefinition): number {
  return a.priority - b.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
function sameValue(left: unknown, right: unknown): boolean {
  return typeof left === typeof right && (typeof left !== 'object' ? left === right : false);
}
function normalize(value: string): string {
  return value.normalize('NFC').toLocaleLowerCase('und');
}
