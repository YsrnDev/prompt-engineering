import type { Message } from '../types.js';

export interface OpenAICompatibleMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type OpenAICompatibleStreamEvent =
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

const parseTextContent = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    const texts = value
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
      .filter(Boolean);

    return texts.join('');
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

export const toOpenAICompatibleMessages = (
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

export const consumeSseEvents = (
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

export const parseOpenAICompatibleSseEvent = (
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
