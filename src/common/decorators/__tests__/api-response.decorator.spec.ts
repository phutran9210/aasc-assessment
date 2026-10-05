import { Controller, Delete, Get, Module, Post, Put } from '@nestjs/common';
import { ApiProperty, DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';

import { ApiCreate, ApiDelete, ApiDetail, ApiList, ApiUpdate } from '../api-response.decorator.js';

class WidgetDto {
  @ApiProperty()
  id: string;
}

@Controller('widgets')
class WidgetController {
  @Get()
  @ApiList('List widgets', WidgetDto)
  list(): void {}

  @Get(':id')
  @ApiDetail('Get widget', WidgetDto, 'Widget')
  detail(): void {}

  @Post()
  @ApiCreate('Create widget', WidgetDto)
  create(): void {}

  @Put(':id')
  @ApiUpdate('Update widget', WidgetDto, 'Widget')
  update(): void {}

  @Delete(':id')
  @ApiDelete('Delete widget', 'Widget')
  remove(): void {}
}

@Module({ controllers: [WidgetController] })
class WidgetModule {}

describe('api response decorators', () => {
  let document: OpenAPIObject;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [WidgetModule] }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    document = SwaggerModule.createDocument(app, new DocumentBuilder().build());
    await app.close();
  });

  const responsesOf = (path: string, method: 'get' | 'post' | 'put' | 'delete') =>
    document.paths[path]?.[method]?.responses as Record<string, any>;

  it('should document a paginated envelope when ApiList is applied', () => {
    const responses = responsesOf('/widgets', 'get');

    expect(document.paths['/widgets']?.get?.summary).toBe('List widgets');
    expect(responses['200'].content['application/json'].schema).toEqual({
      type: 'object',
      required: ['data', 'meta'],
      properties: {
        data: { type: 'array', items: { $ref: '#/components/schemas/WidgetDto' } },
        meta: { $ref: '#/components/schemas/PaginationMetaDto' },
      },
    });
    expect(document.components?.schemas).toHaveProperty('PaginationMetaDto');
    expect(responses).toHaveProperty('400');
  });

  it('should document 200 and 404 when ApiDetail is applied', () => {
    const responses = responsesOf('/widgets/{id}', 'get');

    expect(responses['200'].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/WidgetDto',
    });
    expect(responses['404'].description).toBe('Widget không tồn tại');
    expect(responses['404'].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/ErrorResponseDto',
    });
  });

  it('should document 201 and 400 when ApiCreate is applied', () => {
    expect(Object.keys(responsesOf('/widgets', 'post')).sort()).toEqual(['201', '400']);
  });

  it('should document 200, 400 and 404 when ApiUpdate is applied', () => {
    expect(Object.keys(responsesOf('/widgets/{id}', 'put')).sort()).toEqual(['200', '400', '404']);
  });

  it('should document 204 and 404 when ApiDelete is applied', () => {
    const responses = responsesOf('/widgets/{id}', 'delete');

    expect(Object.keys(responses).sort()).toEqual(['204', '404']);
    expect(responses['204'].description).toBe('Xóa Widget thành công');
  });
});
