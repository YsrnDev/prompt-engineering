import {
  consumeSseEvents,
  parseOpenAICompatibleSseEvent,
  type OpenAICompatibleMessage,
} from './openaiCompatible.js';

export interface OpenAICompatibleRequestOptions {
  url: string;
  model: string;
  apiKey?: string;
  temperature: number;
  timeoutMs: number;
  maxRetries: number;
  retryBaseDelayMs: number;
  messages: OpenAICompatibleMessage[];
}

interface ProviderRequestError extends Error {
  statusCode?: number;
  transient: boolean;
}

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const toProviderError = (
  message: string,
  options: {
    statusCode?: number;
    transient?: boolean;
  } = {}
): ProviderRequestError => {
  const error = new Error(message) as ProviderRequestError;
  error.statusCode = options.statusCode;
  error.transient = Boolean(options.transient);
  return error;
};

const isTransientStatusCode = (statusCode?: number): boolean => {
  if (!statusCode) {
    return false;
  }

  return statusCode === 408 || statusCode === 425 || statusCode === 429 || statusCode >= 500;
};

const TRANSIENT_MESSAGE_PATTERN =
  /\b(fetch failed|network|timed out|timeout|temporarily unavailable|connection reset|econnreset|socket hang up)\b/i;

const isTransientError = (error: unknown): boolean => {
  if (error && typeof error === 'object') {
    const providerError = error as Partial<ProviderRequestError>;
    if (providerError.transient) {
      return true;
    }
  }

  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '';

  return TRANSIENT_MESSAGE_PATTERN.test(message);
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
    // Ignore and fallback.
  }

  return `Request failed with status ${response.status}.`;
};

const requestOnce = async (
  options: OpenAICompatibleRequestOptions
): Promise<string> => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };

  if (options.apiKey) {
    headers.Authorization = `Bearer ${options.apiKey}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

  let response: Response;
  try {
    response = await fetch(options.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: options.model,
        stream: true,
        temperature: options.temperature,
        messages: options.messages,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if ((error as { name?: string })?.name === 'AbortError') {
      throw toProviderError(
        `Upstream request timed out after ${options.timeoutMs}ms.`,
        { transient: true }
      );
    }

    throw toProviderError(
      error instanceof Error ? error.message : 'Failed to connect to provider.',
      { transient: true }
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const message = await readErrorResponse(response);
    throw toProviderError(message, {
      statusCode: response.status,
      transient: isTransientStatusCode(response.status),
    });
  }

  if (!response.body) {
    throw toProviderError('No response stream returned by provider.', {
      transient: false,
    });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let doneSent = false;
  let fullText = '';

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
        fullText += parsed.text;
        continue;
      }

      if (parsed.type === 'error') {
        throw toProviderError(parsed.message, {
          transient: TRANSIENT_MESSAGE_PATTERN.test(parsed.message),
        });
      }

      if (parsed.type === 'done') {
        doneSent = true;
      }
    }
  }

  if (!doneSent && buffer.trim()) {
    const parsed = parseOpenAICompatibleSseEvent(buffer.trim());
    if (parsed?.type === 'chunk') {
      fullText += parsed.text;
    }

    if (parsed?.type === 'error') {
      throw toProviderError(parsed.message, {
        transient: TRANSIENT_MESSAGE_PATTERN.test(parsed.message),
      });
    }
  }

  return fullText.trim();
};

export const requestOpenAICompatibleCompletion = async (
  options: OpenAICompatibleRequestOptions
): Promise<string> => {
  const maxAttempts = Math.max(1, options.maxRetries + 1);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await requestOnce(options);
    } catch (error) {
      const isLastAttempt = attempt >= maxAttempts;
      if (isLastAttempt || !isTransientError(error)) {
        throw error;
      }

      const backoffMs = Math.min(
        options.retryBaseDelayMs * attempt,
        2000
      );
      await sleep(backoffMs);
    }
  }

  throw new Error('Provider request failed after retries.');
};
