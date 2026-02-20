import React from 'react';
import { AppStatus } from '../types';

interface HeaderProps {
  status: AppStatus;
  showNavigationToggle: boolean;
  onToggleNavigation: () => void;
  isDesktopSidebarOpen: boolean;
  isMobileMenuOpen: boolean;
}

const Header: React.FC<HeaderProps> = ({
  status,
  showNavigationToggle,
  onToggleNavigation,
  isDesktopSidebarOpen,
  isMobileMenuOpen,
}) => {
  const isGenerating = status === AppStatus.GENERATING;
  const isError = status === AppStatus.ERROR;
  const statusText = isGenerating
    ? 'Processing'
    : isError
      ? 'Needs attention'
      : 'Ready';

  const statusDotClass = isGenerating
    ? 'bg-amber-400'
    : isError
      ? 'bg-red-500'
      : 'bg-emerald-500';

  const toggleLabel = 'Toggle navigation';

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between bg-transparent px-3 py-2.5 sm:px-4 sm:py-3">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        {showNavigationToggle && (
          <button
            onClick={onToggleNavigation}
            className="shrink-0 rounded-lg border border-neutral-700 bg-neutral-900 p-2 text-neutral-200 transition-all duration-200 hover:border-neutral-500 hover:text-white"
            title={toggleLabel}
            aria-label={toggleLabel}
          >
            <svg
              className="h-5 w-5 lg:hidden"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              {isMobileMenuOpen ? (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              ) : (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6h16M4 12h16M4 18h16"
                />
              )}
            </svg>
            <svg
              className="hidden h-5 w-5 lg:block"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              {isDesktopSidebarOpen ? (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M11 19l-7-7 7-7m8 14l-7-7 7-7"
                />
              ) : (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6h16M4 12h16M4 18h16"
                />
              )}
            </svg>
          </button>
        )}

        <div className="min-w-0">
          <h2 className="truncate text-xs font-bold uppercase tracking-wide text-neutral-200 sm:text-sm">
            Prompt Architect
          </h2>
        </div>
      </div>

      <div
        className="inline-flex shrink-0 items-center p-1.5"
        aria-label={`Status: ${statusText}`}
        title={statusText}
      >
        <span
          className={`h-2.5 w-2.5 rounded-full motion-safe:animate-pulse ${statusDotClass}`}
        ></span>
      </div>
    </header>
  );
};

export default Header;
