import type { IncomingMessage, ServerResponse } from 'node:http';

export type EnvSource = Record<string, string | undefined>;

export type VercelLikeRequest = IncomingMessage & {
  body?: unknown;
  method?: string;
};

export type VercelLikeResponse = ServerResponse;

export const DEFAULT_ALLOWED_CORS_ORIGINS = ['https://prompt-arcgent.vercel.app'];

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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
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

export const readBody = async (req: VercelLikeRequest): Promise<string> => {
  if (typeof req.body === 'string') {
    return req.body;
  }

  if (Buffer.isBuffer(req.body)) {
    return req.body.toString('utf8');
  }

  if (req.body && typeof req.body === 'object') {
    return JSON.stringify(req.body);
  }

  let data = '';
  for await (const chunk of req) {
    data += chunk.toString();
  }

  return data;
};

export const readJsonBody = async (req: VercelLikeRequest): Promise<unknown> => {
  const rawBody = await readBody(req);
  return rawBody ? JSON.parse(rawBody) : {};
};
