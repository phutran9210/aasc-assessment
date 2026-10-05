import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard.js';
import type { PaginatedResponse } from '@common/types/index.js';

import { CreateContactDto, ContactQueryDto, UpdateContactDto } from '../dto/index.js';
import { ContactService } from '../services/contact.service.js';
import type { ContactResponse } from '../types/index.js';

/** REST API for Bitrix24 contacts. Every route requires a JWT from `POST /auth/login`. */
@ApiTags('Contacts')
@ApiBearerAuth()
@Controller('contacts')
@UseGuards(JwtAuthGuard)
export class ContactController {
  constructor(private readonly contactService: ContactService) {}

  /** Lists one page of contacts with their address and bank details. */
  @Get()
  @ApiOperation({ summary: 'Danh sách contact từ Bitrix24' })
  @HttpCode(HttpStatus.OK)
  findAll(@Query() query: ContactQueryDto): Promise<PaginatedResponse<ContactResponse>> {
    return this.contactService.findAll(query);
  }

  /** Creates the contact, then its requisite, address and bank details in Bitrix24. */
  @Post()
  @ApiOperation({ summary: 'Thêm contact mới' })
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateContactDto): Promise<ContactResponse> {
    return this.contactService.create(dto);
  }

  /** Updates only the fields present in the body. Answers 404 for an unknown id. */
  @Put(':id')
  @ApiOperation({ summary: 'Cập nhật contact theo ID' })
  @HttpCode(HttpStatus.OK)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateContactDto,
  ): Promise<ContactResponse> {
    return this.contactService.update(String(id), dto);
  }

  /** Deletes the contact together with its requisite, address and bank details. */
  @Delete(':id')
  @ApiOperation({ summary: 'Xoá contact theo ID' })
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.contactService.remove(String(id));
  }
}
