import React from 'react';

interface SidebarProps {
  isOpen: boolean;
}

const Sidebar: React.FC<SidebarProps> = ({ isOpen }) => {
  return (
    <aside
      className={`${isOpen ? 'w-72 xl:w-80 border-r' : 'w-0 border-r-0'} hidden shrink-0 flex-col overflow-hidden border-neutral-800 bg-black transition-all duration-300 lg:flex`}
    >
      <div className="min-w-[18rem] p-6 xl:min-w-[20rem]">
        <div className="flex items-center gap-3 whitespace-nowrap">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500 font-bold text-black shadow-lg shadow-amber-500/20">
            P
          </div>
          <span className="text-lg font-bold tracking-tight text-white">Architect AI</span>
        </div>
      </div>

      <nav className="min-w-[18rem] flex-1 space-y-8 overflow-y-auto px-4 py-2 xl:min-w-[20rem]">
        <div>
          <h3 className="mb-4 px-3 text-xs font-semibold uppercase tracking-wider text-neutral-400">
            Resources
          </h3>
          <div className="space-y-1">
            <a
              href="https://platform.openai.com/docs/overview"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-neutral-300 transition-all hover:bg-neutral-900 hover:text-amber-300"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              API Docs
            </a>
            <a
              href="https://platform.openai.com/docs/guides/prompt-engineering"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-neutral-300 transition-all hover:bg-neutral-900 hover:text-amber-300"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              Prompting Guide
            </a>
          </div>
        </div>
      </nav>

      <div className="min-w-[18rem] border-t border-neutral-800 p-4 xl:min-w-[20rem]">
        <div className="flex items-center gap-3 rounded-xl border border-neutral-700 bg-neutral-900/70 p-3">
          <img
            src="https://picsum.photos/40/40?grayscale"
            className="h-10 w-10 rounded-full border border-neutral-600"
            alt="User avatar"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-white">Senior Engineer</p>
            <p className="truncate text-xs font-semibold uppercase tracking-tighter text-amber-300">
              Elite Member
            </p>
          </div>
          <button
            className="text-neutral-300 hover:text-amber-300"
            aria-label="Open account settings"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
