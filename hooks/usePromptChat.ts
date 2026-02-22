import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppStatus,
  type Message,
  type PromptGenerationMode,
  type PromptStabilityProfile,
  type TargetAgent,
} from '../types.js';
import {
  capStoredMessages,
  trimMessagesForContext,
} from '../lib/chatShared.js';
import { streamAssistantResponse } from '../services/chatApi.js';

interface UsePromptChatResult {
  messages: Message[];
  status: AppStatus;
  sendMessage: (
    content: string,
    mode?: PromptGenerationMode,
    targetAgent?: TargetAgent,
    stabilityProfile?: PromptStabilityProfile
  ) => Promise<boolean>;
  cancelGeneration: () => string | null;
  dismissError: () => void;
}

const toErrorMessage = (value: unknown): string => {
  if (value instanceof Error && value.message.trim()) {
    return value.message;
  }

  return 'I encountered an error while generating. Please try again.';
};

const createMessageId = (): string =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const usePromptChat = (): UsePromptChatResult => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const messagesRef = useRef<Message[]>([]);
  const activeRequestRef = useRef<AbortController | null>(null);
  const activeGenerationRef = useRef<{
    userId: string;
    assistantId: string;
    userContent: string;
  } | null>(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(
    () => () => {
      activeRequestRef.current?.abort();
    },
    []
  );

  const cancelGeneration = useCallback((): string | null => {
    const current = activeGenerationRef.current;
    if (!current) {
      return null;
    }

    activeRequestRef.current?.abort();
    return current.userContent;
  }, []);

  const dismissError = useCallback(() => {
    setStatus((prev) => (prev === AppStatus.ERROR ? AppStatus.IDLE : prev));
  }, []);

  const sendMessage = useCallback(
    async (
      rawContent: string,
      mode: PromptGenerationMode = 'advanced',
      targetAgent: TargetAgent = 'universal',
      stabilityProfile?: PromptStabilityProfile
    ): Promise<boolean> => {
      const content = rawContent.trim();
      if (!content || status === AppStatus.GENERATING) {
        return false;
      }

      const userMessage: Message = {
        id: createMessageId(),
        role: 'user',
        content,
      };
      const assistantId = createMessageId();
      activeGenerationRef.current = {
        userId: userMessage.id,
        assistantId,
        userContent: content,
      };

      const contextMessages = trimMessagesForContext([
        ...messagesRef.current,
        userMessage,
      ]);

      setMessages((prev) =>
        capStoredMessages([
          ...prev,
          userMessage,
          { id: assistantId, role: 'assistant', content: '' },
        ])
      );
      setStatus(AppStatus.GENERATING);

      const controller = new AbortController();
      activeRequestRef.current = controller;
      let fullContent = '';

      try {
        await streamAssistantResponse({
          messages: contextMessages,
          mode,
          targetAgent,
          stabilityProfile,
          signal: controller.signal,
          onChunk: (chunk) => {
            fullContent += chunk;
            setMessages((prev) =>
              capStoredMessages(
                prev.map((message) =>
                  message.id === assistantId
                    ? { ...message, content: fullContent }
                    : message
                )
              )
            );
          },
        });

        setStatus(AppStatus.IDLE);
        activeGenerationRef.current = null;
        return true;
      } catch (error) {
        if (controller.signal.aborted) {
          const active = activeGenerationRef.current;
          setStatus(AppStatus.IDLE);
          if (active) {
            setMessages((prev) =>
              capStoredMessages(
                prev.filter(
                  (entry) =>
                    entry.id !== active.userId && entry.id !== active.assistantId
                )
              )
            );
          }
          activeGenerationRef.current = null;
          return false;
        }

        const message = toErrorMessage(error);
        setStatus(AppStatus.ERROR);
        setMessages((prev) =>
          capStoredMessages(
            prev.map((entry) =>
              entry.id === assistantId
                ? {
                    ...entry,
                    content: message,
                  }
                : entry
            )
          )
        );
        activeGenerationRef.current = null;
        return false;
      } finally {
        if (activeRequestRef.current === controller) {
          activeRequestRef.current = null;
        }
      }
    },
    [status]
  );

  return { messages, status, sendMessage, cancelGeneration, dismissError };
};
