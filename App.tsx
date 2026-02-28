import React, {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
} from 'react';
import {
  AppStatus,
  type PromptGenerationMode,
  type PromptPattern,
  type TargetAgent,
} from './types';
import {
  DEFAULT_PROMPT_MODE,
  DEFAULT_TARGET_AGENT,
  PROMPT_MODE_OPTIONS,
  PROMPT_PATTERNS,
  SURPRISE_PROMPTS_FREEFORM,
  SURPRISE_PROMPTS_PATTERN_FIXED,
  TARGET_AGENT_OPTIONS,
} from './constants';
import Sidebar from './components/Sidebar';
import MobileSidebar from './components/MobileSidebar';
import ChatWindow from './components/ChatWindow';
import PatternGrid from './components/PatternGrid';
import Header from './components/Header';
import { usePromptChat } from './hooks/usePromptChat.js';

type SpeechRecognitionAlternativeLike = {
  transcript: string;
};

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
};

type SpeechRecognitionResultListLike = {
  length: number;
  [index: number]: SpeechRecognitionResultLike;
};

type SpeechRecognitionEventLike = Event & {
  resultIndex: number;
  results: SpeechRecognitionResultListLike;
};

type SpeechRecognitionErrorEventLike = Event & {
  error: string;
};

type SpeechRecognitionLike = EventTarget & {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

interface HeroBackgroundProps {
  dimmed: boolean;
}

const HeroBackground: React.FC<HeroBackgroundProps> = React.memo(
  ({ dimmed }) => (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 overflow-hidden transition-opacity duration-500 ${
        dimmed ? 'opacity-70' : 'opacity-100'
      }`}
    >
      <div className="hero-ambient" />
      <div className="hero-sweep" />
      <div className="hero-shimmer" />
      <div className="hero-ripple" />
      <div className="hero-float hero-float--one" />
      <div className="hero-float hero-float--two" />
      <div className="hero-float hero-float--three" />
      <div className="hero-orbit hero-orbit--one" />
      <div className="hero-orbit hero-orbit--two" />
      <div className="hero-grid" />
      <div className="hero-grain" />
      <div className="hero-vignette" />
    </div>
  )
);

HeroBackground.displayName = 'HeroBackground';

const App: React.FC = () => {
  const { messages, status, sendMessage, cancelGeneration, dismissError } =
    usePromptChat();
  const sidebarFlagRaw = (
    import.meta.env.VITE_ENABLE_SIDEBAR as string | undefined
  )
    ?.trim()
    .toLowerCase();
  const isSidebarEnabled =
    sidebarFlagRaw === 'true' ||
    sidebarFlagRaw === '1' ||
    sidebarFlagRaw === 'yes';
  const [input, setInput] = useState('');
  const [promptMode, setPromptMode] =
    useState<PromptGenerationMode>(DEFAULT_PROMPT_MODE);
  const [targetAgent, setTargetAgent] =
    useState<TargetAgent>(DEFAULT_TARGET_AGENT);
  const [isModeMenuOpen, setIsModeMenuOpen] = useState(false);
  const [isAgentMenuOpen, setIsAgentMenuOpen] = useState(false);
  const [isDesktopSidebarOpen, setIsDesktopSidebarOpen] =
    useState(isSidebarEnabled);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const hasMessages = messages.length > 0;
  const chatEndRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const scrollbarRailRef = useRef<HTMLDivElement>(null);
  const scrollbarThumbRef = useRef<HTMLDivElement>(null);
  const scrollbarRafRef = useRef<number | null>(null);
  const scrollbarHideTimerRef = useRef<number | null>(null);
  const scrollbarFadeTimerRef = useRef<number | null>(null);
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const composerDockContainerRef = useRef<HTMLDivElement>(null);
  const scrollbarDragRef = useRef<{
    pointerId: number;
    startY: number;
    startScrollTop: number;
    scrollableDistance: number;
    maxThumbOffset: number;
  } | null>(null);
  const hasComposerInitRef = useRef(false);
  const modeMenuRef = useRef<HTMLDivElement>(null);
  const agentMenuRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const dictatedBaseRef = useRef('');
  const [isMicSupported, setIsMicSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [isScrollbarDragging, setIsScrollbarDragging] = useState(false);
  const [scrollbarVisibility, setScrollbarVisibility] = useState<
    'hidden' | 'visible' | 'fading'
  >('hidden');
  const [scrollbarBottomInset, setScrollbarBottomInset] = useState(0);

  const lastUserPrompt = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role === 'user') {
        return messages[index].content;
      }
    }

    return null;
  }, [messages]);

  const activeModeLabel = useMemo(
    () =>
      PROMPT_MODE_OPTIONS.find((option) => option.value === promptMode)?.label ??
      'Advanced',
    [promptMode]
  );

  const activeTargetAgentLabel = useMemo(
    () =>
      TARGET_AGENT_OPTIONS.find((option) => option.value === targetAgent)
        ?.label ?? 'Universal',
    [targetAgent]
  );
  const menuVerticalPositionClass = hasMessages
    ? 'bottom-[calc(100%+0.35rem)]'
    : 'top-[calc(100%+0.35rem)]';
  const scrollbarBottomOffset = hasMessages
    ? `${Math.max(scrollbarBottomInset, 0)}px`
    : '0.45rem';
  const messageAreaBottomPadding = hasMessages
    ? `${Math.max(scrollbarBottomInset - 18, 142)}px`
    : undefined;

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!hasMessages) {
      setScrollbarBottomInset(0);
      return;
    }

    const viewportElement = scrollViewportRef.current;
    const dockContainerElement = composerDockContainerRef.current;
    if (!viewportElement || !dockContainerElement) {
      return;
    }

    const syncBottomInset = () => {
      const viewportRect = viewportElement.getBoundingClientRect();
      const dockRect = dockContainerElement.getBoundingClientRect();
      const nextInset = Math.max(viewportRect.bottom - dockRect.top, 0);
      setScrollbarBottomInset((prev) =>
        Math.abs(prev - nextInset) < 0.5 ? prev : nextInset
      );
    };

    syncBottomInset();
    const resizeObserver = new ResizeObserver(syncBottomInset);
    resizeObserver.observe(viewportElement);
    resizeObserver.observe(dockContainerElement);
    window.addEventListener('resize', syncBottomInset);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', syncBottomInset);
    };
  }, [hasMessages, input, messages.length, status]);

  const clearScrollbarHideTimer = useCallback(() => {
    if (scrollbarHideTimerRef.current !== null) {
      window.clearTimeout(scrollbarHideTimerRef.current);
      scrollbarHideTimerRef.current = null;
    }
  }, []);

  const clearScrollbarFadeTimer = useCallback(() => {
    if (scrollbarFadeTimerRef.current !== null) {
      window.clearTimeout(scrollbarFadeTimerRef.current);
      scrollbarFadeTimerRef.current = null;
    }
  }, []);

  const revealScrollbar = useCallback(() => {
    clearScrollbarHideTimer();
    clearScrollbarFadeTimer();
    setScrollbarVisibility('visible');
  }, [clearScrollbarFadeTimer, clearScrollbarHideTimer]);

  const hideScrollbarSoon = useCallback(
    (delayMs = 760) => {
      clearScrollbarHideTimer();
      scrollbarHideTimerRef.current = window.setTimeout(() => {
        setScrollbarVisibility('fading');
        clearScrollbarFadeTimer();
        scrollbarFadeTimerRef.current = window.setTimeout(() => {
          setScrollbarVisibility('hidden');
          scrollbarFadeTimerRef.current = null;
        }, 600);
        scrollbarHideTimerRef.current = null;
      }, delayMs);
    },
    [clearScrollbarFadeTimer, clearScrollbarHideTimer]
  );

  const syncCustomScrollbarThumb = useCallback(() => {
    const scrollElement = scrollAreaRef.current;
    const railElement = scrollbarRailRef.current;
    const thumbElement = scrollbarThumbRef.current;
    if (!scrollElement || !railElement || !thumbElement) {
      return;
    }

    const { clientHeight, scrollHeight, scrollTop } = scrollElement;
    const scrollableDistance = scrollHeight - clientHeight;
    const railHeight = railElement.getBoundingClientRect().height;
    if (scrollableDistance <= 1 || railHeight <= 1) {
      clearScrollbarHideTimer();
      clearScrollbarFadeTimer();
      setScrollbarVisibility('hidden');
      return;
    }

    const minThumbHeight = 36;
    const thumbHeight = Math.max(
      (clientHeight / scrollHeight) * railHeight,
      minThumbHeight
    );
    const maxThumbOffset = Math.max(railHeight - thumbHeight, 0);
    const scrollProgress = Math.min(Math.max(scrollTop / scrollableDistance, 0), 1);
    const thumbOffset = maxThumbOffset * scrollProgress;

    thumbElement.style.height = `${thumbHeight}px`;
    thumbElement.style.transform = `translate3d(0, ${thumbOffset}px, 0)`;
  }, [clearScrollbarFadeTimer, clearScrollbarHideTimer]);

  const scheduleCustomScrollbarSync = useCallback(() => {
    if (scrollbarRafRef.current !== null) {
      return;
    }

    scrollbarRafRef.current = window.requestAnimationFrame(() => {
      scrollbarRafRef.current = null;
      syncCustomScrollbarThumb();
    });
  }, [syncCustomScrollbarThumb]);

  const endCustomScrollbarDrag = useCallback((pointerId?: number) => {
    const thumbElement = scrollbarThumbRef.current;
    if (
      thumbElement &&
      typeof pointerId === 'number' &&
      thumbElement.hasPointerCapture(pointerId)
    ) {
      thumbElement.releasePointerCapture(pointerId);
    }

    scrollbarDragRef.current = null;
    setIsScrollbarDragging(false);
  }, []);

  const handleScrollbarThumbPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }

      const scrollElement = scrollAreaRef.current;
      const railElement = scrollbarRailRef.current;
      const thumbElement = scrollbarThumbRef.current;
      if (!scrollElement || !railElement || !thumbElement) {
        return;
      }

      const { clientHeight, scrollHeight, scrollTop } = scrollElement;
      const scrollableDistance = scrollHeight - clientHeight;
      if (scrollableDistance <= 1) {
        return;
      }

      const railHeight = railElement.getBoundingClientRect().height;
      if (railHeight <= 1) {
        return;
      }

      const minThumbHeight = 36;
      const thumbHeight = Math.max(
        (clientHeight / scrollHeight) * railHeight,
        minThumbHeight
      );
      const maxThumbOffset = Math.max(railHeight - thumbHeight, 0);
      if (maxThumbOffset <= 0) {
        return;
      }

      thumbElement.setPointerCapture(event.pointerId);
      scrollbarDragRef.current = {
        pointerId: event.pointerId,
        startY: event.clientY,
        startScrollTop: scrollTop,
        scrollableDistance,
        maxThumbOffset,
      };
      setIsScrollbarDragging(true);
      revealScrollbar();
      event.preventDefault();
    },
    [revealScrollbar]
  );

  const handleScrollbarThumbPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = scrollbarDragRef.current;
      const scrollElement = scrollAreaRef.current;
      if (!drag || !scrollElement || drag.pointerId !== event.pointerId) {
        return;
      }

      const deltaY = event.clientY - drag.startY;
      const scrollDelta =
        (deltaY / drag.maxThumbOffset) * drag.scrollableDistance;
      const nextScrollTop = drag.startScrollTop + scrollDelta;
      scrollElement.scrollTop = Math.min(
        Math.max(nextScrollTop, 0),
        drag.scrollableDistance
      );
      scheduleCustomScrollbarSync();
      event.preventDefault();
    },
    [scheduleCustomScrollbarSync]
  );

  const handleScrollbarThumbPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (scrollbarDragRef.current?.pointerId !== event.pointerId) {
        return;
      }
      endCustomScrollbarDrag(event.pointerId);
      hideScrollbarSoon();
    },
    [endCustomScrollbarDrag, hideScrollbarSoon]
  );

  const handleScrollbarThumbPointerCancel = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (scrollbarDragRef.current?.pointerId !== event.pointerId) {
        return;
      }
      endCustomScrollbarDrag(event.pointerId);
      hideScrollbarSoon();
    },
    [endCustomScrollbarDrag, hideScrollbarSoon]
  );

  const handleScrollbarThumbLostPointerCapture = useCallback(() => {
    endCustomScrollbarDrag();
  }, [endCustomScrollbarDrag]);

  const handleScrollbarRailPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }

      const scrollElement = scrollAreaRef.current;
      const thumbElement = scrollbarThumbRef.current;
      if (!scrollElement || !thumbElement) {
        return;
      }

      if (event.target === thumbElement) {
        return;
      }

      const railRect = event.currentTarget.getBoundingClientRect();
      const thumbRect = thumbElement.getBoundingClientRect();
      const scrollableDistance = scrollElement.scrollHeight - scrollElement.clientHeight;
      if (scrollableDistance <= 1) {
        return;
      }

      const maxThumbOffset = Math.max(railRect.height - thumbRect.height, 0);
      if (maxThumbOffset <= 0) {
        return;
      }

      const clickY = event.clientY - railRect.top;
      const targetThumbTop = Math.min(
        Math.max(clickY - thumbRect.height / 2, 0),
        maxThumbOffset
      );
      scrollElement.scrollTop = (targetThumbTop / maxThumbOffset) * scrollableDistance;
      scheduleCustomScrollbarSync();
      revealScrollbar();
      hideScrollbarSoon();
      event.preventDefault();
    },
    [hideScrollbarSoon, revealScrollbar, scheduleCustomScrollbarSync]
  );

  useEffect(() => {
    const scrollElement = scrollAreaRef.current;
    if (!scrollElement) {
      return;
    }

    const handleScroll = () => {
      revealScrollbar();
      hideScrollbarSoon();
      scheduleCustomScrollbarSync();
    };

    scrollElement.addEventListener('scroll', handleScroll, { passive: true });

    const resizeObserver = new ResizeObserver(() => {
      scheduleCustomScrollbarSync();
    });
    resizeObserver.observe(scrollElement);

    const firstChild = scrollElement.firstElementChild;
    if (firstChild instanceof HTMLElement) {
      resizeObserver.observe(firstChild);
    }

    window.addEventListener('resize', scheduleCustomScrollbarSync);
    scheduleCustomScrollbarSync();

    return () => {
      scrollElement.removeEventListener('scroll', handleScroll);
      resizeObserver.disconnect();
      window.removeEventListener('resize', scheduleCustomScrollbarSync);

      if (scrollbarRafRef.current !== null) {
        window.cancelAnimationFrame(scrollbarRafRef.current);
        scrollbarRafRef.current = null;
      }

      clearScrollbarHideTimer();
      clearScrollbarFadeTimer();
      scrollbarDragRef.current = null;
    };
  }, [
    clearScrollbarFadeTimer,
    clearScrollbarHideTimer,
    hideScrollbarSoon,
    revealScrollbar,
    scheduleCustomScrollbarSync,
  ]);

  useLayoutEffect(() => {
    scheduleCustomScrollbarSync();
  }, [
    hasMessages,
    input,
    messages,
    scheduleCustomScrollbarSync,
    scrollbarBottomInset,
    status,
  ]);

  const resizeComposer = useCallback((animate: boolean) => {
    const textarea = composerRef.current;
    if (!textarea) {
      return;
    }

    const previousHeight = textarea.getBoundingClientRect().height;
    textarea.style.height = 'auto';
    const nextHeight = textarea.scrollHeight;

    if (!animate || previousHeight <= 0) {
      textarea.style.transition = 'none';
      textarea.style.height = `${nextHeight}px`;
      return;
    }

    if (Math.abs(nextHeight - previousHeight) < 1) {
      textarea.style.transition = 'none';
      textarea.style.height = `${nextHeight}px`;
      return;
    }

    textarea.style.transition = 'none';
    textarea.style.height = `${previousHeight}px`;
    void textarea.offsetHeight;
    textarea.style.transition = 'height 420ms cubic-bezier(0.22, 1, 0.36, 1)';
    textarea.style.height = `${nextHeight}px`;
  }, []);

  useLayoutEffect(() => {
    resizeComposer(hasComposerInitRef.current);
    hasComposerInitRef.current = true;
  }, [input, hasMessages, resizeComposer]);

  useEffect(() => {
    if (!isSidebarEnabled) {
      setIsMobileSidebarOpen(false);
      return;
    }

    const syncMobileDrawer = () => {
      if (window.matchMedia('(min-width: 1024px)').matches) {
        setIsMobileSidebarOpen(false);
      }
    };

    syncMobileDrawer();
    window.addEventListener('resize', syncMobileDrawer);

    return () => {
      window.removeEventListener('resize', syncMobileDrawer);
    };
  }, [isSidebarEnabled]);

  const toMicErrorMessage = useCallback((errorCode: string): string | null => {
    switch (errorCode) {
      case 'aborted':
        return null;
      case 'not-allowed':
      case 'service-not-allowed':
        return 'Izin mikrofon ditolak. Aktifkan izin mic di browser.';
      case 'audio-capture':
        return 'Perangkat mikrofon tidak terdeteksi.';
      case 'no-speech':
        return 'Tidak ada suara terdeteksi. Coba bicara lebih jelas.';
      case 'network':
        return 'Terjadi kendala jaringan saat proses voice input.';
      default:
        return 'Voice input gagal dijalankan. Coba lagi.';
    }
  }, []);

  useEffect(() => {
    const speechWindow = window as Window & {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };

    const SpeechRecognitionCtor =
      speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;

    if (!SpeechRecognitionCtor) {
      setIsMicSupported(false);
      return;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = 'id-ID';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setMicError(null);
      setIsListening(true);
    };

    recognition.onresult = (event) => {
      let finalPart = '';
      let interimPart = '';

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const transcript = event.results[i][0]?.transcript?.trim() ?? '';
        if (!transcript) {
          continue;
        }

        if (event.results[i].isFinal) {
          finalPart += `${transcript} `;
        } else {
          interimPart += `${transcript} `;
        }
      }

      setInput(() => {
        const normalizedFinalPart = finalPart.trim();
        if (normalizedFinalPart) {
          dictatedBaseRef.current = `${dictatedBaseRef.current} ${normalizedFinalPart}`
            .trim()
            .replace(/\s+/g, ' ');
        }

        const normalizedInterimPart = interimPart.trim();
        if (!normalizedInterimPart) {
          return dictatedBaseRef.current;
        }

        return `${dictatedBaseRef.current} ${normalizedInterimPart}`
          .trim()
          .replace(/\s+/g, ' ');
      });
    };

    recognition.onerror = (event) => {
      const message = toMicErrorMessage(event.error);
      if (message) {
        setMicError(message);
      }
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    setIsMicSupported(true);

    return () => {
      recognition.abort();
      recognitionRef.current = null;
    };
  }, [toMicErrorMessage]);

  useEffect(() => {
    const closeMenusOnOutsideClick = (event: PointerEvent) => {
      if (!isModeMenuOpen && !isAgentMenuOpen) {
        return;
      }

      const target = event.target as Node | null;
      if (!target) {
        return;
      }

      if (modeMenuRef.current && !modeMenuRef.current.contains(target)) {
        setIsModeMenuOpen(false);
      }

      if (agentMenuRef.current && !agentMenuRef.current.contains(target)) {
        setIsAgentMenuOpen(false);
      }
    };

    document.addEventListener('pointerdown', closeMenusOnOutsideClick);

    return () => {
      document.removeEventListener('pointerdown', closeMenusOnOutsideClick);
    };
  }, [isModeMenuOpen, isAgentMenuOpen]);

  const handleToggleNavigation = useCallback(() => {
    if (!isSidebarEnabled) {
      return;
    }

    if (window.matchMedia('(min-width: 1024px)').matches) {
      setIsDesktopSidebarOpen((prev) => !prev);
      return;
    }

    setIsMobileSidebarOpen((prev) => !prev);
  }, [isSidebarEnabled]);

  const handleToggleMicrophone = useCallback(() => {
    if (status === AppStatus.GENERATING) {
      return;
    }

    if (!isMicSupported || !recognitionRef.current) {
      setMicError(
        'Browser ini belum mendukung voice input. Pakai Chrome/Edge terbaru.'
      );
      return;
    }

    if (isListening) {
      recognitionRef.current.stop();
      return;
    }

    dictatedBaseRef.current = input.trim().replace(/\s+/g, ' ');
    setMicError(null);

    try {
      recognitionRef.current.start();
    } catch {
      setMicError(
        'Voice input sedang digunakan. Hentikan dulu lalu coba lagi.'
      );
      setIsListening(false);
    }
  }, [input, isListening, isMicSupported, status]);

  const handleSendMessage = useCallback(async () => {
    if (isListening) {
      recognitionRef.current?.stop();
    }

    const didSend = await sendMessage(input, promptMode, targetAgent);
    if (didSend) {
      setInput('');
      setMicError(null);
      setIsModeMenuOpen(false);
      setIsAgentMenuOpen(false);
      setIsMobileSidebarOpen(false);
      composerRef.current?.focus();
    }
  }, [input, isListening, promptMode, targetAgent, sendMessage]);

  const handleCancelGeneration = useCallback(() => {
    if (isListening) {
      recognitionRef.current?.stop();
    }

    const restoredPrompt = cancelGeneration();
    if (restoredPrompt) {
      setInput(restoredPrompt);
    }

    setIsModeMenuOpen(false);
    setIsAgentMenuOpen(false);
    composerRef.current?.focus();
  }, [cancelGeneration, isListening]);

  const handleRetryLastPrompt = useCallback(async () => {
    if (!lastUserPrompt) {
      return;
    }

    const didSend = await sendMessage(lastUserPrompt, promptMode, targetAgent);
    if (didSend) {
      setIsMobileSidebarOpen(false);
    }
  }, [lastUserPrompt, promptMode, targetAgent, sendMessage]);

  const applyPattern = (pattern: PromptPattern) => {
    if (isListening) {
      recognitionRef.current?.stop();
    }

    setInput((prev) =>
      prev ? `${prev}\n\n${pattern.template}` : pattern.template
    );
    setMicError(null);
    setIsMobileSidebarOpen(false);
    composerRef.current?.focus();
  };

  const handleSurpriseMe = useCallback(() => {
    const surprisePool = [
      ...SURPRISE_PROMPTS_PATTERN_FIXED,
      ...SURPRISE_PROMPTS_FREEFORM,
    ];

    if (!surprisePool.length) {
      return;
    }

    if (isListening) {
      recognitionRef.current?.stop();
    }

    const randomPrompt =
      surprisePool[Math.floor(Math.random() * surprisePool.length)];

    setInput(randomPrompt);
    setMicError(null);
    setIsModeMenuOpen(false);
    setIsAgentMenuOpen(false);
    setIsMobileSidebarOpen(false);
    composerRef.current?.focus();
  }, [isListening]);

  const canGenerate =
    input.trim().length > 0 && status !== AppStatus.GENERATING;

  const composerElement = (
    <div className="relative">
      <div className="relative rounded-2xl border border-neutral-700 bg-neutral-900 p-1.5 transition-all duration-300 ease-in-out sm:p-2">
        {status === AppStatus.GENERATING && (
          <button
            type="button"
            onClick={handleCancelGeneration}
            className="absolute top-2 right-2 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full border border-red-400/45 bg-red-500/10 text-red-200 hover:bg-red-500/20"
            aria-label="Batalkan generate prompt"
            title="Batalkan"
          >
            <span
              className="pointer-events-none absolute inset-[2px] rounded-full border border-red-300/40 border-t-red-100/90 animate-spin"
              aria-hidden="true"
            />
            <svg
              className="relative h-3.5 w-3.5"
              fill="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <rect x="6.5" y="6.5" width="11" height="11" rx="1.35" />
            </svg>
          </button>
        )}
        <textarea
          ref={composerRef}
          value={input}
          onChange={(e) => {
            const nextValue = e.target.value;
            setInput(nextValue);

            if (isListening) {
              dictatedBaseRef.current = nextValue.trim().replace(/\s+/g, ' ');
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleSendMessage();
            }
          }}
          placeholder="Describe your goal or paste a draft prompt..."
          aria-label="Prompt input"
          className={`w-full resize-none overflow-hidden border-none bg-transparent px-3 py-2.5 text-base text-zinc-100 placeholder-zinc-400 caret-amber-300 selection:bg-amber-500/20 selection:text-zinc-100 focus:outline-none focus:ring-0 focus-visible:outline-none sm:px-4 sm:py-3 ${
            hasMessages
              ? 'min-h-[48px] sm:min-h-[56px]'
              : 'min-h-[64px] sm:min-h-[72px]'
          } ${status === AppStatus.GENERATING ? 'pr-11 sm:pr-12' : ''}`}
          rows={1}
        />
        <div className="mt-1 flex w-full items-center justify-between gap-2 pr-1 max-[360px]:gap-1.5 max-[360px]:pr-0">
          <div className="flex min-w-0 flex-nowrap items-center gap-2 max-[360px]:gap-1">
          <div ref={agentMenuRef} className="relative shrink-0">
            <button
              type="button"
              aria-label="Target agent"
              aria-haspopup="listbox"
              aria-expanded={isAgentMenuOpen}
              onClick={() => {
                setIsAgentMenuOpen((prev) => !prev);
                setIsModeMenuOpen(false);
              }}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-neutral-700 bg-neutral-950/70 px-2 py-1 text-[10px] font-medium text-neutral-300 max-[360px]:gap-1 max-[360px]:px-1.5 max-[360px]:text-[9px]"
            >
              <span className="text-neutral-400">Target</span>
              <span className="text-amber-300 max-[360px]:text-[9px]">{activeTargetAgentLabel}</span>
              <svg
                className={`h-3 w-3 text-neutral-400 transition-transform ${
                  isAgentMenuOpen ? 'rotate-180' : ''
                }`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>

            {isAgentMenuOpen && (
              <div
                role="listbox"
                aria-label="Target agent options"
                className={`absolute right-0 z-30 w-44 overflow-hidden rounded-xl border border-neutral-700 bg-neutral-900 shadow-lg shadow-black/40 ${menuVerticalPositionClass}`}
              >
                {TARGET_AGENT_OPTIONS.map((option) => {
                  const isSelected = option.value === targetAgent;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => {
                        setTargetAgent(option.value);
                        setIsAgentMenuOpen(false);
                      }}
                      className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs transition-colors ${
                        isSelected
                          ? 'bg-amber-500/20 text-amber-300'
                          : 'text-zinc-200 hover:bg-neutral-800'
                      }`}
                    >
                      <span>{option.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div ref={modeMenuRef} className="relative shrink-0">
            <button
              type="button"
              aria-label="Prompt generation mode"
              aria-haspopup="listbox"
              aria-expanded={isModeMenuOpen}
              onClick={() => {
                setIsModeMenuOpen((prev) => !prev);
                setIsAgentMenuOpen(false);
              }}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-neutral-700 bg-neutral-950/70 px-2 py-1 text-[10px] font-medium text-neutral-300 max-[360px]:gap-1 max-[360px]:px-1.5 max-[360px]:text-[9px]"
            >
              <span className="text-neutral-400">Mode</span>
              <span className="text-amber-300 max-[360px]:text-[9px]">{activeModeLabel}</span>
              <svg
                className={`h-3 w-3 text-neutral-400 transition-transform ${
                  isModeMenuOpen ? 'rotate-180' : ''
                }`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>

            {isModeMenuOpen && (
              <div
                role="listbox"
                aria-label="Prompt generation mode options"
                className={`absolute right-0 z-30 w-36 overflow-hidden rounded-xl border border-neutral-700 bg-neutral-900 shadow-lg shadow-black/40 ${menuVerticalPositionClass}`}
              >
                {PROMPT_MODE_OPTIONS.map((option) => {
                  const isSelected = option.value === promptMode;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => {
                        setPromptMode(option.value);
                        setIsModeMenuOpen(false);
                      }}
                      className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs transition-colors ${
                        isSelected
                          ? 'bg-amber-500/20 text-amber-300'
                          : 'text-zinc-200 hover:bg-neutral-800'
                      }`}
                    >
                      <span>{option.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          </div>
          <div className="flex shrink-0 items-center gap-1.5 max-[360px]:gap-1">
            <button
              type="button"
              aria-label="Surprise me"
              disabled={status === AppStatus.GENERATING}
              onClick={handleSurpriseMe}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-neutral-700 bg-neutral-950/70 text-neutral-300 transition-colors hover:border-amber-400/60 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-50 max-[360px]:h-9 max-[360px]:w-9 sm:h-8 sm:w-8 md:h-7 md:w-7"
              title="Surprise me"
            >
              <svg
                className="h-4 w-4 max-[360px]:h-3.5 max-[360px]:w-3.5 md:h-3.5 md:w-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 3l1.5 3.5L14 8l-3.5 1.5L9 13l-1.5-3.5L4 8l3.5-1.5L9 3zm8 8l1 2.2L20 14l-2 0.8L17 17l-1-2.2L14 14l2-0.8L17 11zM6 15l0.9 2L9 18l-2.1 0.9L6 21l-0.9-2.1L3 18l2.1-1L6 15z"
                />
              </svg>
            </button>

            <button
              type="button"
              aria-label={isListening ? 'Stop microphone input' : 'Start microphone input'}
              aria-pressed={isListening}
              disabled={!isMicSupported || status === AppStatus.GENERATING}
              onClick={handleToggleMicrophone}
              className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition-colors max-[360px]:h-9 max-[360px]:w-9 sm:h-8 sm:w-8 md:h-7 md:w-7 ${
                isListening
                  ? 'border-red-500/60 bg-red-500/10 text-red-200 hover:bg-red-500/20'
                  : 'border-neutral-700 bg-neutral-950/70 text-neutral-300 hover:border-neutral-600 hover:text-neutral-100'
              } disabled:cursor-not-allowed disabled:opacity-50`}
              title={
                isMicSupported
                  ? isListening
                    ? 'Stop voice input'
                    : 'Start voice input'
                  : 'Voice input tidak didukung browser ini'
              }
            >
              <svg
                className="h-4 w-4 max-[360px]:h-3.5 max-[360px]:w-3.5 md:h-3.5 md:w-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 3a3 3 0 00-3 3v6a3 3 0 106 0V6a3 3 0 00-3-3zm-7 9a7 7 0 0014 0m-7 7v2m-4 0h8"
                />
              </svg>
            </button>

            <button
              type="button"
              aria-label="Generate prompt"
              disabled={!canGenerate}
              onClick={() => {
                void handleSendMessage();
              }}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-amber-500/45 bg-amber-500/15 text-amber-200 transition-colors hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-50 max-[360px]:h-9 max-[360px]:w-9 sm:h-8 sm:w-8 md:h-7 md:w-7"
              title="Generate"
            >
              <svg
                className="h-4 w-4 max-[360px]:h-3.5 max-[360px]:w-3.5 md:h-3.5 md:w-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 12h12m0 0-4-4m4 4-4 4"
                />
              </svg>
            </button>
          </div>
        </div>

        {micError && (
          <p className="mt-2 px-2 text-left text-[11px] text-red-300 sm:text-right">
            {micError}
          </p>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-[100svh] min-h-[100svh] w-full overflow-hidden bg-black text-zinc-100">
      {isSidebarEnabled && <Sidebar isOpen={isDesktopSidebarOpen} />}

      {isSidebarEnabled && (
        <MobileSidebar
          isOpen={isMobileSidebarOpen}
          onClose={() => setIsMobileSidebarOpen(false)}
        />
      )}

      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-black">
        <HeroBackground dimmed={hasMessages} />

        <Header
          status={status}
          showNavigationToggle={isSidebarEnabled}
          onToggleNavigation={handleToggleNavigation}
          isDesktopSidebarOpen={isDesktopSidebarOpen}
          isMobileMenuOpen={isMobileSidebarOpen}
        />

        <div ref={scrollViewportRef} className="relative z-10 min-h-0 flex-1">
          <div
            ref={scrollAreaRef}
            className={`app-scroll-area h-full overflow-y-auto px-2.5 sm:px-4 md:px-8 xl:px-10 2xl:px-14 ${
              hasMessages
                ? 'pt-3 sm:pt-4 md:pt-5'
                : 'pt-3 pb-5 sm:pt-5 sm:pb-6 md:pt-6'
            }`}
            style={hasMessages ? { paddingBottom: messageAreaBottomPadding } : undefined}
          >
            {hasMessages ? (
              <div className="mx-auto w-full max-w-5xl space-y-6 sm:space-y-8 2xl:max-w-6xl">
                <ChatWindow messages={messages} />
                <div ref={chatEndRef} />
              </div>
            ) : (
              <div className="mx-auto flex h-full w-full max-w-5xl flex-col items-center justify-center gap-4 py-4 sm:gap-6 sm:py-6 md:py-8 2xl:max-w-6xl">
                <div className="w-full max-w-3xl text-center">
                  <h1 className="mb-1.5 bg-gradient-to-r from-amber-100 via-amber-300 to-yellow-500 bg-clip-text text-3xl font-bold leading-tight text-transparent sm:mb-2 sm:text-4xl md:text-4xl lg:text-5xl">
                    Prompt Engineering Workspace
                  </h1>
                  <p className="text-xs leading-relaxed text-zinc-300 sm:text-sm md:text-base">
                    Turn simple ideas into high-impact prompts with stronger
                    structure, constraints, and output clarity.
                  </p>
                </div>

                <div className="w-full max-w-3xl">{composerElement}</div>

                <div className="w-full max-w-5xl">
                  <PatternGrid
                    patterns={PROMPT_PATTERNS}
                    onSelect={applyPattern}
                    compact
                  />
                </div>
              </div>
            )}
          </div>
          {hasMessages && (
            <div
              aria-hidden="true"
              ref={scrollbarRailRef}
              className="app-scrollbar-rail pointer-events-auto absolute right-0 z-20"
              onPointerDown={handleScrollbarRailPointerDown}
              style={{ top: '0.45rem', bottom: scrollbarBottomOffset }}
            >
              <div
                ref={scrollbarThumbRef}
                className={`app-scrollbar-thumb ${scrollbarVisibility === 'visible' ? 'app-scrollbar-thumb--visible' : ''} ${scrollbarVisibility === 'fading' ? 'app-scrollbar-thumb--fading' : ''} ${isScrollbarDragging ? 'app-scrollbar-thumb--dragging' : ''}`}
                onPointerDown={handleScrollbarThumbPointerDown}
                onPointerMove={handleScrollbarThumbPointerMove}
                onPointerUp={handleScrollbarThumbPointerUp}
                onPointerCancel={handleScrollbarThumbPointerCancel}
                onLostPointerCapture={handleScrollbarThumbLostPointerCapture}
              />
            </div>
          )}
        </div>

        {hasMessages && (
          <div
            ref={composerDockContainerRef}
            className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black via-black/95 to-black/60 px-3 pt-1.5 shadow-[0_-20px_48px_rgba(0,0,0,0.55)] sm:px-4 sm:pt-2 md:px-8 xl:px-10 2xl:px-14"
            style={{ paddingBottom: 'max(1.1rem, env(safe-area-inset-bottom))' }}
          >
            <div className="mx-auto w-full max-w-5xl 2xl:max-w-6xl">
              {status === AppStatus.ERROR && lastUserPrompt && (
                <div className="mb-3 flex flex-col gap-3 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-red-100">
                    Generation failed. You can retry your last prompt.
                  </p>
                  <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                    <button
                      type="button"
                      onClick={() => void handleRetryLastPrompt()}
                      className="w-full rounded-lg border border-red-300/50 px-3 py-2 text-sm font-medium text-red-100 transition-colors hover:bg-red-500/20 sm:w-auto"
                    >
                      Retry Last Prompt
                    </button>
                    <button
                      type="button"
                      onClick={dismissError}
                      className="w-full rounded-lg border border-neutral-600 px-3 py-2 text-sm font-medium text-neutral-200 transition-colors hover:bg-neutral-800 sm:w-auto"
                    >
                      Batal
                    </button>
                  </div>
                </div>
              )}

              {composerElement}
            </div>

          </div>
        )}
      </main>
    </div>
  );
};

export default App;
