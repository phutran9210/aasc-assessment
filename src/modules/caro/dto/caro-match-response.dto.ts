import { ApiProperty } from '@nestjs/swagger';

import { CARO_END_REASON_VALUES, CARO_RESULT_VALUES } from '../constants/index.js';
import type { CaroEndReason, CaroResult, CaroSymbol } from '../constants/index.js';

/** Swagger schema of `CaroMatchListItem`. */
export class CaroMatchListItemDto {
  @ApiProperty({ description: 'ID trận đấu (UUID)', format: 'uuid' })
  id: string;

  @ApiProperty({ description: 'Tên người chơi X (đi trước)', example: 'Văn A' })
  playerX: string;

  @ApiProperty({ description: 'Tên người chơi O', example: 'Thị B' })
  playerO: string;

  @ApiProperty({ description: 'Ký hiệu của bạn trong trận', enum: ['X', 'O'] })
  you: CaroSymbol;

  @ApiProperty({ description: 'Kết quả đối với bạn', enum: ['win', 'lose', 'draw'] })
  outcome: string;

  @ApiProperty({ description: 'Kết quả trận đấu', enum: CARO_RESULT_VALUES })
  result: CaroResult;

  @ApiProperty({ description: 'Lý do kết thúc', enum: CARO_END_REASON_VALUES })
  reason: CaroEndReason;

  @ApiProperty({ description: 'Số nước đã đi', example: 23 })
  moveCount: number;

  @ApiProperty({ description: 'Thời điểm bắt đầu (ISO 8601)', format: 'date-time' })
  startedAt: Date;

  @ApiProperty({ description: 'Thời điểm kết thúc (ISO 8601)', format: 'date-time' })
  finishedAt: Date;
}
