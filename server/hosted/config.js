import { resolve, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

function secureUrl(value, originOnly = false) {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    (originOnly && url.pathname !== '/')
  )
    throw new Error('CONFIG');
  return originOnly ? url.origin : url.href;
}

/** Explicit hosted settings; never fall back to development access, a dev store or a new routing key. */
export function readHostedConfig(
  env = process.env,
  { staticRoot = fileURLToPath(new URL('../../dist/', import.meta.url)) } = {},
) {
  try {
    const publicOrigin = secureUrl(env.NEIGHBOR_PUBLIC_ORIGIN, true);
    const issuer = secureUrl(env.NEIGHBOR_OIDC_ISSUER);
    const clientId = env.NEIGHBOR_OIDC_CLIENT_ID;
    const clientSecret = env.NEIGHBOR_OIDC_CLIENT_SECRET;
    const tenantKey = Buffer.from(env.NEIGHBOR_TENANT_KEY || '', 'base64');
    if (
      !clientId ||
      !clientSecret ||
      tenantKey.length !== 32 ||
      !isAbsolute(env.NEIGHBOR_HOSTED_DATA_DIR || '')
    )
      throw new Error('CONFIG');
    const dataRoot = resolve(env.NEIGHBOR_HOSTED_DATA_DIR);
    staticRoot = resolve(staticRoot);
    if (
      dataRoot === staticRoot ||
      dataRoot.startsWith(staticRoot + sep) ||
      staticRoot.startsWith(dataRoot + sep)
    )
      throw new Error('CONFIG');
    const port = Number(env.PORT || 8080);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error('CONFIG');
    return Object.freeze({
      publicOrigin,
      issuer,
      clientId,
      clientSecret,
      tenantKey,
      dataRoot,
      staticRoot,
      port,
    });
  } catch {
    throw new Error('HOSTED_CONFIG_INVALID');
  }
}
