import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ContactResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional() phone?: string;
  @ApiPropertyOptional() email?: string;
  @ApiPropertyOptional() website?: string;
  @ApiPropertyOptional({ nullable: true }) address: {
    ward: string;
    district: string;
    province: string;
  } | null;
  @ApiPropertyOptional({ nullable: true }) bank: { bankName: string; accountNumber: string } | null;
}
