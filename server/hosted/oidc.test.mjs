import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createOidcClient } from './oidc.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const jwk = {
  ...publicKey.export({ format: 'jwk' }),
  kid: 'fixture-key',
  alg: 'RS256',
  use: 'sig',
};
const encode = (value) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');
const issuer = 'https://identity.example';
const publicOrigin = 'https://neighbor.example';

async function fixture(claimOverrides = {}, corruptSignature = false) {
  let nonce, verifier;
  const client = await createOidcClient({
    issuer,
    publicOrigin,
    clientId: 'neighbor-test',
    clientSecret: 'fixture-secret',
    async fetchImpl(input, options) {
      const url = String(input);
      if (url.endsWith('/.well-known/openid-configuration'))
        return Response.json({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
          response_types_supported: ['code'],
          id_token_signing_alg_values_supported: ['RS256'],
          token_endpoint_auth_methods_supported: ['client_secret_basic'],
        });
      if (url === `${issuer}/jwks`) return Response.json({ keys: [jwk] });
      if (url === `${issuer}/token`) {
        assert.equal(
          new Headers(options.headers)
            .get('authorization')
            .startsWith('Basic '),
          true,
        );
        const params = new URLSearchParams(options.body);
        assert.equal(params.get('code_verifier'), verifier);
        assert.equal(
          params.get('redirect_uri'),
          `${publicOrigin}/auth/callback`,
        );
        const time = Math.floor(Date.now() / 1000);
        const payload = `${encode({ alg: 'RS256', kid: 'fixture-key' })}.${encode({ iss: issuer, sub: 'alice', aud: 'neighbor-test', exp: time + 300, iat: time, nonce, ...claimOverrides })}`;
        let signature = sign('RSA-SHA256', Buffer.from(payload), privateKey);
        if (corruptSignature) signature = Buffer.alloc(signature.length, 0);
        return Response.json({
          access_token: 'fixture-access-token',
          token_type: 'Bearer',
          expires_in: 300,
          id_token: `${payload}.${signature.toString('base64url')}`,
        });
      }
      assert.fail(`Unexpected OIDC fixture URL ${url}`);
    },
  });
  const tx = await client.begin();
  const authorize = new URL(tx.url);
  nonce = tx.nonce;
  verifier = tx.verifier;
  assert.equal(authorize.searchParams.get('state'), tx.state);
  assert.equal(authorize.searchParams.get('nonce'), tx.nonce);
  assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(authorize.searchParams.get('code_challenge'));
  const callback = new URL(
    `${publicOrigin}/auth/callback?code=fixture&state=${tx.state}`,
  );
  return { client, tx, callback };
}

test('actual OIDC library verifies signed ID token, PKCE, state and nonce without exposing tokens', async () => {
  const { client, tx, callback } = await fixture();
  assert.deepEqual(await client.complete(callback, tx), {
    iss: issuer,
    sub: 'alice',
  });
});
for (const [label, overrides, badSignature] of [
  ['issuer', { iss: 'https://evil.example' }, false],
  ['audience', { aud: 'other-client' }, false],
  ['nonce', { nonce: 'forged' }, false],
  ['expired token', { exp: 1 }, false],
  ['signature', {}, true],
])
  test(`actual OIDC library rejects wrong ${label}`, async () => {
    const { client, tx, callback } = await fixture(overrides, badSignature);
    await assert.rejects(client.complete(callback, tx));
  });
test('actual OIDC library rejects mismatched callback state', async () => {
  const { client, tx, callback } = await fixture();
  callback.searchParams.set('state', 'forged');
  await assert.rejects(client.complete(callback, tx));
});
