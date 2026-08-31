import React, { useState, useEffect, useRef, useMemo } from 'react';
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

type TimeGroup = 'Today' | 'Yesterday' | 'Previous 7 Days' | 'Previous 30 Days' | 'Older';

interface GroupedThreads {
  group: TimeGroup;
  threads: ChatThread[];
}

// Relative time formatter helper
function formatRelativeTime(timestamp: number): string {
  if (!timestamp) return '';
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay === 1) return 'Yesterday';
  if (diffDay < 7) return `${diffDay}d ago`;

  const date = new Date(timestamp);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Helper to determine time group
function getTimeGroup(timestamp: number): TimeGroup {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
  const startOf7Days = startOfToday - 7 * 24 * 60 * 60 * 1000;
  const startOf30Days = startOfToday - 30 * 24 * 60 * 60 * 1000;

  if (timestamp >= startOfToday) return 'Today';
  if (timestamp >= startOfYesterday) return 'Yesterday';
  if (timestamp >= startOf7Days) return 'Previous 7 Days';
  if (timestamp >= startOf30Days) return 'Previous 30 Days';
  return 'Older';
}

export const ChatHistoryDrawer: React.FC<ChatHistoryDrawerProps> = ({
  isOpen,
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

  const searchInputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    } else {
      setSearchQuery('');
      setEditingThreadId(null);
      setConfirmDeleteId(null);
      setShowClearAllConfirm(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (editingThreadId) {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }
  }, [editingThreadId]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === 'Escape') {
        if (editingThreadId) {
          setEditingThreadId(null);
        } else if (confirmDeleteId) {
          setConfirmDeleteId(null);
        } else if (showClearAllConfirm) {
          setShowClearAllConfirm(false);
        } else {
          onClose();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, editingThreadId, confirmDeleteId, showClearAllConfirm, onClose]);

  const filteredThreads = useMemo(() => {
    if (!searchQuery.trim()) return chatThreads;
    const q = searchQuery.toLowerCase().trim();
    return chatThreads.filter(t => {
      const matchTitle = (t.title || '').toLowerCase().includes(q);
      const matchPreview = (t.preview || '').toLowerCase().includes(q);
      return matchTitle || matchPreview;
    });
  }, [chatThreads, searchQuery]);

  const groupedThreads = useMemo(() => {
    const order: TimeGroup[] = ['Today', 'Yesterday', 'Previous 7 Days', 'Previous 30 Days', 'Older'];
    const groups: Record<TimeGroup, ChatThread[]> = {
      'Today': [],
      'Yesterday': [],
      'Previous 7 Days': [],
      'Previous 30 Days': [],
      'Older': []
    };

    for (const thread of filteredThreads) {
      const group = getTimeGroup(thread.updated_at);
      groups[group].push(thread);
    }

    const result: GroupedThreads[] = [];
    for (const g of order) {
      if (groups[g].length > 0) {
        result.push({ group: g, threads: groups[g] });
      }
    }
    return result;
  }, [filteredThreads]);

  const handleStartRename = (e: React.MouseEvent, thread: ChatThread) => {
    e.stopPropagation();
    setEditingThreadId(thread.id);
    setEditTitle(thread.title || 'New Chat');
  };

  const handleSaveRename = (threadId: string) => {
    if (editTitle.trim() && onRenameThread) {
      onRenameThread(threadId, editTitle.trim());
    }
    setEditingThreadId(null);
  };

  const handleExport = (e: React.MouseEvent, threadId: string) => {
    e.stopPropagation();
    if (onExportThread) {
      onExportThread(threadId);
      setCopiedThreadId(threadId);
      setTimeout(() => setCopiedThreadId(null), 2000);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-md transition-opacity duration-200" onClick={onClose}>
      {/* DEEP SPACE OBSIDIAN DRAWER */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Chat History"
        className="w-80 max-w-[88vw] h-full bg-[#0d0d15]/95 border-l border-white/[0.08] shadow-[0_0_50px_rgba(0,0,0,0.8)] flex flex-col backdrop-blur-2xl relative z-10 select-none animate-slide-in-right"
        onClick={(e) => e.stopPropagation()}
      >
        {/* TOP AMBIENT DEEP SPACE VIOLET GLOW */}
        <div className="absolute top-0 left-0 right-0 h-40 bg-gradient-to-b from-violet-600/10 via-indigo-600/5 to-transparent pointer-events-none" />

        {/* HEADER */}
        <div className="px-4 py-3.5 border-b border-white/[0.08] flex items-center justify-between relative z-10 bg-white/[0.02]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-violet-500/10 border border-violet-500/25 flex items-center justify-center text-violet-400 shadow-inner">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h2 className="text-xs font-bold text-white tracking-wide font-sans">Chat History</h2>
                <span className="px-1.5 py-0.2 rounded-md bg-violet-500/10 border border-violet-500/20 text-[10px] font-mono text-violet-300">
                  {chatThreads.length}
                </span>
              </div>
              <p className="text-[10px] text-zinc-400">Past sessions & threads</p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {chatThreads.length > 0 && onClearAllThreads && (
              <button
                onClick={() => setShowClearAllConfirm(true)}
                className="p-1.5 text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-md transition-colors cursor-pointer"
                title="Clear all chat history"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}

            <button
              aria-label="Close Past Chats"
              onClick={onClose}
              className="p-1.5 text-zinc-400 hover:text-white hover:bg-white/10 rounded-md transition-colors cursor-pointer"
              title="Close (Esc)"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* ACTIONS & SEARCH BAR */}
        <div className="p-3 border-b border-white/[0.06] space-y-2.5 relative z-10 bg-black/20">
          {/* NEW CHAT BUTTON */}
          <button
            onClick={() => {
              onNewChat();
              onClose();
            }}
            className="w-full flex items-center justify-between px-3 py-2 bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-600 hover:from-violet-500 hover:via-purple-500 hover:to-indigo-500 text-white rounded-lg font-semibold text-xs shadow-lg shadow-violet-950/50 border border-violet-400/30 transition-all duration-150 transform active:scale-[0.99] group cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <svg className="w-3.5 h-3.5 transition-transform group-hover:rotate-90 duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
              </svg>
              <span>New Chat</span>
            </div>
            <span className="text-[10px] font-mono text-violet-200 bg-black/30 px-1.5 py-0.5 rounded border border-white/10">
              Ctrl+N
            </span>
          </button>

          {/* SEARCH INPUT */}
          <div className="relative">
            <svg className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search conversations..."
              className="w-full pl-8 pr-7 py-1.5 bg-[#14141f] border border-white/[0.08] focus:border-violet-500/60 rounded-lg text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-violet-500/25 transition-all font-sans"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200 p-0.5 cursor-pointer"
                title="Clear search"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* THREAD LIST */}
        <div className="flex-1 overflow-y-auto p-3 space-y-4 relative z-10 scrollbar-thin">
          {groupedThreads.map(({ group, threads }) => (
            <div key={group} className="space-y-1.5">
              {/* GROUP HEADER */}
              <div className="flex items-center justify-between px-1.5 py-0.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 font-mono">
                  {group}
                </span>
                <span className="text-[9px] font-mono text-zinc-400">
                  {threads.length}
                </span>
              </div>

              {/* GROUP ITEMS */}
              <div className="space-y-1">
                {threads.map((thread) => {
                  const isActive = activeThreadId === thread.id;
                  const isEditing = editingThreadId === thread.id;
                  const isConfirmingDelete = confirmDeleteId === thread.id;

                  return (
                    <div
                      key={thread.id}
                      className={`group relative rounded-lg border transition-all duration-150 overflow-hidden ${
                        isActive
                          ? 'bg-violet-500/[0.08] border-violet-500/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_2px_12px_rgba(139,92,246,0.15)]'
                          : 'bg-white/[0.02] hover:bg-white/[0.05] border-white/[0.05] hover:border-white/[0.12]'
                      }`}
                    >
                      {/* ACTIVE PILL ACCENT */}
                      {isActive && (
                        <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-violet-400 rounded-l shadow-[0_0_8px_rgba(167,139,250,0.8)]" />
                      )}

                      {/* INLINE DELETE CONFIRMATION STATE */}
                      {isConfirmingDelete ? (
                        <div className="p-2.5 flex items-center justify-between bg-rose-950/40 border border-rose-500/30 rounded-lg">
                          <span className="text-[11px] text-rose-200 font-medium font-sans">Delete chat?</span>
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => {
                                onDeleteThread(thread.id);
                                setConfirmDeleteId(null);
                              }}
                              className="px-2 py-0.5 bg-rose-600 hover:bg-rose-500 text-white rounded text-[10px] font-bold transition-colors cursor-pointer"
                            >
                              Yes
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-2 py-0.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-[10px] transition-colors cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : isEditing ? (
                        /* INLINE RENAME STATE */
                        <div className="p-2 flex items-center gap-1.5 bg-[#14141f] border border-violet-500/40 rounded-lg">
                          <input
                            ref={editInputRef}
                            type="text"
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveRename(thread.id);
                              if (e.key === 'Escape') setEditingThreadId(null);
                            }}
                            className="flex-1 bg-[#0a0a10] px-2 py-1 border border-white/10 rounded text-xs text-white focus:outline-none focus:border-violet-500"
                          />
                          <button
                            onClick={() => handleSaveRename(thread.id)}
                            className="p-1 text-violet-400 hover:text-violet-300 hover:bg-violet-500/10 rounded cursor-pointer"
                            title="Save title"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                            </svg>
                          </button>
                          <button
                            onClick={() => setEditingThreadId(null)}
                            className="p-1 text-zinc-400 hover:text-zinc-200 hover:bg-white/10 rounded cursor-pointer"
                            title="Cancel"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      ) : (
                        /* STANDARD THREAD CARD */
                        <div
                          onClick={() => {
                            onSelectThread(thread.id);
                            onClose();
                          }}
                          className="p-2.5 cursor-pointer flex flex-col gap-1 text-left"
                        >
                          <div className="flex items-center justify-between gap-1.5">
                            {/* TITLE */}
                            <span
                              className={`text-xs font-semibold truncate flex-1 font-sans ${
                                isActive ? 'text-violet-300 font-bold' : 'text-zinc-200 group-hover:text-white'
                              }`}
                              title={thread.title || 'New Chat'}
                            >
                              {thread.title || 'New Chat'}
                            </span>

                            {/* HOVER ACTIONS TOOLBAR */}
                            <div
                              className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity bg-[#14141f]/95 px-1 py-0.5 rounded-md border border-white/[0.08] shadow-sm shrink-0"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {/* RENAME */}
                              {onRenameThread && (
                                <button
                                  onClick={(e) => handleStartRename(e, thread)}
                                  className="p-1 text-zinc-400 hover:text-violet-300 hover:bg-violet-500/10 rounded transition-colors cursor-pointer"
                                  title="Rename chat"
                                >
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                  </svg>
                                </button>
                              )}

                              {/* EXPORT */}
                              {onExportThread && (
                                <button
                                  onClick={(e) => handleExport(e, thread.id)}
                                  className="p-1 text-zinc-400 hover:text-cyan-300 hover:bg-cyan-500/10 rounded transition-colors cursor-pointer"
                                  title={copiedThreadId === thread.id ? 'Copied!' : 'Export / Copy chat'}
                                >
                                  {copiedThreadId === thread.id ? (
                                    <svg className="w-3 h-3 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                    </svg>
                                  ) : (
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                                    </svg>
                                  )}
                                </button>
                              )}

                              {/* DELETE */}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setConfirmDeleteId(thread.id);
                                }}
                                className="p-1 text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 rounded transition-colors cursor-pointer"
                                title="Delete chat"
                              >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            </div>
                          </div>

                          {/* PREVIEW SNIPPET */}
                          {thread.preview && (
                            <p className="text-[11px] text-zinc-400 truncate leading-tight font-sans">
                              {thread.preview}
                            </p>
                          )}

                          {/* METADATA FOOTER */}
                          <div className="flex items-center justify-between text-[10px] text-zinc-400 font-mono mt-0.5 pt-0.5">
                            <span title={new Date(thread.updated_at).toLocaleString()}>
                              {formatRelativeTime(thread.updated_at)}
                            </span>
                            {typeof thread.message_count === 'number' && thread.message_count > 0 && (
                              <span className="flex items-center gap-1 text-zinc-400 bg-white/[0.04] border border-white/[0.06] px-1.5 py-0.2 rounded text-[9px]">
                                <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                                </svg>
                                {thread.message_count}
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {/* EMPTY SEARCH RESULT */}
          {chatThreads.length > 0 && filteredThreads.length === 0 && (
            <div className="p-6 text-center space-y-2">
              <div className="w-10 h-10 mx-auto rounded-full bg-[#14141f] border border-white/10 flex items-center justify-center text-zinc-400">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <p className="text-xs text-zinc-300 font-medium">No matching conversations</p>
              <p className="text-[11px] text-zinc-400">No chats match &ldquo;{searchQuery}&rdquo;</p>
              <button
                onClick={() => setSearchQuery('')}
                className="mt-2 text-xs text-violet-400 hover:text-violet-300 underline font-medium cursor-pointer"
              >
                Clear Search
              </button>
            </div>
          )}

          {/* EMPTY STATE - NO CHATS AT ALL */}
          {chatThreads.length === 0 && (
            <div className="p-6 text-center space-y-3">
              <div className="w-12 h-12 mx-auto rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center text-violet-400 shadow-inner">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <div>
                <p className="text-xs font-semibold text-zinc-200">No past conversations</p>
                <p className="text-[11px] text-zinc-400 mt-1 max-w-[200px] mx-auto">
                  Start a new session with Astrolabe Agent to inspect, generate, and build your codebase.
                </p>
              </div>
              <button
                onClick={() => {
                  onNewChat();
                  onClose();
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-500 text-white rounded-lg text-xs font-semibold shadow-md shadow-violet-950/40 transition-all cursor-pointer"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                </svg>
                <span>Start First Chat</span>
              </button>
            </div>
          )}
        </div>

        {/* FOOTER CONFIRMATION MODAL FOR CLEAR ALL */}
        {showClearAllConfirm && (
          <div className="p-3 border-t border-rose-500/30 bg-rose-950/90 backdrop-blur-md space-y-2 animate-slide-up">
            <div className="flex items-center gap-2 text-rose-300">
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span className="text-xs font-semibold">Delete all conversations?</span>
            </div>
            <p className="text-[10px] text-rose-200/80">
              This will permanently delete all chat history in this workspace.
            </p>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={() => setShowClearAllConfirm(false)}
                className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-xs transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (onClearAllThreads) onClearAllThreads();
                  setShowClearAllConfirm(false);
                }}
                className="px-2.5 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded text-xs font-bold transition-colors cursor-pointer"
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
