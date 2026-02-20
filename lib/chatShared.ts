import type {
  Message,
  PromptGenerationMode,
  TargetAgent,
} from '../types.js';

export interface GenerateRequestPayload {
  messages: Message[];
  mode?: PromptGenerationMode;
  targetAgent?: TargetAgent;
}

export const MAX_CONTEXT_MESSAGES = 20;
export const MAX_STORED_MESSAGES = 80;

export const trimMessagesForContext = (
  messages: Message[],
  limit: number = MAX_CONTEXT_MESSAGES
): Message[] => {
  if (messages.length <= limit) {
    return messages;
  }

  return messages.slice(-limit);
};

export const capStoredMessages = (
  messages: Message[],
  limit: number = MAX_STORED_MESSAGES
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

export const parseGenerateRequestPayload = (
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
