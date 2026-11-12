import * as oidc from 'openid-client';

/** Confidential OIDC code flow. Tokens remain server-side and are discarded after validated identity extraction. */
export async function createOidcClient({
  issuer,
  clientId,
  clientSecret,
  publicOrigin,
  fetchImpl,
}) {
  const config = await oidc.discovery(
    new URL(issuer),
    clientId,
    undefined,
    oidc.ClientSecretBasic(clientSecret),
    {
      execute: [oidc.enableNonRepudiationChecks],
      ...(fetchImpl ? { [oidc.customFetch]: fetchImpl } : {}),
      timeout: 10,
    },
  );
  const redirectUri = `${publicOrigin}/auth/callback`;
  return {
    async begin() {
      const verifier = oidc.randomPKCECodeVerifier();
      const state = oidc.randomState(),
        nonce = oidc.randomNonce();
      const url = oidc.buildAuthorizationUrl(config, {
        redirect_uri: redirectUri,
        scope: 'openid profile email',
        code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
        code_challenge_method: 'S256',
        state,
        nonce,
      });
      return { state, nonce, verifier, url: url.href };
    },
    async complete(url, transaction) {
      const tokens = await oidc.authorizationCodeGrant(config, url, {
        pkceCodeVerifier: transaction.verifier,
        expectedState: transaction.state,
        expectedNonce: transaction.nonce,
        idTokenExpected: true,
      });
      const claims = tokens.claims();
      if (
        !claims ||
        claims.iss !== config.serverMetadata().issuer ||
        typeof claims.sub !== 'string' ||
        !claims.sub ||
        claims.sub.length > 255
      )
        throw new Error('UNAUTHENTICATED');
      return { iss: claims.iss, sub: claims.sub };
    },
  };
}
