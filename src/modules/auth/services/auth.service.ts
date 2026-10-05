import { authConfig } from '@config/index.js';
import type { AuthConfig } from '@config/index.js';
import { UserService } from '@modules/user/services/user.service.js';
import type { UserResponse } from '@modules/user/types/index.js';

import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import bcrypt from 'bcrypt';

import { CredentialsDto } from '../dto/index.js';
import { AUTH_MESSAGES } from '../messages/index.js';
import type { AuthUser, JwtPayload, LoginResponse } from '../types/index.js';

@Injectable()
export class AuthService {
  /** Compared against when the username is unknown, so both failures take the same time. */
  private dummyHash: string | undefined;

  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    @Inject(authConfig.KEY) private readonly config: AuthConfig,
  ) {}

  async register(dto: CredentialsDto): Promise<UserResponse> {
    const passwordHash = await bcrypt.hash(dto.password, this.config.bcryptRounds);
    return this.userService.create({ username: dto.username, passwordHash });
  }

  async login(dto: CredentialsDto): Promise<LoginResponse> {
    const user = await this.userService.findEntityByUsername(dto.username);
    const passwordMatches = await bcrypt.compare(
      dto.password,
      user?.passwordHash ?? (await this.getDummyHash()),
    );
    if (!user || !passwordMatches) {
      throw new UnauthorizedException(AUTH_MESSAGES.ERROR.INVALID_CREDENTIALS);
    }

    const payload: JwtPayload = { sub: user.id, username: user.username };
    return {
      accessToken: await this.jwtService.signAsync(payload),
      tokenType: 'Bearer',
      expiresIn: this.config.jwtExpiresInSeconds,
      user: await this.userService.getProfile(user.id),
    };
  }

  /** Used by the HTTP guard and by the WebSocket handshake. Throws 401 on any invalid token. */
  async verifyToken(token: string | undefined): Promise<AuthUser> {
    if (!token) throw new UnauthorizedException(AUTH_MESSAGES.ERROR.TOKEN_MISSING);

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
      return { id: payload.sub, username: payload.username };
    } catch {
      // Expired, malformed and wrongly signed tokens all get the same answer.
      throw new UnauthorizedException(AUTH_MESSAGES.ERROR.TOKEN_INVALID);
    }
  }

  private async getDummyHash(): Promise<string> {
    this.dummyHash ??= await bcrypt.hash('dummy-password', this.config.bcryptRounds);
    return this.dummyHash;
  }
}
