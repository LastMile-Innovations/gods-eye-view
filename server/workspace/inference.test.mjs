import test from 'node:test';
import assert from 'node:assert/strict';
import { createInferenceGateway, readInferenceConfig } from './inference.js';

const env = {
  NEIGHBOR_AI_ENABLED: '1',
  NEIGHBOR_AI_CHAT_URL: 'https://provider.example/v1/chat/completions',
  NEIGHBOR_AI_API_KEY: 'fixture-secret',
  NEIGHBOR_AI_MODEL: 'fixture-text-v1',
};
const input = {
  model: 'qh/chat',
  messages: [{ role: 'user', content: 'Synthetic question' }],
};
const answer = {
  id: 'fixture-reply',
  model: 'fixture-text-v1',
  created: 1,
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: 'Fixture response' },
      finish_reason: 'stop',
    },
  ],
  usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
};

test('disabled inference does not fetch or advertise fixture models', async () => {
  let calls = 0;
  const gateway = createInferenceGateway({
    fetchImpl: async () => {
      calls++;
    },
  });
  assert.deepEqual(gateway.models(), { object: 'list', data: [] });
  await assert.rejects(gateway.complete(input), {
    message: 'INFERENCE_UNAVAILABLE',
  });
  assert.equal(calls, 0);
  for (const change of [
    { NEIGHBOR_AI_CHAT_URL: 'http://provider.example/v1/chat/completions' },
    { NEIGHBOR_AI_API_KEY: '' },
    { NEIGHBOR_AI_MODEL: '' },
    { NEIGHBOR_AI_CHAT_URL: 'https://name:secret@provider.example/api' },
    { NEIGHBOR_AI_ENABLED: 'true' },
  ]) {
    assert.throws(() => readInferenceConfig({ ...env, ...change }), {
      message: 'INFERENCE_CONFIG_INVALID',
    });
  }
});
test('only bounded submitted text reaches the configured provider; actual usage is preserved', async () => {
  let calls = 0;
  const gateway = createInferenceGateway({
    config: readInferenceConfig(env),
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, env.NEIGHBOR_AI_CHAT_URL);
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.Authorization, 'Bearer fixture-secret');
      assert.deepEqual(JSON.parse(options.body), {
        model: 'fixture-text-v1',
        messages: input.messages,
        max_completion_tokens: 1024,
        stream: false,
        store: false,
      });
      return Response.json(answer);
    },
  });
  const result = await gateway.complete(input);
  assert.equal(result.choices[0].message.content, 'Fixture response');
  assert.equal(result.model, 'qh/chat');
  assert.deepEqual(result.usage, answer.usage);
  assert.equal(calls, 1);
  for (const bad of [
    { ...input, model: 'browser-choice' },
    { ...input, tools: [] },
    { ...input, contextRefs: ['private'] },
    { ...input, stream: true },
    { ...input, messages: [{ role: 'tool', content: 'x' }] },
    { ...input, max_completion_tokens: 99999 },
    { ...input, messages: [{ role: 'user', content: 'x'.repeat(131073) }] },
  ]) {
    await assert.rejects(gateway.complete(bad));
  }
  assert.equal(calls, 1);
});
test('missing usage stays unknown and provider secrets/errors never return', async () => {
  const gateway = createInferenceGateway({
    config: readInferenceConfig(env),
    fetchImpl: async () =>
      Response.json({ ...answer, usage: undefined, secret: 'hidden' }),
  });
  const result = await gateway.complete(input);
  assert.equal(result.usage, null);
  assert.ok(!JSON.stringify(result).includes('hidden'));
  for (const response of [
    () => new Response('fixture-secret', { status: 401 }),
    () => Response.json({ choices: [] }),
    () => new Response('x'.repeat(1024 * 1024 + 1)),
    () => {
      throw new Error('fixture-secret');
    },
  ]) {
    let calls = 0;
    const gateway = createInferenceGateway({
      config: readInferenceConfig(env),
      fetchImpl: async () => {
        calls++;
        return response();
      },
    });
    await assert.rejects(
      gateway.complete(input),
      (e) =>
        ['PROVIDER_REJECTED', 'UNKNOWN_OUTCOME'].includes(e.message) &&
        !e.message.includes('secret'),
    );
    assert.equal(calls, 1);
  }
});
test('concurrent requests are bounded and cancellation never retries', async () => {
  let calls = 0;
  let finish;
  const gateway = createInferenceGateway({
    config: readInferenceConfig(env),
    fetchImpl: async () => {
      calls++;
      await new Promise((r) => {
        finish = r;
      });
      return Response.json(answer);
    },
  });
  const account = {};
  const pending = gateway.complete(input, { account });
  await assert.rejects(gateway.complete(input, { account }), {
    message: 'RATE_LIMITED',
  });
  finish();
  await pending;
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(gateway.complete(input, { signal: controller.signal }), {
    message: 'CANCELLED',
  });
  assert.equal(calls, 1);
});
