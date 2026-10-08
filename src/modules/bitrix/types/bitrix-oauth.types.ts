export type OAuthTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  domain: string;
  member_id: string;
  scope: string;
  status: string;
  client_endpoint: string;
  server_endpoint: string;
};
