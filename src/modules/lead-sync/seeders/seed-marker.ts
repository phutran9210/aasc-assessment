/** Every seeded row has an email on this domain: that is how seeded rows are found again. */
export const SEED_EMAIL_DOMAIN = 'seed.example.com';

export const isSeededEmail = (email: string): boolean =>
  email.trim().toLowerCase().endsWith(`@${SEED_EMAIL_DOMAIN}`);
