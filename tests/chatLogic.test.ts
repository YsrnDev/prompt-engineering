import assert from 'node:assert/strict';
import test from 'node:test';
import {
  capStoredMessages,
  parseGenerateRequestPayload,
  trimMessagesForContext,
} from '../lib/chatShared.js';
import {
  consumeSseEvents,
  parseOpenAICompatibleSseEvent,
  toOpenAICompatibleMessages,
} from '../lib/openaiCompatible.js';
import { parseNdjsonEvents } from '../services/chatApi.js';
import type { Message } from '../types.js';

const makeMessage = (id: number, role: Message['role']): Message => ({
  id: `msg-${id}`,
  role,
  content: `content-${id}`,
});

test('trimMessagesForContext keeps only the most recent messages', () => {
  const messages = Array.from({ length: 6 }, (_, index) =>
    makeMessage(index, index % 2 === 0 ? 'user' : 'assistant')
  );

  const result = trimMessagesForContext(messages, 3);
  assert.equal(result.length, 3);
  assert.deepEqual(
    result.map((message) => message.id),
    ['msg-3', 'msg-4', 'msg-5']
  );
});

test('capStoredMessages trims persisted chat history', () => {
  const messages = Array.from({ length: 5 }, (_, index) =>
    makeMessage(index, 'assistant')
  );

  const result = capStoredMessages(messages, 2);
  assert.deepEqual(
    result.map((message) => message.id),
    ['msg-3', 'msg-4']
  );
});

test('parseGenerateRequestPayload validates shape and message schema', () => {
  const validPayload = {
    messages: [makeMessage(1, 'user'), makeMessage(2, 'assistant')],
  };

  assert.deepEqual(parseGenerateRequestPayload(validPayload), validPayload);
  assert.equal(parseGenerateRequestPayload({}), null);
  assert.equal(
    parseGenerateRequestPayload({
      messages: [{ id: 1, role: 'user', content: 'invalid id type' }],
    }),
    null
  );
});

test('parseGenerateRequestPayload validates generation mode when provided', () => {
  const withMode = {
    messages: [makeMessage(1, 'user')],
    mode: 'expert',
  };

  assert.deepEqual(parseGenerateRequestPayload(withMode), withMode);
  assert.equal(
    parseGenerateRequestPayload({
      messages: [makeMessage(1, 'user')],
      mode: 'ultra',
    }),
    null
  );
});

test('parseGenerateRequestPayload validates target agent when provided', () => {
  const withTargetAgent = {
    messages: [makeMessage(1, 'user')],
    targetAgent: 'claude-code',
  };

  assert.deepEqual(
    parseGenerateRequestPayload(withTargetAgent),
    withTargetAgent
  );
  assert.equal(
    parseGenerateRequestPayload({
      messages: [makeMessage(1, 'user')],
      targetAgent: 'chatgpt',
    }),
    null
  );
});

test('parseNdjsonEvents reads chunk/done/error events and ignores invalid lines', () => {
  const input = [
    JSON.stringify({ type: 'chunk', text: 'hello' }),
    JSON.stringify({ type: 'chunk', text: ' world' }),
    'not-json',
    JSON.stringify({ type: 'done' }),
    JSON.stringify({ type: 'error', message: 'boom' }),
  ].join('\n');

  const result = parseNdjsonEvents(input);
  assert.deepEqual(result, [
    { type: 'chunk', text: 'hello' },
    { type: 'chunk', text: ' world' },
    { type: 'done' },
    { type: 'error', message: 'boom' },
  ]);
});

test('toOpenAICompatibleMessages prepends system message and maps roles', () => {
  const result = toOpenAICompatibleMessages(
    [makeMessage(1, 'user'), makeMessage(2, 'assistant')],
    'system instruction'
  );

  assert.deepEqual(result, [
    { role: 'system', content: 'system instruction' },
    { role: 'user', content: 'content-1' },
    { role: 'assistant', content: 'content-2' },
  ]);
});

test('consumeSseEvents extracts complete events and preserves rest', () => {
  const result = consumeSseEvents('data: one\n\ndata: two\n\npartial');
  assert.deepEqual(result.events, ['data: one', 'data: two']);
  assert.equal(result.rest, 'partial');
});

test('parseOpenAICompatibleSseEvent handles chunk, done, and error', () => {
  const chunk = parseOpenAICompatibleSseEvent(
    'data: {"choices":[{"delta":{"content":"Hello"}}]}'
  );
  const done = parseOpenAICompatibleSseEvent('data: [DONE]');
  const error = parseOpenAICompatibleSseEvent(
    'data: {"error":{"message":"Bad request"}}'
  );

  assert.deepEqual(chunk, { type: 'chunk', text: 'Hello' });
  assert.deepEqual(done, { type: 'done' });
  assert.deepEqual(error, { type: 'error', message: 'Bad request' });
});
