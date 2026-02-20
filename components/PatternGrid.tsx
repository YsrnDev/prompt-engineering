import React from 'react';
import { PromptPattern } from '../types';

interface PatternGridProps {
  patterns: PromptPattern[];
  onSelect: (pattern: PromptPattern) => void;
  compact?: boolean;
}

const PatternGrid: React.FC<PatternGridProps> = ({
  patterns,
  onSelect,
  compact = false,
}) => {
  if (compact) {
    return (
      <div className="flex w-full max-w-5xl flex-wrap justify-center gap-1.5 sm:gap-2">
        {patterns.map((pattern) => (
          <button
            key={pattern.id}
            onClick={() => onSelect(pattern)}
            className="group inline-flex w-auto max-w-full items-center gap-2 rounded-lg border border-neutral-700 bg-neutral-900/35 px-2.5 py-1.5 text-left transition-all duration-200 hover:border-amber-500/40 hover:bg-neutral-900/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 sm:px-3 sm:py-2"
            aria-label={`Use ${pattern.name}`}
          >
            <span className="text-base leading-none transition-transform duration-200 group-hover:scale-105">
              {pattern.icon}
            </span>
            <span className="whitespace-nowrap text-[11px] font-semibold text-neutral-100 transition-colors group-hover:text-amber-300 sm:text-xs">
              {pattern.name}
            </span>
          </button>
        ))}
      </div>
    );
  }

  const gridClass =
    'grid w-full max-w-5xl grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3 2xl:max-w-6xl';

  const cardClass =
    'group relative rounded-2xl border border-neutral-700 bg-neutral-900/40 p-4 text-left transition-all duration-300 hover:border-amber-500/40 hover:bg-neutral-900/60 hover:shadow-[0_0_30px_rgba(245,158,11,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 sm:p-5 xl:p-6';

  const iconClass =
    'mb-3 text-2xl transition-transform duration-300 group-hover:scale-110 group-hover:drop-shadow-[0_0_10px_rgba(245,158,11,0.5)] sm:mb-4 sm:text-3xl';

  const titleClass =
    'mb-2 text-base font-semibold text-neutral-100 transition-colors group-hover:text-amber-300 sm:text-lg';

  const descriptionClass = 'text-sm leading-relaxed text-neutral-300';

  const ctaClass =
    'mt-4 flex translate-y-0 items-center text-xs font-bold text-amber-300 opacity-100 transition-all md:translate-y-2 md:opacity-0 md:group-hover:translate-y-0 md:group-hover:opacity-100';

  return (
    <div className={gridClass}>
      {patterns.map((pattern) => (
        <button
          key={pattern.id}
          onClick={() => onSelect(pattern)}
          className={cardClass}
          aria-label={`Use ${pattern.name}`}
        >
          <div className={iconClass}>{pattern.icon}</div>
          <h3 className={titleClass}>{pattern.name}</h3>
          <p className={descriptionClass}>
            {pattern.description}
          </p>
          <div className={ctaClass}>
            Load Template
            <svg
              className="ml-2 h-3 w-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={3}
                d="M17 8l4 4m0 0l-4 4m4-4H3"
              />
            </svg>
          </div>
        </button>
      ))}
    </div>
  );
};

export default PatternGrid;
