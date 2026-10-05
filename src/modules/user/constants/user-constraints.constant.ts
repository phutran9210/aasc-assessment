export const USER_CONSTRAINTS = {
  USERNAME: { MIN_LENGTH: 3, MAX_LENGTH: 30, PATTERN: /^[a-zA-Z0-9_]+$/ },
  // bcrypt only reads the first 72 bytes of a password; longer input is rejected, not truncated.
  PASSWORD: { MIN_LENGTH: 8, MAX_BYTES: 72 },
  PASSWORD_HASH: { MAX_LENGTH: 100 },
  EMAIL: { MAX_LENGTH: 255 },
  NICKNAME: { MIN_LENGTH: 2, MAX_LENGTH: 30 },
} as const;
