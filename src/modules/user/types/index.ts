export type UserResponse = {
  id: string;
  username: string;
  email: string | null;
  nickname: string | null;
  createdAt: Date;
  updatedAt: Date;
};
