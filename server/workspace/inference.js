/** Text-only provider transport. No native data lookup, tools, retries or browser configuration. */
const ALIAS = 'qh/chat';
const REQUEST_LIMIT = 128 * 1024;
const RESPONSE_LIMIT = 1024 * 1024;
const fail = (code) => {
  throw new Error(code);
};

export function readInferenceConfig(env = process.env) {
  if (!env.NEIGHBOR_AI_ENABLED || env.NEIGHBOR_AI_ENABLED === '0')
    return undefined;
  try {
    if (env.NEIGHBOR_AI_ENABLED !== '1') fail('CONFIG');
    const url = new URL(env.NEIGHBOR_AI_CHAT_URL);
    const apiKey = env.NEIGHBOR_AI_API_KEY;
    const model = env.NEIGHBOR_AI_MODEL;
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.hash ||
      url.search ||
      !apiKey ||
      apiKey.length > 8192 ||
      /[\r\n]/.test(apiKey) ||
      !model ||
      model.length > 256 ||
      /[\r\n]/.test(model)
    )
      fail('CONFIG');
    return Object.freeze({ url: url.href, apiKey, model });
  } catch {
    fail('INFERENCE_CONFIG_INVALID');
  }
}

function requestBody(input, model) {
  if (
    !input ||
    Array.isArray(input) ||
    typeof input !== 'object' ||
    Object.keys(input).some(
      (k) =>
        !['model', 'messages', 'max_completion_tokens', 'stream'].includes(k),
    ) ||
    (input.model !== undefined && input.model !== ALIAS) ||
    (input.stream !== undefined && input.stream !== false)
  )
    fail('UNSUPPORTED');
  if (
    !Array.isArray(input.messages) ||
    !input.messages.length ||
    input.messages.length > 32 ||
    input.messages.at(-1)?.role !== 'user'
  )
    fail('INVALID');
  const messages = input.messages.map((message) => {
    if (
      !message ||
      typeof message !== 'object' ||
      Array.isArray(message) ||
      Object.keys(message).some((k) => !['role', 'content'].includes(k)) ||
      !['user', 'assistant'].includes(message.role) ||
      typeof message.content !== 'string' ||
      !message.content.trim()
    )
      fail('INVALID');
    return { role: message.role, content: message.content };
  });
  const maxTokens = input.max_completion_tokens ?? 1024;
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 4096)
    fail('INVALID');
  const body = JSON.stringify({
    model,
    messages,
    max_completion_tokens: maxTokens,
    stream: false,
    store: false,
  });
  if (Buffer.byteLength(body) > REQUEST_LIMIT) fail('RESOURCE_LIMIT');
  return body;
}

async function readResponse(response) {
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    // Even rejection does not assert that the provider performed no billable processing.
    fail('PROVIDER_REJECTED');
  }
  if (!response.body) fail('UNKNOWN_OUTCOME');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > RESPONSE_LIMIT) fail('UNKNOWN_OUTCOME');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)),
  );
}

function completion(value) {
  const choice = value?.choices?.[0];
  if (
    typeof value?.id !== 'string' ||
    value.id.length > 256 ||
    !Number.isSafeInteger(value.created) ||
    value.created < 0 ||
    !Array.isArray(value.choices) ||
    value.choices.length !== 1 ||
    choice.index !== 0 ||
    choice.message?.role !== 'assistant' ||
    typeof choice.message.content !== 'string' ||
    !['stop', 'length', 'content_filter'].includes(choice.finish_reason) ||
    choice.message.tool_calls
  )
    fail('UNKNOWN_OUTCOME');
  const raw = value.usage;
  const fields = ['prompt_tokens', 'completion_tokens', 'total_tokens'];
  const usage =
    raw &&
    fields.every((k) => Number.isSafeInteger(raw[k]) && raw[k] >= 0) &&
    raw.total_tokens === raw.prompt_tokens + raw.completion_tokens
      ? Object.fromEntries(fields.map((k) => [k, raw[k]]))
      : null;
  return {
    id: value.id,
    object: 'chat.completion',
    created: value.created,
    model: ALIAS,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: choice.message.content },
        finish_reason: choice.finish_reason,
      },
    ],
    usage,
    executionMode: 'provider_text_only',
    epistemic: 'Inferred',
  };
}

export function createInferenceGateway({ config, fetchImpl = fetch } = {}) {
  let active = 0;
  const accounts = new WeakSet();
  return {
    models: () => ({
      object: 'list',
      data: config
        ? [{ id: ALIAS, object: 'model', owned_by: 'configured-provider' }]
        : [],
    }),
    async complete(input, { account, signal } = {}) {
      if (!config) fail('INFERENCE_UNAVAILABLE');
      const body = requestBody(input, config.model);
      if (signal?.aborted) fail('CANCELLED');
      if (active >= 4 || (account && accounts.has(account)))
        fail('RATE_LIMITED');
      active++;
      if (account) accounts.add(account);
      const timeout = AbortSignal.timeout(20_000);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      try {
        const response = await fetchImpl(config.url, {
          method: 'POST',
          redirect: 'error',
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body,
          signal: combined,
        });
        return completion(await readResponse(response));
      } catch (error) {
        if (error.message === 'PROVIDER_REJECTED') throw error;
        // Dispatch may have reached the provider: never retry or claim zero cost.
        fail('UNKNOWN_OUTCOME');
      } finally {
        active--;
        if (account) accounts.delete(account);
      }
    },
  };
}
