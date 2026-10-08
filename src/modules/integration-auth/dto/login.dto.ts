import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(80)
  @Matches(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/)
  username!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(72)
  password!: string;
}

export type LoginResponse = {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: { id: string; username: string; roles: string[] };
};
