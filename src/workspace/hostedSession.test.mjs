import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreWorkspaceSession } from './hostedSession.js';

test('hosted discovery never uses local bootstrap; valid sessions restore without another sign-in', async () => {
  const anonymous = {
    paired: false,
    mode: 'hosted',
    signInPath: '/auth/login',
  };
  const api = {
    session: async () => anonymous,
    connectLocal() {
      assert.fail('hosted cannot bootstrap a local owner');
    },
  };
  assert.equal(await restoreWorkspaceSession(api), anonymous);
  const authenticated = { paired: true, mode: 'hosted' };
  api.session = async () => authenticated;
  assert.equal(await restoreWorkspaceSession(api), authenticated);
});
test('development connection is automatic and reads back the session', async () => {
  let connected = false,
    reads = 0;
  const api = {
    session: async () => {
      reads++;
      return { paired: connected, mode: 'local-development' };
    },
    connectLocal: async () => {
      connected = true;
    },
  };
  assert.equal((await restoreWorkspaceSession(api)).paired, true);
  assert.equal(reads, 2);
});
