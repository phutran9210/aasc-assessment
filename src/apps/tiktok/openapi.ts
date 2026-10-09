import type { INestApplication, Type } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';

import { IntegrationJwtGuard } from '@modules/integration-auth/guards/integration-jwt.guard.js';

const GUARDS_METADATA = '__guards__';
const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const;

type SchemaMap = NonNullable<NonNullable<OpenAPIObject['components']>['schemas']>;

const ERROR_SCHEMA: SchemaMap[string] = {
  type: 'object',
  properties: {
    statusCode: { type: 'integer' },
    message: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
    error: { type: 'string' },
    code: { type: 'string', description: 'Stable machine-readable error code when one applies.' },
  },
  required: ['statusCode', 'message'],
};

const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
});

/**
 * Builds the OpenAPI document from the running application's own controllers and DTO metadata,
 * so the published contract cannot drift from the code. Whether a route needs a bearer token is
 * read from the guards actually attached to it, not from its path.
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('AASC TikTok – Bitrix24 integration')
      .setDescription(
        'Signed TikTok lead webhooks, Bitrix24 lead/deal synchronisation, analytics, reports and ' +
          'operations. Protected routes need a bearer token from POST /auth/login.',
      )
      .setVersion('1.0.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearer')
      .build(),
    { operationIdFactory: (controllerKey, methodKey) => `${controllerKey}.${methodKey}` },
  );
  document.components ??= {};
  document.components.schemas = {
    ...document.components.schemas,
    ErrorResponse: ERROR_SCHEMA,
  };

  const controllers = controllerTypes(app);
  for (const item of Object.values(document.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = item[method];
      if (!operation) continue;
      const [controllerKey, methodKey] = (operation.operationId ?? '').split('.');
      const secured = requiresBearer(controllers.get(controllerKey), methodKey);
      operation.security = secured ? [{ bearer: [] }] : [];
      operation.responses = {
        ...operation.responses,
        '400': operation.responses['400'] ?? errorResponse('The request is not valid.'),
        '429': operation.responses['429'] ?? errorResponse('Too many requests; see Retry-After.'),
        '503': operation.responses['503'] ?? errorResponse('A required dependency is unavailable.'),
        ...(secured
          ? {
              '401': operation.responses['401'] ?? errorResponse('Missing or invalid token.'),
              '403': operation.responses['403'] ?? errorResponse('The role is not allowed.'),
            }
          : {}),
      };
    }
  }
  return document;
}

/** Serves the document at `/docs` (UI) and `/docs-json`. */
export function mountOpenApi(app: INestApplication): void {
  SwaggerModule.setup('docs', app, buildOpenApiDocument(app), {
    swaggerOptions: { persistAuthorization: false },
  });
}

function controllerTypes(app: INestApplication): Map<string, Type<unknown>> {
  const types = new Map<string, Type<unknown>>();
  for (const moduleRef of app.get(ModulesContainer).values()) {
    for (const controller of moduleRef.controllers.values()) {
      const metatype = controller.metatype as Type<unknown> | undefined;
      if (metatype) types.set(metatype.name, metatype);
    }
  }
  return types;
}

function requiresBearer(controller: Type<unknown> | undefined, methodKey: string): boolean {
  if (!controller) return false;
  const handler = (controller.prototype as Record<string, unknown>)[methodKey];
  const guards = [
    ...((Reflect.getMetadata(GUARDS_METADATA, controller) as unknown[] | undefined) ?? []),
    ...((handler ? (Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[]) : undefined) ?? []),
  ];
  return guards.includes(IntegrationJwtGuard);
}
