import { randomUUID } from 'node:crypto';

import bcrypt from 'bcrypt';

import { Inject, Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { validateTiktokEnv } from '@config/tiktok-app/env.validation.js';
import { IntegrationUserRepository } from '../repositories/integration-user.repository.js';
import type { IntegrationUserEntity } from '../entities/integration-user.entity.js';
import type { LoginDto, LoginResponse } from '../dto/login.dto.js';
import type { Actor, IntegrationRole } from '../types/actor.type.js';
import { INTEGRATION_ROLES } from '../constants/integration-role.constants.js';
import { SessionService } from './session.service.js';

export const INTEGRATION_AUTH_CONFIG = Symbol('INTEGRATION_AUTH_CONFIG');

type IntegrationJwtClaims = {
  sub: string;
  sid: string;
  authVersion: number;
  iss: string;
  aud: string | string[];
  exp: number;
};

type IntegrationAuthConfig = ReturnType<typeof validateTiktokEnv>;

@Injectable()
export class IntegrationAuthService {
  private dummyHash: string | undefined;

  constructor(
    private readonly users: IntegrationUserRepository,
    private readonly sessions: SessionService,
    private readonly jwt: JwtService,
    @Inject(INTEGRATION_AUTH_CONFIG) private readonly config: IntegrationAuthConfig,
  ) {}

  async login(dto: LoginDto, ipAddress: string): Promise<LoginResponse> {
    if (Buffer.byteLength(dto.password, 'utf8') > 72) {
      throw new BadRequestException('Password exceeds the supported length');
    }
    const username = dto.username.trim().toLowerCase();
    await this.sessions.assertLoginAllowed(ipAddress, username);
    const user = await this.users.findByUsername(username);
    const passwordHash = user?.passwordHash ?? (await this.getDummyHash());
    const passwordMatches = await bcrypt.compare(dto.password, passwordHash);
    if (!user || !user.active || !passwordMatches) {
      throw new UnauthorizedException('Invalid username or password');
    }

    await this.sessions.resetLoginAttempts(ipAddress, username);
    const sid = randomUUID();
    await this.sessions.create(
      sid,
      user.id,
      user.authVersion,
      this.config.jwtTtlSeconds,
      user.roles,
    );
    try {
      const accessToken = await this.jwt.signAsync({
        sub: user.id,
        sid,
        authVersion: user.authVersion,
      });
      return {
        accessToken,
        tokenType: 'Bearer',
        expiresIn: this.config.jwtTtlSeconds,
        user: { id: user.id, username: user.username, roles: currentRoles(user) },
      };
    } catch (error) {
      await this.sessions.revoke(sid);
      throw error;
    }
  }

  async authenticate(token: string | undefined): Promise<Actor> {
    const claims = await this.verifyToken(token);
    if (!claims.sub || !claims.sid || !Number.isSafeInteger(claims.authVersion)) {
      throw new UnauthorizedException('Invalid token');
    }
    const user = await this.users.findById(claims.sub);
    if (!user || !user.active || user.authVersion !== claims.authVersion) {
      throw new UnauthorizedException('Session is no longer active');
    }
    if (!(await this.sessions.isActive(claims.sid, claims.sub, claims.authVersion, user.roles))) {
      throw new UnauthorizedException('Session is no longer active');
    }
    return {
      sub: user.id,
      sid: claims.sid,
      username: user.username,
      roles: currentRoles(user),
    };
  }

  /** Verifies JWT authenticity but intentionally does not require an active session. */
  async logout(token: string | undefined): Promise<void> {
    const claims = await this.verifyToken(token);
    if (!claims.sid) throw new UnauthorizedException('Invalid token');
    await this.sessions.revoke(claims.sid);
  }

  async logoutAuthorizationHeader(authorization: string | undefined): Promise<void> {
    const [scheme, token] = authorization?.trim().split(/\s+/, 2) ?? [];
    await this.logout(scheme?.toLowerCase() === 'bearer' ? token : undefined);
  }

  private async verifyToken(token: string | undefined): Promise<IntegrationJwtClaims> {
    if (!token) throw new UnauthorizedException('Bearer token is required');
    try {
      return await this.jwt.verifyAsync<IntegrationJwtClaims>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  private async getDummyHash(): Promise<string> {
    this.dummyHash ??= await bcrypt.hash('fixed-dummy-password-never-used', 12);
    return this.dummyHash;
  }
}

function currentRoles(user: Pick<IntegrationUserEntity, 'roles'>): IntegrationRole[] {
  return user.roles.filter((role): role is IntegrationRole =>
    (INTEGRATION_ROLES as readonly string[]).includes(role),
  );
}
