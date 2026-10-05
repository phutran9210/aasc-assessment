export { AuthModule } from './auth.module.js';
export { CurrentUser } from './decorators/current-user.decorator.js';
export { JwtAuthGuard } from './guards/jwt-auth.guard.js';
export { AuthService } from './services/auth.service.js';
export type { AuthUser, LoginResponse } from './types/index.js';
export type { AuthenticatedSocket } from './ws/ws-auth.middleware.js';
export { createWsAuthMiddleware } from './ws/ws-auth.middleware.js';
