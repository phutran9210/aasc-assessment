export type BitrixInstallationSnapshot = {
  id: string;
  memberId: string;
  domain: string;
  clientEndpoint: string;
  serverEndpoint: string;
  scope: string;
  status: string;
  accessToken: string;
  refreshToken: string;
  applicationToken: string | null;
  accessTokenExpiresAt: Date;
};

export type RefreshLease = {
  installationId: string;
  ownerToken: string;
  expiresAt: Date;
};
