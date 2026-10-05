import { jotformConfig } from '@config/index.js';
import type { JotformConfig } from '@config/index.js';

import { Inject, Injectable } from '@nestjs/common';

import { JOTFORM_MESSAGES } from '../messages/index.js';
import type { JotformSubmissionContent } from '../types/index.js';

export type JotformApiErrorKind =
  'config' | 'auth' | 'not_found' | 'timeout' | 'network' | 'upstream';

/** A failed Jotform call. `kind` tells the caller how to react; `status` is the HTTP status. */
export class JotformApiError extends Error {
  constructor(
    message: string,
    readonly kind: JotformApiErrorKind,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'JotformApiError';
  }
}

type JotformEnvelope<T> = { responseCode?: number; message?: string; content?: T };

const NUMERIC_ID = /^\d+$/;

/**
 * The only place that talks HTTP to Jotform. The API key travels in the `APIKEY` header, never
 * in the URL, so it cannot leak through logs. Every failure becomes a JotformApiError.
 */
@Injectable()
export class JotformApiService {
  constructor(@Inject(jotformConfig.KEY) private readonly config: JotformConfig) {}

  /** Reads one submission with its answers. */
  async getSubmission(submissionId: string): Promise<JotformSubmissionContent> {
    this.assertNumeric(submissionId);
    return this.request<JotformSubmissionContent>(`/submission/${submissionId}`);
  }

  /** Reads the newest submissions of a form, newest first. */
  async listSubmissions(formId: string, limit: number): Promise<JotformSubmissionContent[]> {
    this.assertNumeric(formId);
    return this.request<JotformSubmissionContent[]>(
      `/form/${formId}/submissions?limit=${limit}&orderby=created_at`,
    );
  }

  /** Ids go into the URL path, so anything but digits is rejected before the request. */
  private assertNumeric(id: string): void {
    if (!NUMERIC_ID.test(id))
      throw new JotformApiError(JOTFORM_MESSAGES.ERROR.ID_INVALID, 'not_found');
  }

  private async request<T>(path: string): Promise<T> {
    if (!this.config.apiKey) {
      throw new JotformApiError(JOTFORM_MESSAGES.ERROR.API_KEY_MISSING, 'config');
    }

    let response: Response;
    try {
      response = await fetch(`${this.config.apiBaseUrl.replace(/\/$/, '')}${path}`, {
        headers: { APIKEY: this.config.apiKey, accept: 'application/json' },
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        throw new JotformApiError(JOTFORM_MESSAGES.ERROR.REQUEST_TIMEOUT, 'timeout');
      }
      throw new JotformApiError(JOTFORM_MESSAGES.ERROR.UNREACHABLE, 'network');
    }

    let body: JotformEnvelope<T>;
    try {
      body = (await response.json()) as JotformEnvelope<T>;
    } catch {
      throw new JotformApiError(
        JOTFORM_MESSAGES.ERROR.RESPONSE_INVALID,
        'upstream',
        response.status,
      );
    }

    // Jotform can answer HTTP 200 with an error code in the body, so both are checked.
    const status = response.ok ? (body.responseCode ?? response.status) : response.status;
    if (status < 200 || status >= 300 || body.content === undefined) {
      throw new JotformApiError(
        body.message ?? `Jotform HTTP ${status}`,
        this.kindOf(status),
        status,
      );
    }
    return body.content;
  }

  private kindOf(status: number): JotformApiErrorKind {
    if (status === 401 || status === 403) return 'auth';
    if (status === 404) return 'not_found';
    return 'upstream';
  }
}
