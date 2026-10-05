import type { UserResponse } from '@modules/user/types/index.js';

/** Identity carried by a verified access token; attached to `request.user` / `socket.data.user`. */
export type AuthUser = {
  id: string;
  username: string;
};

/** Claims stored inside the JWT. */
export type JwtPayload = {
  sub: string;
  username: string;
};

export type LoginResponse = {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: UserResponse;
};
