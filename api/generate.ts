import type { Message } from '../types.js';
import { createSkillsIntegration } from '../server/skillsIntegration.js';
import {
  applyCorsHeaders,
  checkRateLimit,
  getAllowedCorsOrigins,
  isAuthorizedRequest,
  readPositiveIntegerEnv,
  readEnvValue,
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

type PromptGenerationMode = 'simple' | 'advanced' | 'expert';
type TargetAgent = 'universal' | 'gemini' | 'claude-code' | 'kiro' | 'kimi';

const DEFAULT_PROMPT_MODE: PromptGenerationMode = 'advanced';
const DEFAULT_TARGET_AGENT: TargetAgent = 'universal';
const DEFAULT_OPENAI_COMPATIBLE_MODEL = 'gpt-4o-mini';
const DEFAULT_OPENAI_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_BODY_BYTES = 1_000_000;
const MAX_CONTEXT_MESSAGES = 20;

const SYSTEM_INSTRUCTION = `You are "Prompt Architect AI", a world-class senior Prompt Engineer and LLM Optimization expert.
Your goal is to help users create, refine, and perfect their prompts using advanced patterns.

RESPONSE GUIDELINES:
- Be professional, insightful, and technical.
- Return copy-paste ready prompts.
- Use markdown with clear sections.`;

interface GenerateRequestPayload {
  messages: Message[];
  mode?: PromptGenerationMode;
  targetAgent?: TargetAgent;
}

interface OpenAICompatibleConfig {
  apiKey?: string;
  model: string;
  url: string;
}

interface OpenAICompatibleMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

type OpenAICompatibleStreamEvent =
  | { type: 'chunk'; text: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

interface OpenAICompatibleChunk {
  choices?: Array<{
    delta?: { content?: unknown };
    message?: { content?: unknown };
    finish_reason?: string | null;
  }>;
  error?: unknown;
}

const ENV_SOURCE: EnvSource = {};
const skillsIntegration = createSkillsIntegration(ENV_SOURCE);
const allowedCorsOrigins = getAllowedCorsOrigins(ENV_SOURCE);

const trimMessagesForContext = (
  messages: Message[],
  limit: number = MAX_CONTEXT_MESSAGES
): Message[] => {
  if (messages.length <= limit) {
    return messages;
  }

  return messages.slice(-limit);
};

const isPromptGenerationMode = (
  value: unknown
): value is PromptGenerationMode =>
  value === 'simple' || value === 'advanced' || value === 'expert';

const isTargetAgent = (value: unknown): value is TargetAgent =>
  value === 'universal' ||
  value === 'gemini' ||
  value === 'claude-code' ||
  value === 'kiro' ||
  value === 'kimi';

const isMessage = (value: unknown): value is Message => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<Message>;
  return (
    (candidate.role === 'user' || candidate.role === 'assistant') &&
    typeof candidate.id === 'string' &&
    typeof candidate.content === 'string'
  );
};

const parseGenerateRequestPayload = (
  value: unknown
): GenerateRequestPayload | null => {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const payload = value as Partial<GenerateRequestPayload>;
  if (!Array.isArray(payload.messages)) {
    return null;
  }

  if (!payload.messages.every(isMessage)) {
    return null;
  }

  if (payload.mode !== undefined && !isPromptGenerationMode(payload.mode)) {
    return null;
  }

  if (payload.targetAgent !== undefined && !isTargetAgent(payload.targetAgent)) {
    return null;
  }

  const normalized: GenerateRequestPayload = { messages: payload.messages };
  if (payload.mode) {
    normalized.mode = payload.mode;
  }
  if (payload.targetAgent) {
    normalized.targetAgent = payload.targetAgent;
  }
  return normalized;
};

const MODE_INSTRUCTION_SUFFIX: Record<PromptGenerationMode, string> = {
  simple: `MODE: SIMPLE
- Produce concise, practical prompts for quick use.`,
  advanced: `MODE: ADVANCED
- Produce balanced prompts with structure + rationale.`,
  expert: `MODE: EXPERT
- Produce highly optimized prompts with strict constraints and evaluation criteria.`,
};

const TARGET_AGENT_ADAPTER: Record<TargetAgent, string> = {
  universal: `TARGET: UNIVERSAL
- Keep syntax provider-neutral and portable.`,
  gemini: `TARGET: GEMINI
- Use concise and explicit task boundaries.`,
  'claude-code': `TARGET: CLAUDE CODE
- Prioritize implementation realism and deterministic constraints.`,
  kiro: `TARGET: KIRO
- Use workflow-first directives with staged outputs.`,
  kimi: `TARGET: KIMI
- Favor high-context reasoning with clear output checkpoints.`,
};

const buildPromptGeneratorInstruction = (
  mode: PromptGenerationMode,
  targetAgent: TargetAgent
): string =>
  [
    SYSTEM_INSTRUCTION,
    MODE_INSTRUCTION_SUFFIX[mode],
    TARGET_AGENT_ADAPTER[targetAgent],
    'TASK: Convert the user request into one production-ready prompt artifact for another AI agent.',
    'OUTPUT: Include Final Prompt block + short optimization notes.',
  ].join('\n\n');

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

const parseTextContent = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === 'string') {
          return entry;
        }
        if (entry && typeof entry === 'object') {
          const maybeText = (entry as { text?: unknown }).text;
          if (typeof maybeText === 'string') {
            return maybeText;
          }
        }
        return '';
      })
      .filter(Boolean)
      .join('');
  }

  return '';
};

const parseErrorMessage = (value: unknown): string | null => {
  if (typeof value === 'string' && value.trim()) {
    return value;
  }
  if (value && typeof value === 'object') {
    const maybeMessage = (value as { message?: unknown }).message;
    if (typeof maybeMessage === 'string' && maybeMessage.trim()) {
      return maybeMessage;
    }
  }
  return null;
};

const toOpenAICompatibleMessages = (
  messages: Message[],
  systemInstruction: string
): OpenAICompatibleMessage[] => {
  const mappedMessages: OpenAICompatibleMessage[] = [
    { role: 'system', content: systemInstruction },
  ];

  for (const message of messages) {
    mappedMessages.push({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: message.content,
    });
  }

  return mappedMessages;
};

const consumeSseEvents = (
  chunkBuffer: string
): { events: string[]; rest: string } => {
  const events: string[] = [];
  let startIndex = 0;

  while (true) {
    const delimiterIndex = chunkBuffer.indexOf('\n\n', startIndex);
    if (delimiterIndex === -1) {
      break;
    }

    const event = chunkBuffer.slice(startIndex, delimiterIndex).trim();
    if (event) {
      events.push(event);
    }

    startIndex = delimiterIndex + 2;
  }

  return {
    events,
    rest: chunkBuffer.slice(startIndex),
  };
};

const parseOpenAICompatibleSseEvent = (
  rawEvent: string
): OpenAICompatibleStreamEvent | null => {
  const dataLines = rawEvent
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart());

  if (dataLines.length === 0) {
    return null;
  }

  const payload = dataLines.join('\n');
  if (payload === '[DONE]') {
    return { type: 'done' };
  }

  let parsed: OpenAICompatibleChunk;
  try {
    parsed = JSON.parse(payload) as OpenAICompatibleChunk;
  } catch {
    return null;
  }

  const topLevelError = parseErrorMessage(parsed.error);
  if (topLevelError) {
    return { type: 'error', message: topLevelError };
  }

  const choices = parsed.choices ?? [];
  let fullText = '';
  let hasFinishedChoice = false;

  for (const choice of choices) {
    const deltaText = parseTextContent(choice.delta?.content);
    const messageText = parseTextContent(choice.message?.content);
    fullText += deltaText || messageText;

    if (choice.finish_reason) {
      hasFinishedChoice = true;
    }
  }

  if (fullText) {
    return { type: 'chunk', text: fullText };
  }

  if (hasFinishedChoice) {
    return { type: 'done' };
  }

  return null;
};

const streamFromOpenAICompatible = async (
  envSource: EnvSource,
  contextMessages: Message[],
  systemInstruction: string,
  res: VercelLikeResponse
): Promise<void> => {
  const config = getOpenAICompatibleConfig(envSource);
  const timeoutMs = readPositiveIntegerEnv(
    envSource,
    'OPENAI_COMPATIBLE_TIMEOUT_MS',
    DEFAULT_OPENAI_TIMEOUT_MS
  );

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };

  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(config.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.model,
        stream: true,
        temperature: 0.7,
        messages: toOpenAICompatibleMessages(contextMessages, systemInstruction),
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if ((error as { name?: string })?.name === 'AbortError') {
      throw new Error(`Upstream request timed out after ${timeoutMs}ms.`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }

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
      ENV_SOURCE,
      contextMessages,
      systemInstruction,
      res
    );
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
