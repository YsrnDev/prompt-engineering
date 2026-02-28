import type { Message } from '../types.js';
import type {
  PromptGenerationMode,
  PromptStabilityProfile,
  TargetAgent,
} from '../types.js';

export type StreamEvent =
  | { type: 'chunk'; text: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

export interface StreamAssistantResponseOptions {
  messages: Message[];
  mode?: PromptGenerationMode;
  targetAgent?: TargetAgent;
  stabilityProfile?: PromptStabilityProfile;
  signal?: AbortSignal;
  onChunk: (text: string) => void;
}

interface SurprisePromptPayload {
  prompt: string;
  source?: 'ai' | 'fallback';
}

const DEFAULT_ERROR_MESSAGE = 'Request failed. Please try again.';
const TYPEWRITER_DIRECT_CHUNK_THRESHOLD = 90;
const TYPEWRITER_MIN_DURATION_MS = 260;
const TYPEWRITER_MAX_DURATION_MS = 1_200;
const TYPEWRITER_MIN_DELAY_MS = 10;
const TYPEWRITER_MAX_DELAY_MS = 36;

const toErrorMessage = (value: unknown): string => {
  if (value instanceof Error && value.message.trim()) {
    return value.message;
  }

  if (typeof value === 'string' && value.trim()) {
    return value;
  }

  return DEFAULT_ERROR_MESSAGE;
};

const createAbortError = (): Error => {
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
};

const waitWithAbort = async (
  ms: number,
  signal?: AbortSignal
): Promise<void> => {
  if (ms <= 0) {
    return;
  }

  if (signal?.aborted) {
    throw createAbortError();
  }

  await new Promise<void>((resolve, reject) => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const onAbort = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      signal?.removeEventListener('abort', onAbort);
      reject(createAbortError());
    };

    timeoutId = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    signal?.addEventListener('abort', onAbort, { once: true });
  });
};

const splitChunkForTypewriter = (text: string): string[] => {
  const byWords = text.split(/(\s+)/).filter((part) => part.length > 0);
  if (byWords.length > 1) {
    return byWords;
  }

  return text.split('');
};

const emitChunkWithTypewriterEffect = async ({
  text,
  signal,
  onChunk,
}: {
  text: string;
  signal?: AbortSignal;
  onChunk: (text: string) => void;
}): Promise<void> => {
  if (!text) {
    return;
  }

  if (text.length <= TYPEWRITER_DIRECT_CHUNK_THRESHOLD) {
    onChunk(text);
    return;
  }

  const segments = splitChunkForTypewriter(text);
  if (segments.length <= 1) {
    onChunk(text);
    return;
  }

  const estimatedDurationMs = Math.round(text.length * 1.8);
  const totalDurationMs = Math.min(
    TYPEWRITER_MAX_DURATION_MS,
    Math.max(TYPEWRITER_MIN_DURATION_MS, estimatedDurationMs)
  );
  const delayMs = Math.min(
    TYPEWRITER_MAX_DELAY_MS,
    Math.max(TYPEWRITER_MIN_DELAY_MS, Math.round(totalDurationMs / segments.length))
  );

  for (let index = 0; index < segments.length; index += 1) {
    if (signal?.aborted) {
      throw createAbortError();
    }

    onChunk(segments[index]);
    if (index < segments.length - 1) {
      await waitWithAbort(delayMs, signal);
    }
  }
};

const parseEvent = (line: string): StreamEvent | null => {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const payload = JSON.parse(trimmed) as Partial<StreamEvent>;
    if (payload.type === 'chunk' && typeof payload.text === 'string') {
      return { type: 'chunk', text: payload.text };
    }

    if (payload.type === 'done') {
      return { type: 'done' };
    }

    if (payload.type === 'error' && typeof payload.message === 'string') {
      return { type: 'error', message: payload.message };
    }
  } catch {
    return null;
  }

  return null;
};

export const parseNdjsonEvents = (buffer: string): StreamEvent[] => {
  const events: StreamEvent[] = [];
  const lines = buffer.split('\n');

  for (const line of lines) {
    const event = parseEvent(line);
    if (event) {
      events.push(event);
    }
  }

  return events;
};

const readErrorResponse = async (response: Response): Promise<string> => {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === 'string' && body.error.trim()) {
      return body.error;
    }
  } catch {
    // ignore and fallback to generic error below
  }

  return `Request failed with status ${response.status}.`;
};

const parseSurprisePayload = (value: unknown): SurprisePromptPayload | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<SurprisePromptPayload>;
  if (typeof candidate.prompt !== 'string') {
    return null;
  }

  const prompt = candidate.prompt.trim();
  if (!prompt) {
    return null;
  }

  return {
    prompt,
    source: candidate.source,
  };
};

export const streamAssistantResponse = async ({
  messages,
  mode,
  targetAgent,
  stabilityProfile,
  signal,
  onChunk,
}: StreamAssistantResponseOptions): Promise<void> => {
  const response = await fetch('/api/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messages, mode, targetAgent, stabilityProfile }),
    signal,
  });

  if (!response.ok) {
    throw new Error(await readErrorResponse(response));
  }

  if (!response.body) {
    throw new Error('No response stream returned by server.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lastNewline = buffer.lastIndexOf('\n');
    if (lastNewline === -1) {
      continue;
    }

    const segment = buffer.slice(0, lastNewline);
    buffer = buffer.slice(lastNewline + 1);

    for (const event of parseNdjsonEvents(segment)) {
      if (event.type === 'chunk') {
        await emitChunkWithTypewriterEffect({
          text: event.text,
          signal,
          onChunk,
        });
      }

      if (event.type === 'error') {
        throw new Error(toErrorMessage(event.message));
      }
    }
  }

  if (buffer.trim()) {
    for (const event of parseNdjsonEvents(buffer)) {
      if (event.type === 'chunk') {
        await emitChunkWithTypewriterEffect({
          text: event.text,
          signal,
          onChunk,
        });
      }

      if (event.type === 'error') {
        throw new Error(toErrorMessage(event.message));
      }
    }
  }
};

export const requestSurprisePrompt = async ({
  context,
  signal,
}: {
  context?: string;
  signal?: AbortSignal;
} = {}): Promise<SurprisePromptPayload> => {
  const response = await fetch('/api/surprise', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      context: context?.trim() || undefined,
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error(await readErrorResponse(response));
  }

  const payload = parseSurprisePayload(await response.json());
  if (!payload) {
    throw new Error('Invalid response from /api/surprise.');
  }

  return payload;
};
