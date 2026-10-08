import { ApiPropertyOptional } from '@nestjs/swagger';

import { IsBoolean, IsOptional } from 'class-validator';

/** Body of `POST /lead-sync/runs`. Both flags default to false. */
export class TriggerRunDto {
  @ApiPropertyOptional({
    description: 'Chạy thử: đọc, ánh xạ, tìm trùng và lập kế hoạch nhưng không ghi gì',
    default: false,
  })
  @IsOptional()
  @IsBoolean({ message: 'dryRun phải là true hoặc false' })
  dryRun?: boolean;

  @ApiPropertyOptional({
    description: 'Đồng bộ lại mọi hàng hợp lệ dù sync hash không đổi',
    default: false,
  })
  @IsOptional()
  @IsBoolean({ message: 'force phải là true hoặc false' })
  force?: boolean;
}
