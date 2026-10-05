export type ContactAddress = { ward: string; district: string; province: string };
export type ContactBank = { bankName: string; accountNumber: string };
export type ContactResponse = {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  website?: string;
  address: ContactAddress | null;
  bank: ContactBank | null;
};
export type BitrixValue = Record<string, unknown>;
export type BitrixContactItem = Record<string, unknown> & { id: number | string };
export type RelatedContactData = {
  address?: BitrixValue | null;
  bank?: BitrixValue | null;
};
