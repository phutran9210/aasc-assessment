import { Logger } from '@nestjs/common';

import { redact } from './redact.js';

export type LogFields = Record<string, unknown>;

/**
 * Structured logger of the TikTok integration: one JSON object per line, redacted before it
 * reaches any transport, so no caller can log a raw upstream error, token or contact by accident.
 */
export class IntegrationLogger {
  private readonly logger: Logger;

  constructor(context: string) {
    this.logger = new Logger(context);
  }

  info(event: string, fields: LogFields = {}): void {
    this.logger.log(serialize(event, fields));
  }

  warn(event: string, fields: LogFields = {}): void {
    this.logger.warn(serialize(event, fields));
  }

  error(event: string, fields: LogFields = {}): void {
    this.logger.error(serialize(event, fields));
  }
}

function serialize(event: string, fields: LogFields): string {
  return JSON.stringify(redact({ event, ...fields }));
}

export type MetricLabels = Record<string, string>;

/** Port for operational gauges and counters; only bounded, low-cardinality labels are kept. */
export type MetricsRecorder = {
  record(name: string, value: number, labels?: MetricLabels): void;
};

export const METRICS_RECORDER = Symbol('METRICS_RECORDER');
export const METRIC_LABELS = ['queue', 'kind', 'status', 'provider', 'outcome', 'check'] as const;

/** In-process recorder that keeps the latest value of every series for the readiness endpoint. */
export class IntegrationMetrics implements MetricsRecorder {
  private readonly series = new Map<
    string,
    { name: string; value: number; labels: MetricLabels }
  >();

  record(name: string, value: number, labels: MetricLabels = {}): void {
    const kept: MetricLabels = {};
    for (const label of METRIC_LABELS) {
      if (typeof labels[label] === 'string') kept[label] = labels[label];
    }
    this.series.set(`${name}|${JSON.stringify(kept)}`, { name, value, labels: kept });
  }

  snapshot(): Array<{ name: string; value: number; labels: MetricLabels }> {
    return [...this.series.values()];
  }
}
