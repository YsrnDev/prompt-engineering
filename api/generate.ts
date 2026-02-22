import {
  parseGenerateRequestPayload,
  trimMessagesForContext,
} from '../lib/chatShared.js';
import { generatePromptArtifact } from '../lib/promptGenerationEngine.js';
import { splitIntoStreamChunks } from '../lib/promptStability.js';
import { createSkillsIntegration } from '../server/skillsIntegration.js';
import {
  applyCorsHeaders,
  checkRateLimit,
  getAllowedCorsOrigins,
  isAuthorizedRequest,
  readPositiveIntegerEnv,
  readJsonBody,
  RequestBodyTooLargeError,
  sendJson,
  sendNdjson,
  setStreamHeaders,
  toErrorMessage,
  type EnvSource,
  type VercelLikeRequest,
  type VercelLikeResponse,
} from './_common.js';

const DEFAULT_MAX_BODY_BYTES = 1_000_000;

const ENV_SOURCE: EnvSource = {};
const skillsIntegration = createSkillsIntegration(ENV_SOURCE);
const allowedCorsOrigins = getAllowedCorsOrigins(ENV_SOURCE);

const handleGenerate = async (
  req: VercelLikeRequest,
  res: VercelLikeResponse
): Promise<void> => {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method Not Allowed. Use POST.' });
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req, {
      maxBytes: readPositiveIntegerEnv(
        ENV_SOURCE,
        'GENERATE_MAX_BODY_BYTES',
        DEFAULT_MAX_BODY_BYTES
      ),
    });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      sendJson(res, error.statusCode, { error: error.message });
      return;
    }

    sendJson(res, 400, { error: 'Invalid JSON body.' });
    return;
  }

  const payload = parseGenerateRequestPayload(body);
  if (!payload || payload.messages.length === 0) {
    sendJson(res, 400, { error: 'Invalid payload. Expected { messages: [] }.' });
    return;
  }

  const contextMessages = trimMessagesForContext(payload.messages);
  const skillInstruction =
    (await skillsIntegration.buildInstructionForRequest(contextMessages, {
      targetAgent: payload.targetAgent,
      mode: payload.mode,
      stabilityProfile: payload.stabilityProfile,
    })) || '';

  setStreamHeaders(res);

  try {
    const result = await generatePromptArtifact({
      envSource: ENV_SOURCE,
      payload,
      contextMessages,
      skillInstruction,
    });

    for (const chunk of splitIntoStreamChunks(result.output)) {
      sendNdjson(res, { type: 'chunk', text: chunk });
    }

    if (result.repaired) {
      sendNdjson(res, {
        type: 'meta',
        event: 'auto_repair_applied',
        stabilityProfile: result.stabilityProfile,
      });
    }

    sendNdjson(res, { type: 'done' });
    res.end();
  } catch (error) {
    sendNdjson(res, { type: 'error', message: toErrorMessage(error) });
    res.end();
  }
};

export default async function handler(
  req: VercelLikeRequest,
  res: VercelLikeResponse
): Promise<void> {
  applyCorsHeaders(req, res, allowedCorsOrigins);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (!isAuthorizedRequest(req, ENV_SOURCE)) {
    sendJson(res, 401, { error: 'Unauthorized request.' });
    return;
  }

  const rateLimit = checkRateLimit(req, ENV_SOURCE, {
    keyPrefix: 'generate',
    maxRequestsEnvKey: 'GENERATE_RATE_LIMIT_MAX_REQUESTS',
    windowMsEnvKey: 'GENERATE_RATE_LIMIT_WINDOW_MS',
    defaultMaxRequests: 30,
    defaultWindowMs: 60_000,
  });
  res.setHeader('X-RateLimit-Limit', String(rateLimit.limit));
  res.setHeader('X-RateLimit-Remaining', String(rateLimit.remaining));
  res.setHeader('Retry-After', String(rateLimit.retryAfterSeconds));
  if (!rateLimit.allowed) {
    sendJson(res, 429, {
      error: 'Rate limit exceeded. Please retry later.',
    });
    return;
  }

  try {
    await handleGenerate(req, res);
  } catch (error) {
    if (!res.headersSent) {
      sendJson(res, 500, { error: toErrorMessage(error) });
      return;
    }

    sendNdjson(res, { type: 'error', message: toErrorMessage(error) });
    res.end();
  }
}
