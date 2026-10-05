import { applyDecorators } from '@nestjs/common';
import type { Type } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  getSchemaPath,
} from '@nestjs/swagger';

import { ErrorResponseDto, PaginationMetaDto } from '../dto/index.js';

type EndpointDecorator = MethodDecorator & ClassDecorator;

const badRequest = (): EndpointDecorator =>
  ApiBadRequestResponse({ description: 'Dữ liệu đầu vào không hợp lệ', type: ErrorResponseDto });

const notFound = (resource: string): EndpointDecorator =>
  ApiNotFoundResponse({ description: `${resource} không tồn tại`, type: ErrorResponseDto });

/** `GET /resources` — paginated list: `{ data: Item[], meta }`. */
export const ApiList = (summary: string, itemDto: Type<unknown>): EndpointDecorator =>
  applyDecorators(
    ApiOperation({ summary }),
    ApiExtraModels(PaginationMetaDto, itemDto),
    ApiOkResponse({
      schema: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: { type: 'array', items: { $ref: getSchemaPath(itemDto) } },
          meta: { $ref: getSchemaPath(PaginationMetaDto) },
        },
      },
    }),
    badRequest(),
  );

/** `GET /resources/:id` */
export const ApiDetail = (
  summary: string,
  responseDto: Type<unknown>,
  resource: string,
): EndpointDecorator =>
  applyDecorators(
    ApiOperation({ summary }),
    ApiOkResponse({ type: responseDto }),
    notFound(resource),
  );

/** `POST /resources` */
export const ApiCreate = (summary: string, responseDto: Type<unknown>): EndpointDecorator =>
  applyDecorators(
    ApiOperation({ summary }),
    ApiCreatedResponse({ type: responseDto }),
    badRequest(),
  );

/** `PUT|PATCH /resources/:id` */
export const ApiUpdate = (
  summary: string,
  responseDto: Type<unknown>,
  resource: string,
): EndpointDecorator =>
  applyDecorators(
    ApiOperation({ summary }),
    ApiOkResponse({ type: responseDto }),
    badRequest(),
    notFound(resource),
  );

/** `DELETE /resources/:id` — 204, no body. */
export const ApiDelete = (summary: string, resource: string): EndpointDecorator =>
  applyDecorators(
    ApiOperation({ summary }),
    ApiNoContentResponse({ description: `Xóa ${resource} thành công` }),
    notFound(resource),
  );
