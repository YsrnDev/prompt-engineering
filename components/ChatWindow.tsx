import React, { useEffect, useRef, useState } from 'react';
import { Message } from '../types';

interface ChatWindowProps {
  messages: Message[];
}

const fallbackCopyToClipboard = (text: string): boolean => {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '0';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';

  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  let didCopy = false;
  try {
    didCopy = document.execCommand('copy');
  } catch {
    didCopy = false;
  }

  document.body.removeChild(textarea);
  return didCopy;
};

const ChatWindow: React.FC<ChatWindowProps> = ({ messages }) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyFailedId, setCopyFailedId] = useState<string | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const latestAssistantMessageId = (() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role === 'assistant' && messages[index].content) {
        return messages[index].id;
      }
    }

    return null;
  })();

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const copyTextToClipboard = async (text: string): Promise<boolean> => {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        return fallbackCopyToClipboard(text);
      }
    }

    return fallbackCopyToClipboard(text);
  };

  const handleCopy = async (text: string, messageId: string) => {
    const didCopy = await copyTextToClipboard(text);

    if (didCopy) {
      setCopiedId(messageId);
      setCopyFailedId(null);
    } else {
      setCopiedId(null);
      setCopyFailedId(messageId);
    }

    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = window.setTimeout(() => {
      setCopiedId(null);
      setCopyFailedId(null);
    }, 1500);
  };

  return (
    <div className="animate-in space-y-5 fade-in duration-500 sm:space-y-6 md:space-y-8">
      {messages.map((message) => {
        const isUser = message.role === 'user';
        const isCopied = copiedId === message.id;
        const isCopyFailed = copyFailedId === message.id;
        const showBottomCopyButton =
          !isUser &&
          Boolean(message.content) &&
          latestAssistantMessageId === message.id;

        return (
          <div
            key={message.id}
            className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`flex w-full max-w-full gap-2 sm:max-w-[95%] sm:gap-3 lg:max-w-[88%] xl:max-w-[80%] ${
                isUser ? 'flex-row-reverse' : 'flex-row'
              }`}
            >
              <div
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold sm:h-8 sm:w-8 sm:text-sm md:h-9 md:w-9 ${
                  isUser
                    ? 'bg-neutral-700 text-white'
                    : 'border border-amber-500/20 bg-amber-500/10 text-amber-300 shadow-lg shadow-amber-500/5'
                }`}
              >
                {isUser ? 'U' : 'A'}
              </div>

              <div
                className={`group relative space-y-2 rounded-2xl border p-3 sm:p-4 md:p-5 ${
                  isUser
                    ? 'border-neutral-700 bg-neutral-900 text-neutral-100'
                    : 'border-neutral-800 bg-black/50 text-neutral-100'
                }`}
              >
                <div
                  className={`prose prose-invert max-w-none break-words whitespace-pre-wrap text-sm leading-relaxed text-neutral-100 sm:text-[15px] md:text-base ${
                    !isUser && message.content ? 'pr-10 sm:pr-11 md:pr-12' : ''
                  }`}
                >
                  {message.content || (
                    <div className="flex gap-1 py-1.5" aria-label="Assistant is typing">
                      <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-amber-500 [animation-delay:-0.3s]"></div>
                      <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-amber-500 [animation-delay:-0.15s]"></div>
                      <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-amber-500"></div>
                    </div>
                  )}
                </div>

                {!isUser && message.content && (
                  <button
                    type="button"
                    onClick={() => void handleCopy(message.content, message.id)}
                    className="absolute right-2 top-2 z-20 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-700 bg-neutral-900 text-neutral-200 opacity-100 transition-opacity transition-colors hover:bg-neutral-800 hover:text-amber-300 sm:right-3 sm:top-3 md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100"
                    title="Copy to clipboard"
                    aria-label="Copy assistant response"
                    style={{ touchAction: 'manipulation' }}
                  >
                    {isCopied ? (
                      <svg
                        className="h-4 w-4 text-emerald-300"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    ) : isCopyFailed ? (
                      <svg
                        className="h-4 w-4 text-red-300"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    ) : (
                      <svg
                        className="h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
                        />
                      </svg>
                    )}
                  </button>
                )}

                {showBottomCopyButton && (
                  <div className="absolute right-2 bottom-2 z-20 flex items-center sm:right-3 sm:bottom-3">
                    <button
                      type="button"
                      onClick={() => void handleCopy(message.content, message.id)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-700 bg-neutral-900 text-neutral-100 opacity-100 transition-opacity transition-colors hover:bg-neutral-800 hover:text-amber-300 md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100"
                      title="Copy prompt"
                      aria-label="Copy prompt"
                    >
                      {isCopied ? (
                        <svg
                          className="h-4 w-4 text-emerald-300"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                      ) : isCopyFailed ? (
                        <svg
                          className="h-4 w-4 text-red-300"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M6 18L18 6M6 6l12 12"
                          />
                        </svg>
                      ) : (
                        <svg
                          className="h-4 w-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
                          />
                        </svg>
                      )}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default ChatWindow;
