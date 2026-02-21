import type { IncomingMessage, ServerResponse } from 'node:http';

export type EnvSource = Record<string, string | undefined>;

export type VercelLikeRequest = IncomingMessage & {
  body?: unknown;
  method?: string;
};

export type VercelLikeResponse = ServerResponse;

export const DEFAULT_ALLOWED_CORS_ORIGINS = ['https://prompt-arcgent.vercel.app'];
const DEFAULT_MAX_BODY_BYTES = 1_000_000;
const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 30;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export interface RateLimitCheckOptions {
  keyPrefix: string;
  maxRequestsEnvKey?: string;
  windowMsEnvKey?: string;
  defaultMaxRequests?: number;
  defaultWindowMs?: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

export const toErrorMessage = (value: unknown): string => {
  if (value instanceof Error && value.message.trim()) {
    return value.message;
  }

  return 'Request failed while generating content.';
};

export const readEnvValue = (
  envSource: EnvSource,
  key: string
): string | undefined => {
  const rawValue = envSource[key] ?? process.env[key];
  if (typeof rawValue !== 'string') {
    return undefined;
  }

  const trimmed = rawValue.trim();
  return trimmed || undefined;
};

export const isTruthy = (value: string | undefined): boolean => {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
};

export const readPositiveIntegerEnv = (
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

export const sendJson = (
  res: VercelLikeResponse,
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

const appendVaryHeader = (res: VercelLikeResponse, headerName: string): void => {
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

  if (Array.isArray(existing)) {
    const serialized = existing.join(', ');
    const existingValues = serialized
      .split(',')
      .map((item) => item.trim().toLowerCase());
    if (!existingValues.includes(headerName.toLowerCase())) {
      res.setHeader('Vary', `${serialized}, ${headerName}`);
    }
    return;
  }

  res.setHeader('Vary', headerName);
};

export const getAllowedCorsOrigins = (envSource: EnvSource): Set<string> => {
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

export const applyCorsHeaders = (
  req: VercelLikeRequest,
  res: VercelLikeResponse,
  allowedOrigins: Set<string>
): void => {
  const originHeader = req.headers.origin;
  const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;

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

export const sendNdjson = (
  res: VercelLikeResponse,
  payload: Record<string, unknown>
): void => {
  if (!res.writableEnded) {
    res.write(`${JSON.stringify(payload)}\n`);
  }
};

export const setStreamHeaders = (res: VercelLikeResponse): void => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
};

export class RequestBodyTooLargeError extends Error {
  readonly statusCode: number;

  constructor(message: string = 'Request body is too large.') {
    super(message);
    this.name = 'RequestBodyTooLargeError';
    this.statusCode = 413;
  }
}

interface ReadBodyOptions {
  maxBytes?: number;
}

const ensureBodySize = (rawBody: string, maxBytes: number): void => {
  const bytes = Buffer.byteLength(rawBody, 'utf8');
  if (bytes > maxBytes) {
    throw new RequestBodyTooLargeError(
      `Request body exceeds ${maxBytes} bytes limit.`
    );
  }
};

export const readBody = async (
  req: VercelLikeRequest,
  options: ReadBodyOptions = {}
): Promise<string> => {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BODY_BYTES;

  if (typeof req.body === 'string') {
    ensureBodySize(req.body, maxBytes);
    return req.body;
  }

  if (Buffer.isBuffer(req.body)) {
    const raw = req.body.toString('utf8');
    ensureBodySize(raw, maxBytes);
    return raw;
  }

  if (req.body && typeof req.body === 'object') {
    const raw = JSON.stringify(req.body);
    ensureBodySize(raw, maxBytes);
    return raw;
  }

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

  return data;
};

export const readJsonBody = async (
  req: VercelLikeRequest,
  options: ReadBodyOptions = {}
): Promise<unknown> => {
  const rawBody = await readBody(req, options);
  return rawBody ? JSON.parse(rawBody) : {};
};

const readHeaderValue = (
  req: VercelLikeRequest,
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

export const isAuthorizedRequest = (
  req: VercelLikeRequest,
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

const getClientIp = (req: VercelLikeRequest): string => {
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

export const checkRateLimit = (
  req: VercelLikeRequest,
  envSource: EnvSource,
  options: RateLimitCheckOptions
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
