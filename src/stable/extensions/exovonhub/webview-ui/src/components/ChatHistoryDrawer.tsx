import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatThread } from '../types';

interface ChatHistoryDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  chatThreads: ChatThread[];
  activeThreadId: string | null;
  onSelectThread: (threadId: string) => void;
  onNewChat: () => void;
  onDeleteThread: (threadId: string) => void;
  onRenameThread?: (threadId: string, newTitle: string) => void;
  onClearAllThreads?: () => void;
  onExportThread?: (threadId: string) => void;
}

type TimeGroup = 'Today' | 'Yesterday' | 'Previous 7 days' | 'Previous 30 days' | 'Older';

interface GroupedThreads {
  group: TimeGroup;
  threads: ChatThread[];
}

function formatCompactTime(timestamp: number): string {
  if (!timestamp) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'now';
  if (diffMin < 60) return `${diffMin}m`;
  if (diffHour < 24) return `${diffHour}h`;
  if (diffDay < 7) return `${diffDay}d`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function getTimeGroup(timestamp: number): TimeGroup {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayMs = 24 * 60 * 60 * 1000;

  if (timestamp >= startOfToday) return 'Today';
  if (timestamp >= startOfToday - dayMs) return 'Yesterday';
  if (timestamp >= startOfToday - 7 * dayMs) return 'Previous 7 days';
  if (timestamp >= startOfToday - 30 * dayMs) return 'Previous 30 days';
  return 'Older';
}

const GROUP_ORDER: TimeGroup[] = [
  'Today',
  'Yesterday',
  'Previous 7 days',
  'Previous 30 days',
  'Older',
];

export const ChatHistoryDrawer: React.FC<ChatHistoryDrawerProps> = (props) => {
  if (!props.isOpen) return null;
  return <ChatHistoryDrawerContent {...props} />;
};

const ChatHistoryDrawerContent: React.FC<ChatHistoryDrawerProps> = ({
  onClose,
  chatThreads,
  activeThreadId,
  onSelectThread,
  onNewChat,
  onDeleteThread,
  onRenameThread,
  onClearAllThreads,
  onExportThread,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showClearAllConfirm, setShowClearAllConfirm] = useState(false);
  const [copiedThreadId, setCopiedThreadId] = useState<string | null>(null);

  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingThreadId) {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }
  }, [editingThreadId]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (editingThreadId) setEditingThreadId(null);
      else if (confirmDeleteId) setConfirmDeleteId(null);
      else if (showClearAllConfirm) setShowClearAllConfirm(false);
      else onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editingThreadId, confirmDeleteId, showClearAllConfirm, onClose]);

  const filteredThreads = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return chatThreads;
    return chatThreads.filter(
      (t) =>
        (t.title || '').toLowerCase().includes(q) ||
        (t.preview || '').toLowerCase().includes(q),
    );
  }, [chatThreads, searchQuery]);

  const groupedThreads = useMemo<GroupedThreads[]>(() => {
    const buckets: Record<TimeGroup, ChatThread[]> = {
      Today: [],
      Yesterday: [],
      'Previous 7 days': [],
      'Previous 30 days': [],
      Older: [],
    };
    for (const thread of filteredThreads) {
      buckets[getTimeGroup(thread.updated_at)].push(thread);
    }
    return GROUP_ORDER
      .filter((group) => buckets[group].length > 0)
      .map((group) => ({ group, threads: buckets[group] }));
  }, [filteredThreads]);

  const startRename = (e: React.MouseEvent, thread: ChatThread) => {
    e.stopPropagation();
    setConfirmDeleteId(null);
    setEditingThreadId(thread.id);
    setEditTitle(thread.title || 'New Chat');
  };

  const commitRename = (threadId: string) => {
    const trimmed = editTitle.trim();
    if (trimmed && onRenameThread) {
      onRenameThread(threadId, trimmed);
    }
    setEditingThreadId(null);
  };

  const handleExport = (e: React.MouseEvent, threadId: string) => {
    e.stopPropagation();
    if (!onExportThread) return;
    onExportThread(threadId);
    setCopiedThreadId(threadId);
    setTimeout(() => setCopiedThreadId(null), 1800);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/35 transition-opacity duration-150"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Chat History"
        onClick={(e) => e.stopPropagation()}
        className="w-[296px] max-w-[88vw] h-full bg-[#141416] border-l border-white/[0.08] shadow-2xl flex flex-col select-none font-sans"
      >
        {/* Clean Header */}
        <div className="px-3.5 py-2.5 border-b border-white/[0.06] flex items-center justify-between gap-2 shrink-0">
          <h2 className="text-[13px] font-semibold text-zinc-100">Chat History</h2>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                onNewChat();
                onClose();
              }}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-zinc-200 hover:text-white bg-white/[0.07] hover:bg-white/[0.13] border border-white/10 transition-colors cursor-pointer"
              title="Start new chat"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span>New</span>
            </button>
            {chatThreads.length > 0 && onClearAllThreads && (
              <button
                type="button"
                onClick={() => setShowClearAllConfirm(true)}
                className="p-1.5 text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-md transition-colors cursor-pointer"
                title="Clear all history"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}
            <button
              type="button"
              aria-label="Close Chat History"
              onClick={onClose}
              className="p-1.5 text-zinc-400 hover:text-white hover:bg-white/[0.07] rounded-md transition-colors cursor-pointer"
              title="Close (Esc)"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Search Strip */}
        {chatThreads.length > 0 && (
          <div className="px-2.5 pt-2.5 pb-1 shrink-0">
            <div className="relative">
              <svg
                className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                autoFocus
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search history..."
                className="w-full h-8 pl-8 pr-7 bg-white/[0.04] focus:bg-white/[0.07] border border-white/[0.07] focus:border-white/20 rounded-lg text-[12px] text-zinc-100 placeholder-zinc-500 focus:outline-none transition-colors"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200 p-0.5 cursor-pointer"
                  title="Clear search"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Scannable Flat List */}
        <div className="flex-1 overflow-y-auto px-2 pb-3 pt-1 scrollbar-thin">
          {groupedThreads.map(({ group, threads }) => (
            <div key={group} className="mt-2.5 first:mt-1">
              <div className="px-2 pb-1 text-[11px] font-medium text-zinc-500">{group}</div>
              <div className="space-y-0.5">
                {threads.map((thread) => {
                  const isActive = activeThreadId === thread.id;
                  const isEditing = editingThreadId === thread.id;
                  const isConfirmingDelete = confirmDeleteId === thread.id;

                  if (isConfirmingDelete) {
                    return (
                      <div
                        key={thread.id}
                        className="px-2.5 py-1.5 rounded-lg flex items-center justify-between gap-2 bg-rose-950/40"
                      >
                        <span className="text-[12px] text-rose-200 truncate">Delete chat?</span>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              onDeleteThread(thread.id);
                              setConfirmDeleteId(null);
                            }}
                            className="px-2 py-0.5 bg-rose-600 hover:bg-rose-500 text-white rounded text-[11px] font-medium cursor-pointer"
                          >
                            Delete
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="px-2 py-0.5 text-zinc-300 hover:text-white rounded text-[11px] cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    );
                  }

                  if (isEditing) {
                    return (
                      <div key={thread.id} className="px-1.5 py-1 flex items-center gap-1">
                        <input
                          ref={editInputRef}
                          type="text"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitRename(thread.id);
                            if (e.key === 'Escape') setEditingThreadId(null);
                          }}
                          onBlur={() => commitRename(thread.id)}
                          className="flex-1 bg-white/[0.08] px-2 py-1 border border-white/20 rounded-md text-[12px] text-white focus:outline-none"
                        />
                      </div>
                    );
                  }

                  const displayTitle = thread.title || 'New Chat';
                  return (
                    <div
                      key={thread.id}
                      onClick={() => {
                        onSelectThread(thread.id);
                        onClose();
                      }}
                      title={thread.preview ? `${displayTitle}\n${thread.preview}` : displayTitle}
                      className={`group px-2.5 py-1.5 rounded-lg flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                        isActive
                          ? 'bg-white/[0.08] text-white font-medium'
                          : 'text-zinc-300 hover:text-white hover:bg-white/[0.04]'
                      }`}
                    >
                      <span className="text-[13px] truncate flex-1">{displayTitle}</span>

                      <span
                        className="text-[11px] text-zinc-500 tabular-nums shrink-0 group-hover:hidden"
                        title={new Date(thread.updated_at).toLocaleString()}
                      >
                        {formatCompactTime(thread.updated_at)}
                      </span>

                      <div
                        className="hidden group-hover:flex items-center gap-0.5 shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {onRenameThread && (
                          <button
                            type="button"
                            onClick={(e) => startRename(e, thread)}
                            className="p-1 text-zinc-400 hover:text-white rounded transition-colors cursor-pointer"
                            title="Rename"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                          </button>
                        )}
                        {onExportThread && (
                          <button
                            type="button"
                            onClick={(e) => handleExport(e, thread.id)}
                            className="p-1 text-zinc-400 hover:text-white rounded transition-colors cursor-pointer"
                            title={copiedThreadId === thread.id ? 'Copied!' : 'Copy chat'}
                          >
                            {copiedThreadId === thread.id ? (
                              <svg className="w-3 h-3 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            ) : (
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2" />
                              </svg>
                            )}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingThreadId(null);
                            setConfirmDeleteId(thread.id);
                          }}
                          className="p-1 text-zinc-400 hover:text-rose-400 rounded transition-colors cursor-pointer"
                          title="Delete"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {chatThreads.length > 0 && filteredThreads.length === 0 && (
            <div className="py-10 px-4 text-center space-y-2">
              <p className="text-[12px] text-zinc-400">No conversations match &ldquo;{searchQuery}&rdquo;</p>
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="text-[11px] text-zinc-300 hover:text-white underline cursor-pointer"
              >
                Clear search
              </button>
            </div>
          )}

          {chatThreads.length === 0 && (
            <div className="py-12 px-4 text-center space-y-3">
              <p className="text-[12px] text-zinc-400">No conversations yet.</p>
              <button
                type="button"
                onClick={() => {
                  onNewChat();
                  onClose();
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-zinc-200 text-zinc-950 rounded-md text-[12px] font-medium transition-colors cursor-pointer"
              >
                New Chat
              </button>
            </div>
          )}
        </div>

        {/* Clear All Confirmation Bar */}
        {showClearAllConfirm && (
          <div className="px-3.5 py-2.5 border-t border-white/[0.08] bg-zinc-950/90 space-y-2 shrink-0">
            <p className="text-[12px] font-medium text-rose-300">Delete all conversations?</p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowClearAllConfirm(false)}
                className="px-2.5 py-1 text-[11px] text-zinc-300 hover:text-white rounded cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  onClearAllThreads?.();
                  setShowClearAllConfirm(false);
                }}
                className="px-2.5 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded text-[11px] font-medium cursor-pointer"
              >
                Clear All
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
