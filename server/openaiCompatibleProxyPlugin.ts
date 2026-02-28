import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect, Plugin } from 'vite';
import {
  parseGenerateRequestPayload,
  trimMessagesForContext,
} from '../lib/chatShared.js';
import { generatePromptArtifact } from '../lib/promptGenerationEngine.js';
import { splitIntoStreamChunks } from '../lib/promptStability.js';
import {
  buildFallbackSurprisePrompt,
  generateSurprisePrompt,
} from '../lib/surprisePromptEngine.js';
import {
  createSkillsIntegration,
  SKILLS_STATUS_ROUTE,
} from './skillsIntegration.js';

const GENERATE_ROUTE = '/api/generate';
const SURPRISE_ROUTE = '/api/surprise';
const DEFAULT_ALLOWED_CORS_ORIGINS = ['https://prompt-arcgent.vercel.app'];
const DEFAULT_MAX_BODY_BYTES = 1_000_000;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 30;

type EnvSource = Record<string, string | undefined>;

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

class RequestBodyTooLargeError extends Error {
  readonly statusCode: number;

  constructor(message: string = 'Request body is too large.') {
    super(message);
    this.name = 'RequestBodyTooLargeError';
    this.statusCode = 413;
  }
}

const rateLimitStore = new Map<string, RateLimitEntry>();

const toErrorMessage = (value: unknown): string => {
  if (value instanceof Error && value.message.trim()) {
    return value.message;
  }

  return 'Request failed while generating content.';
};

const readEnvValue = (envSource: EnvSource, key: string): string | undefined => {
  const rawValue = envSource[key] ?? process.env[key];
  if (typeof rawValue !== 'string') {
    return undefined;
  }

  const trimmed = rawValue.trim();
  return trimmed || undefined;
};

const isTruthy = (value: string | undefined): boolean => {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
};

const readPositiveIntegerEnv = (
  envSource: EnvSource,
  key: string,
  fallback: number,
  minValue: number = 1
): number => {
  const raw = readEnvValue(envSource, key);
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < minValue) {
    return fallback;
  }

  return parsed;
};

const sendJson = (
  res: ServerResponse,
  statusCode: number,
  payload: Record<string, unknown>
): void => {
  if (res.writableEnded) {
    return;
  }

  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
};

const appendVaryHeader = (res: ServerResponse, headerName: string): void => {
  const existing = res.getHeader('Vary');
  if (typeof existing === 'string') {
    const existingValues = existing
      .split(',')
      .map((item) => item.trim().toLowerCase());
    if (!existingValues.includes(headerName.toLowerCase())) {
      res.setHeader('Vary', `${existing}, ${headerName}`);
    }
    return;
  }

  res.setHeader('Vary', headerName);
};

const getAllowedCorsOrigins = (envSource: EnvSource): Set<string> => {
  const allowed = new Set(DEFAULT_ALLOWED_CORS_ORIGINS);
  const rawExtraOrigins = readEnvValue(envSource, 'CORS_ALLOWED_ORIGINS');

  if (!rawExtraOrigins) {
    return allowed;
  }

  for (const value of rawExtraOrigins.split(',')) {
    const origin = value.trim();
    if (origin) {
      allowed.add(origin);
    }
  }

  return allowed;
};

const applyCorsHeaders = (
  req: IncomingMessage,
  res: ServerResponse,
  allowedOrigins: Set<string>
): void => {
  const origin = req.headers.origin;
  if (!origin || !allowedOrigins.has(origin)) {
    return;
  }

  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Proxy-Auth'
  );
  res.setHeader('Access-Control-Max-Age', '86400');
  appendVaryHeader(res, 'Origin');
};

const sendNdjson = (res: ServerResponse, payload: Record<string, unknown>) => {
  if (!res.writableEnded) {
    res.write(`${JSON.stringify(payload)}\n`);
  }
};

const setStreamHeaders = (res: ServerResponse): void => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
};

const ensureBodySize = (rawBody: string, maxBytes: number): void => {
  const bytes = Buffer.byteLength(rawBody, 'utf8');
  if (bytes > maxBytes) {
    throw new RequestBodyTooLargeError(
      `Request body exceeds ${maxBytes} bytes limit.`
    );
  }
};

const readBody = async (
  req: IncomingMessage,
  maxBytes: number = DEFAULT_MAX_BODY_BYTES
): Promise<string> => {
  const contentLengthHeader = req.headers['content-length'];
  const contentLengthRaw = Array.isArray(contentLengthHeader)
    ? contentLengthHeader[0]
    : contentLengthHeader;
  if (contentLengthRaw) {
    const contentLength = Number.parseInt(contentLengthRaw, 10);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new RequestBodyTooLargeError(
        `Request body exceeds ${maxBytes} bytes limit.`
      );
    }
  }

  let data = '';
  let receivedBytes = 0;
  for await (const chunk of req) {
    const chunkAsBuffer = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk as string);
    receivedBytes += chunkAsBuffer.length;
    if (receivedBytes > maxBytes) {
      throw new RequestBodyTooLargeError(
        `Request body exceeds ${maxBytes} bytes limit.`
      );
    }

    data += chunkAsBuffer.toString('utf8');
  }

  ensureBodySize(data, maxBytes);
  return data;
};

const readHeaderValue = (
  req: IncomingMessage,
  key: string
): string | undefined => {
  const raw = req.headers[key.toLowerCase()];
  if (Array.isArray(raw)) {
    return raw[0];
  }

  return typeof raw === 'string' ? raw : undefined;
};

const extractBearerToken = (authorizationHeader?: string): string | null => {
  if (!authorizationHeader) {
    return null;
  }

  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return null;
  }

  const token = match[1].trim();
  return token || null;
};

const isAuthorizedRequest = (
  req: IncomingMessage,
  envSource: EnvSource
): boolean => {
  const expectedToken = readEnvValue(envSource, 'API_PROXY_AUTH_TOKEN');
  if (!expectedToken) {
    return true;
  }

  const proxyAuthHeader = readHeaderValue(req, 'x-proxy-auth')?.trim();
  if (proxyAuthHeader && proxyAuthHeader === expectedToken) {
    return true;
  }

  const bearerToken = extractBearerToken(readHeaderValue(req, 'authorization'));
  return bearerToken === expectedToken;
};

const getClientIp = (req: IncomingMessage): string => {
  const forwarded = readHeaderValue(req, 'x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) {
      return first;
    }
  }

  const realIp = readHeaderValue(req, 'x-real-ip');
  if (realIp?.trim()) {
    return realIp.trim();
  }

  return req.socket.remoteAddress || 'unknown';
};

const cleanupRateLimitStore = (now: number): void => {
  if (rateLimitStore.size < 2048) {
    return;
  }

  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetAt <= now) {
      rateLimitStore.delete(key);
    }
  }
};

const checkRateLimit = (
  req: IncomingMessage,
  envSource: EnvSource,
  options: {
    keyPrefix: string;
    maxRequestsEnvKey?: string;
    windowMsEnvKey?: string;
    defaultMaxRequests?: number;
    defaultWindowMs?: number;
  }
): {
  allowed: boolean;
  retryAfterSeconds: number;
  limit: number;
  remaining: number;
} => {
  const limit = readPositiveIntegerEnv(
    envSource,
    options.maxRequestsEnvKey || 'RATE_LIMIT_MAX_REQUESTS',
    options.defaultMaxRequests || DEFAULT_RATE_LIMIT_MAX_REQUESTS
  );
  const windowMs = readPositiveIntegerEnv(
    envSource,
    options.windowMsEnvKey || 'RATE_LIMIT_WINDOW_MS',
    options.defaultWindowMs || DEFAULT_RATE_LIMIT_WINDOW_MS
  );

  const now = Date.now();
  cleanupRateLimitStore(now);

  const clientIp = getClientIp(req);
  const key = `${options.keyPrefix}:${clientIp}`;
  const current = rateLimitStore.get(key);

  if (!current || current.resetAt <= now) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return {
      allowed: true,
      retryAfterSeconds: Math.ceil(windowMs / 1000),
      limit,
      remaining: Math.max(limit - 1, 0),
    };
  }

  if (current.count >= limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(Math.ceil((current.resetAt - now) / 1000), 1),
      limit,
      remaining: 0,
    };
  }

  current.count += 1;
  return {
    allowed: true,
    retryAfterSeconds: Math.max(Math.ceil((current.resetAt - now) / 1000), 1),
    limit,
    remaining: Math.max(limit - current.count, 0),
  };
};

const handleGenerate = async (
  skillsIntegration: ReturnType<typeof createSkillsIntegration>,
  envSource: EnvSource,
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> => {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method Not Allowed. Use POST.' });
    return;
  }

  let body: unknown;
  try {
    const rawBody = await readBody(
      req,
      readPositiveIntegerEnv(
        envSource,
        'GENERATE_MAX_BODY_BYTES',
        DEFAULT_MAX_BODY_BYTES
      )
    );
    body = rawBody ? JSON.parse(rawBody) : {};
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
      envSource,
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

const registerGenerateMiddleware = (
  middlewares: Connect.Server,
  skillsIntegration: ReturnType<typeof createSkillsIntegration>,
  envSource: EnvSource
): void => {
  const allowedCorsOrigins = getAllowedCorsOrigins(envSource);

  middlewares.use(GENERATE_ROUTE, (req, res) => {
    applyCorsHeaders(req, res, allowedCorsOrigins);

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (!isAuthorizedRequest(req, envSource)) {
      sendJson(res, 401, { error: 'Unauthorized request.' });
      return;
    }

    const rateLimit = checkRateLimit(req, envSource, {
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
      sendJson(res, 429, { error: 'Rate limit exceeded. Please retry later.' });
      return;
    }

    void handleGenerate(skillsIntegration, envSource, req, res).catch((error) => {
      if (!res.headersSent) {
        sendJson(res, 500, { error: toErrorMessage(error) });
        return;
      }

      sendNdjson(res, { type: 'error', message: toErrorMessage(error) });
      res.end();
    });
  });
};

const parseSurpriseContext = (value: unknown): string | undefined => {
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

const registerSurpriseMiddleware = (
  middlewares: Connect.Server,
  envSource: EnvSource
): void => {
  const allowedCorsOrigins = getAllowedCorsOrigins(envSource);

  middlewares.use(SURPRISE_ROUTE, (req, res) => {
    applyCorsHeaders(req, res, allowedCorsOrigins);

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (!isAuthorizedRequest(req, envSource)) {
      sendJson(res, 401, { error: 'Unauthorized request.' });
      return;
    }

    const rateLimit = checkRateLimit(req, envSource, {
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

    void (async () => {
      let body: unknown = {};
      try {
        const rawBody = await readBody(req, 20_000);
        body = rawBody ? JSON.parse(rawBody) : {};
      } catch {
        sendJson(res, 400, { error: 'Invalid JSON body.' });
        return;
      }

      try {
        const prompt = await generateSurprisePrompt({
          envSource,
          context: parseSurpriseContext(body),
        });
        sendJson(res, 200, { prompt, source: 'ai' });
      } catch (error) {
        const context = parseSurpriseContext(body);
        sendJson(res, 200, {
          prompt: buildFallbackSurprisePrompt(context),
          source: 'fallback',
          warning: toErrorMessage(error),
        });
      }
    })();
  });
};

const registerSkillsStatusMiddleware = (
  middlewares: Connect.Server,
  skillsIntegration: ReturnType<typeof createSkillsIntegration>,
  envSource: EnvSource
): void => {
  const allowedCorsOrigins = getAllowedCorsOrigins(envSource);
  const includeDetails = isTruthy(
    readEnvValue(envSource, 'SKILLS_STATUS_INCLUDE_DETAILS')
  );

  middlewares.use(SKILLS_STATUS_ROUTE, (req, res) => {
    applyCorsHeaders(req, res, allowedCorsOrigins);

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (!isAuthorizedRequest(req, envSource)) {
      sendJson(res, 401, { error: 'Unauthorized request.' });
      return;
    }

    const rateLimit = checkRateLimit(req, envSource, {
      keyPrefix: 'skills-status',
      maxRequestsEnvKey: 'SKILLS_STATUS_RATE_LIMIT_MAX_REQUESTS',
      windowMsEnvKey: 'SKILLS_STATUS_RATE_LIMIT_WINDOW_MS',
      defaultMaxRequests: 60,
      defaultWindowMs: 60_000,
    });
    res.setHeader('X-RateLimit-Limit', String(rateLimit.limit));
    res.setHeader('X-RateLimit-Remaining', String(rateLimit.remaining));
    res.setHeader('Retry-After', String(rateLimit.retryAfterSeconds));
    if (!rateLimit.allowed) {
      sendJson(res, 429, { error: 'Rate limit exceeded. Please retry later.' });
      return;
    }

    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'Method Not Allowed. Use GET.' });
      return;
    }

    void skillsIntegration
      .getStatus()
      .then((status) => {
        const sanitizedStatus = {
          enabled: status.enabled,
          skills: status.skills.map((skill) => {
            const sanitized: {
              id: string;
              name: string;
              loaded: boolean;
              bytes: number;
              updatedAt: string;
              source?: string;
              error?: string;
            } = {
              id: skill.id,
              name: skill.name,
              loaded: skill.loaded,
              bytes: skill.bytes,
              updatedAt: skill.updatedAt,
            };

            if (includeDetails) {
              if (skill.source) {
                sanitized.source = skill.source;
              }
              if (skill.error) {
                sanitized.error = skill.error;
              }
            }

            return sanitized;
          }),
        };
        sendJson(res, 200, sanitizedStatus);
      })
      .catch((error) => {
        sendJson(res, 500, { error: toErrorMessage(error) });
      });
  });
};

export const openAICompatibleProxyPlugin = (
  envSource: EnvSource = {}
): Plugin => ({
  name: 'openai-compatible-proxy-plugin',
  configureServer(server) {
    const skillsIntegration = createSkillsIntegration(envSource);
    registerGenerateMiddleware(server.middlewares, skillsIntegration, envSource);
    registerSurpriseMiddleware(server.middlewares, envSource);
    registerSkillsStatusMiddleware(server.middlewares, skillsIntegration, envSource);
  },
  configurePreviewServer(server) {
    const skillsIntegration = createSkillsIntegration(envSource);
    registerGenerateMiddleware(server.middlewares, skillsIntegration, envSource);
    registerSurpriseMiddleware(server.middlewares, envSource);
    registerSkillsStatusMiddleware(server.middlewares, skillsIntegration, envSource);
  },
});
