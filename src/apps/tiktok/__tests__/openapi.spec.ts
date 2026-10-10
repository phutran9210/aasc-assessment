import 'reflect-metadata';
import { Controller, Get, UseGuards } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { IntegrationJwtGuard } from '@modules/integration-auth/guards/integration-jwt.guard.js';
import { buildOpenApiDocument, mountOpenApi } from '../openapi.js';

@Controller('coverage-contract')
class ContractController {
  @Get('public')
  publicRoute() {
    return { ok: true };
  }

  @Get('private')
  @UseGuards(IntegrationJwtGuard)
  privateRoute() {
    return { ok: true };
  }
}

describe('TikTok OpenAPI support', () => {
  it('builds the documented API contract and identifies bearer-protected operations', async () => {
    const module = await Test.createTestingModule({ controllers: [ContractController] })
      .overrideGuard(IntegrationJwtGuard)
      .useValue({ canActivate: () => true })
      .compile();
    const app = module.createNestApplication();
    try {
      const document = buildOpenApiDocument(app);
      expect(document.info).toMatchObject({
        title: expect.stringContaining('TikTok'),
        version: '1.0.0',
      });
      expect(document.components?.schemas?.ErrorResponse).toBeDefined();
      expect(document.paths['/coverage-contract/public']?.get).toMatchObject({
        security: [],
        responses: {
          '400': expect.any(Object),
          '429': expect.any(Object),
          '503': expect.any(Object),
        },
      });
      expect(document.paths['/coverage-contract/private']?.get).toMatchObject({
        security: [{ bearer: [] }],
        responses: { '401': expect.any(Object), '403': expect.any(Object) },
      });
    } finally {
      await app.close();
    }
  });

  it('mounts the contract at the docs route without persisting authorization', async () => {
    const module = await Test.createTestingModule({ controllers: [ContractController] })
      .overrideGuard(IntegrationJwtGuard)
      .useValue({ canActivate: () => true })
      .compile();
    const app = module.createNestApplication();
    const setup = jest
      .spyOn((await import('@nestjs/swagger')).SwaggerModule, 'setup')
      .mockImplementation(() => undefined);
    try {
      mountOpenApi(app);
      expect(setup).toHaveBeenCalledWith('docs', app, expect.any(Object), {
        swaggerOptions: { persistAuthorization: false },
      });
    } finally {
      setup.mockRestore();
      await app.close();
    }
  });
});
