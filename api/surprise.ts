import {
  buildFallbackSurprisePrompt,
  generateSurprisePrompt,
} from '../lib/surprisePromptEngine.js';
import {
  applyCorsHeaders,
  checkRateLimit,
  getAllowedCorsOrigins,
  isAuthorizedRequest,
  readJsonBody,
  sendJson,
  toErrorMessage,
  type EnvSource,
  type VercelLikeRequest,
  type VercelLikeResponse,
} from './_common.js';

const ENV_SOURCE: EnvSource = {};
const allowedCorsOrigins = getAllowedCorsOrigins(ENV_SOURCE);

const parseContext = (value: unknown): string | undefined => {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const context = (value as { context?: unknown }).context;
  if (typeof context !== 'string') {
    return undefined;
  }

  const trimmed = context.trim();
  return trimmed || undefined;
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
    keyPrefix: 'surprise',
    maxRequestsEnvKey: 'SURPRISE_RATE_LIMIT_MAX_REQUESTS',
    windowMsEnvKey: 'SURPRISE_RATE_LIMIT_WINDOW_MS',
    defaultMaxRequests: 20,
    defaultWindowMs: 60_000,
  });
  res.setHeader('X-RateLimit-Limit', String(rateLimit.limit));
  res.setHeader('X-RateLimit-Remaining', String(rateLimit.remaining));
  res.setHeader('Retry-After', String(rateLimit.retryAfterSeconds));
  if (!rateLimit.allowed) {
    sendJson(res, 429, { error: 'Rate limit exceeded. Please retry later.' });
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method Not Allowed. Use POST.' });
    return;
  }

  let body: unknown = {};
  try {
    body = await readJsonBody(req, { maxBytes: 20_000 });
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body.' });
    return;
  }

  try {
    const prompt = await generateSurprisePrompt({
      envSource: ENV_SOURCE,
      context: parseContext(body),
    });

    sendJson(res, 200, {
      prompt,
      source: 'ai',
    });
  } catch (error) {
    const context = parseContext(body);
    sendJson(res, 200, {
      prompt: buildFallbackSurprisePrompt(context),
      source: 'fallback',
      warning: toErrorMessage(error),
    });
  }
}
