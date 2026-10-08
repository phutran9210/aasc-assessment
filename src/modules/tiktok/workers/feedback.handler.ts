import { Injectable } from '@nestjs/common';

import type {
  OperationContext,
  OperationHandler,
  OperationOutcome,
} from '../../../core/queue/types/worker.types.js';
import { ConversionFeedbackService } from '../services/conversion-feedback.service.js';

@Injectable()
export class FeedbackHandler implements OperationHandler {
  constructor(private readonly feedback: ConversionFeedbackService) {}

  handle(context: OperationContext): Promise<OperationOutcome> {
    return this.feedback.send(context.operationId, context);
  }
}
