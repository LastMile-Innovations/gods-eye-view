import {
  createInferenceGateway,
  readInferenceConfig,
} from '../workspace/inference.js';
import http from 'node:http';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { readHostedConfig } from './config.js';
import { createOidcClient } from './oidc.js';
import { createHostedApplication } from './application.js';

try {
  const config = readHostedConfig();
  await access(join(config.staticRoot, 'index.html'));
  const oidc = await createOidcClient(config);
  const inference = createInferenceGateway({ config: readInferenceConfig() });
  const app = createHostedApplication({ config, oidc, inference });
  const server = http.createServer(
    {
      maxHeaderSize: 16 * 1024,
      requestTimeout: 30_000,
      headersTimeout: 15_000,
    },
    app.handler,
  );
  server.maxConnections = 512;
  server.listen(config.port, '0.0.0.0', () =>
    console.info(`NeighborOS hosted server listening on port ${config.port}`),
  );
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await new Promise((r) => server.close(r));
    await app.close();
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
} catch {
  console.error(
    'Hosted startup failed. Check explicit hosted configuration, built assets and OIDC connectivity.',
  );
  process.exitCode = 1;
}
