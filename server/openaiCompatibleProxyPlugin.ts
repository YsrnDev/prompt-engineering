import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect, Plugin } from 'vite';
import {
  buildPromptGeneratorInstruction,
  DEFAULT_TARGET_AGENT,
  DEFAULT_PROMPT_MODE,
} from '../constants.js';
import {
  parseGenerateRequestPayload,
  trimMessagesForContext,
} from '../lib/chatShared.js';
import {
  consumeSseEvents,
  parseOpenAICompatibleSseEvent,
  toOpenAICompatibleMessages,
} from '../lib/openaiCompatible.js';
import {
  createSkillsIntegration,
  SKILLS_STATUS_ROUTE,
} from './skillsIntegration.js';

const GENERATE_ROUTE = '/api/generate';
const DEFAULT_OPENAI_COMPATIBLE_MODEL = 'gpt-4o-mini';

type EnvSource = Record<string, string | undefined>;

interface OpenAICompatibleConfig {
  apiKey?: string;
  model: string;
  url: string;
}

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

const readBody = async (req: IncomingMessage): Promise<string> => {
  let data = '';
  for await (const chunk of req) {
    data += chunk.toString();
  }

  return data;
};

const getOpenAICompatibleConfig = (
  envSource: EnvSource
): OpenAICompatibleConfig => {
  const directUrl = readEnvValue(envSource, 'OPENAI_COMPATIBLE_URL');
  const baseUrl = readEnvValue(envSource, 'OPENAI_COMPATIBLE_BASE_URL');

  if (!directUrl && !baseUrl) {
    throw new Error(
      'Missing OPENAI_COMPATIBLE_URL or OPENAI_COMPATIBLE_BASE_URL.'
    );
  }

  const normalizedBase = baseUrl?.replace(/\/+$/, '');
  const url =
    directUrl ||
    (normalizedBase?.endsWith('/v1/chat/completions')
      ? normalizedBase
      : `${normalizedBase}/v1/chat/completions`);

  const apiKey =
    readEnvValue(envSource, 'OPENAI_COMPATIBLE_API_KEY') ||
    readEnvValue(envSource, 'OPENAI_API_KEY');

  return {
    apiKey,
    model:
      readEnvValue(envSource, 'OPENAI_COMPATIBLE_MODEL') ||
      readEnvValue(envSource, 'OPENAI_MODEL') ||
      DEFAULT_OPENAI_COMPATIBLE_MODEL,
    url,
  };
};

const readErrorResponse = async (response: Response): Promise<string> => {
  try {
    const payload = (await response.json()) as {
      error?: { message?: unknown } | string;
      message?: unknown;
    };

    if (typeof payload.error === 'string' && payload.error.trim()) {
      return payload.error;
    }

    if (
      payload.error &&
      typeof payload.error === 'object' &&
      typeof payload.error.message === 'string' &&
      payload.error.message.trim()
    ) {
      return payload.error.message;
    }

    if (typeof payload.message === 'string' && payload.message.trim()) {
      return payload.message;
    }
  } catch {
    // Fall through to generic message.
  }

  return `Request failed with status ${response.status}.`;
};

const streamFromOpenAICompatible = async (
  envSource: EnvSource,
  contextMessages: ReturnType<typeof trimMessagesForContext>,
  systemInstruction: string,
  res: ServerResponse
): Promise<void> => {
  const config = getOpenAICompatibleConfig(envSource);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };

  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }

  const response = await fetch(config.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: config.model,
      stream: true,
      temperature: 0.7,
      messages: toOpenAICompatibleMessages(
        contextMessages,
        systemInstruction
      ),
    }),
  });

  if (!response.ok) {
    throw new Error(await readErrorResponse(response));
  }

  if (!response.body) {
    throw new Error('No response stream returned by OpenAI-compatible provider.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let doneSent = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    buffer = buffer.replace(/\r\n/g, '\n');

    const consumed = consumeSseEvents(buffer);
    buffer = consumed.rest;

    for (const rawEvent of consumed.events) {
      const parsed = parseOpenAICompatibleSseEvent(rawEvent);
      if (!parsed) {
        continue;
      }

      if (parsed.type === 'chunk') {
        sendNdjson(res, { type: 'chunk', text: parsed.text });
        continue;
      }

      if (parsed.type === 'error') {
        throw new Error(parsed.message);
      }

      if (parsed.type === 'done') {
        doneSent = true;
      }
    }
  }

  if (!doneSent && buffer.trim()) {
    const parsed = parseOpenAICompatibleSseEvent(buffer.trim());
    if (parsed?.type === 'chunk') {
      sendNdjson(res, { type: 'chunk', text: parsed.text });
    }

    if (parsed?.type === 'error') {
      throw new Error(parsed.message);
    }
  }

  sendNdjson(res, { type: 'done' });
  res.end();
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
    const rawBody = await readBody(req);
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body.' });
    return;
  }

  const payload = parseGenerateRequestPayload(body);
  if (!payload || payload.messages.length === 0) {
    sendJson(res, 400, { error: 'Invalid payload. Expected { messages: [] }.' });
    return;
  }

  const contextMessages = trimMessagesForContext(payload.messages);
  const mode = payload.mode ?? DEFAULT_PROMPT_MODE;
  const targetAgent = payload.targetAgent ?? DEFAULT_TARGET_AGENT;
  const skillInstruction =
    (await skillsIntegration.buildInstructionForRequest(contextMessages)) || '';
  const systemInstruction = [
    buildPromptGeneratorInstruction(mode, targetAgent),
    skillInstruction,
  ]
    .filter(Boolean)
    .join('\n\n');
  setStreamHeaders(res);

  try {
    await streamFromOpenAICompatible(
      envSource,
      contextMessages,
      systemInstruction,
      res
    );
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
  middlewares.use(GENERATE_ROUTE, (req, res) => {
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

const registerSkillsStatusMiddleware = (
  middlewares: Connect.Server,
  skillsIntegration: ReturnType<typeof createSkillsIntegration>
): void => {
  middlewares.use(SKILLS_STATUS_ROUTE, (req, res) => {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'Method Not Allowed. Use GET.' });
      return;
    }

    void skillsIntegration
      .getStatus()
      .then((status) => {
        sendJson(res, 200, status);
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
    registerSkillsStatusMiddleware(server.middlewares, skillsIntegration);
  },
  configurePreviewServer(server) {
    const skillsIntegration = createSkillsIntegration(envSource);
    registerGenerateMiddleware(server.middlewares, skillsIntegration, envSource);
    registerSkillsStatusMiddleware(server.middlewares, skillsIntegration);
  },
});
