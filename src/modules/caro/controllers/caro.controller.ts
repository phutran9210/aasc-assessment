import { PaginationQueryDto } from '@common/dto/index.js';
import type { PaginatedResponse } from '@common/types/index.js';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard.js';
import type { AuthUser } from '@modules/auth/types/index.js';

import { Controller, Get, HttpCode, HttpStatus, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { ApiCaroHistory } from '../decorators/index.js';
import { CaroMatchService } from '../services/caro-match.service.js';
import type { CaroMatchListItem } from '../types/index.js';

@ApiTags('Caro')
@Controller('caro')
@UseGuards(JwtAuthGuard)
export class CaroController {
  constructor(private readonly matchService: CaroMatchService) {}

  @Get('matches')
  @HttpCode(HttpStatus.OK)
  @ApiCaroHistory()
  findHistory(
    @CurrentUser() user: AuthUser,
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedResponse<CaroMatchListItem>> {
    return this.matchService.findHistory(user.id, query);
  }
}
