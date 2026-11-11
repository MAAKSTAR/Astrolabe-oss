import type { ThreadTokenStats } from '../utils/threadTokenStats';

interface QuotaInfo {
  usedPercentage: number;
  dailyLimit: number;
  tokensUsed: number;
  currentTier: string;
  modelsUsed: string[];
  resetsIn: string;
}

interface ContextMemoryPopoverProps {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  selectedModel?: string;
  currentContextTokens?: number;
  maxContextTokens?: number;
  tokenStats?: ThreadTokenStats;
  quotaInfo?: QuotaInfo | null;
  isAgentThinking: boolean;
  isCompactingContext: boolean;
  hasCompactableContent: boolean;
  isCompacted: boolean;
  onCompactContext: () => void;
  onClearContext: () => void;
}

export function ContextMemoryPopover({
  open,
  onToggle,
  onClose,
  selectedModel,
  currentContextTokens,
  maxContextTokens,
  tokenStats,
  quotaInfo,
  isAgentThinking,
  isCompactingContext,
  hasCompactableContent,
  isCompacted,
  onCompactContext,
  onClearContext,
}: ContextMemoryPopoverProps) {
  const isLocal = Boolean(selectedModel?.startsWith('local:'));
  const maxTokens = maxContextTokens || 8192;
  const currentTokens = currentContextTokens || tokenStats?.activeContextTokens || 0;
  const sessionTotalTokens = tokenStats?.sessionTotalTokens || 0;
  const lastCompaction = tokenStats?.lastCompaction || null;
  const totalSavedTokens = tokenStats?.totalSavedTokens || 0;
  const pct = isLocal
    ? Math.min(100, Math.round((currentTokens / maxTokens) * 100))
    : (quotaInfo?.usedPercentage || 0);

  const radius = 6;
  const dasharray = 2 * Math.PI * radius;
  const dashoffset = dasharray * ((100 - pct) / 100);
  const colorClass = pct > 90 ? 'text-red-400' : pct > 75 ? 'text-amber-400' : 'text-emerald-400';
  const compactDisabled = isAgentThinking || isCompactingContext || !hasCompactableContent;

  const renderTokenAccounting = () => {
    if (sessionTotalTokens <= 0 && !lastCompaction) return null;
    return (
      <div className="rounded-lg bg-zinc-900/70 border border-white/5 p-2 space-y-1 text-[10px] font-mono">
        {sessionTotalTokens > 0 && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-zinc-400">Session total</span>
            <span className="text-zinc-200 font-semibold">{sessionTotalTokens.toLocaleString()} tokens</span>
          </div>
        )}
        {lastCompaction && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-zinc-400">
              {lastCompaction.source === 'agent' ? 'Agent compact' : 'Compacted'}
            </span>
            <span className="text-sky-300">
              ~{lastCompaction.beforeTokens.toLocaleString()} → ~{lastCompaction.afterTokens.toLocaleString()}
              {totalSavedTokens > 0 ? (
                <span className="text-emerald-400 ml-1">(-{totalSavedTokens.toLocaleString()})</span>
              ) : null}
            </span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-[360px]:relative shrink-0">
      <button
        onClick={onToggle}
        className="relative flex items-center gap-1.5 px-2 min-[360px]:px-2.5 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full transition-colors focus:outline-none"
        title={isLocal ? 'Local Context Window Usage' : 'Daily Quota Usage'}
      >
        <div className="flex items-center gap-1.5">
          <svg className="w-4 h-4 -rotate-90 transform" viewBox="0 0 16 16">
            <circle cx="8" cy="8" r={radius} stroke="currentColor" strokeWidth="2.5" fill="transparent" className="text-white/20" />
            <circle
              cx="8"
              cy="8"
              r={radius}
              stroke="currentColor"
              strokeWidth="2.5"
              fill="transparent"
              strokeDasharray={dasharray}
              strokeDashoffset={dashoffset}
              strokeLinecap="round"
              className={`${colorClass} transition-all duration-700 ease-out`}
            />
          </svg>
          <span className="text-[10px] font-mono font-bold text-white">{Math.round(pct)}%</span>
        </div>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={onClose} />
          <div className="absolute left-0 right-0 min-[360px]:left-auto min-[360px]:right-0 min-[360px]:w-72 bottom-full mb-2 rounded-xl bg-[#1a1a1c] border border-white/10 shadow-2xl overflow-hidden z-50 animate-in fade-in slide-in-from-bottom-2 duration-150 text-zinc-200 select-none">
            {isLocal ? (
              <div>
                <div className="p-3 border-b border-white/10 bg-[#161618]">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-300">Context Memory</span>
                    <span className="text-[9px] bg-white/5 text-zinc-300 px-1.5 py-0.5 rounded border border-white/10 uppercase tracking-wider font-mono font-medium">GPU VRAM</span>
                  </div>
                  <div className="flex items-baseline gap-1 mt-2">
                    <span className="text-xl font-semibold text-white">{pct}%</span>
                    <span className="text-xs text-zinc-400">active KV used</span>
                  </div>
                  <p className="text-[10px] font-mono text-zinc-400 mt-0.5">
                    {currentTokens.toLocaleString()} / {maxTokens.toLocaleString()} active tokens
                  </p>
                </div>

                <div className="p-3 space-y-2.5 bg-[#1a1a1c]">
                  <div className="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-zinc-300 h-1.5 rounded-full transition-all duration-300"
                      style={{ width: `${Math.min(100, Math.max(3, pct))}%` }}
                    />
                  </div>

                  {(sessionTotalTokens > 0 || lastCompaction) && renderTokenAccounting()}

                  <p className="text-[10px] text-zinc-400 leading-relaxed">
                    {isCompacted && !hasCompactableContent
                      ? 'KV brief active. Prior turn messages and token metrics stay visible above.'
                      : 'Keeps essential goals, files, and decisions in KV memory while leaving visible chat history intact.'}
                  </p>

                  <div className="flex gap-2 pt-0.5">
                    <button
                      onClick={() => {
                        onCompactContext();
                        onClose();
                      }}
                      disabled={compactDisabled}
                      className="flex-1 py-1.5 px-2.5 rounded-lg text-xs font-medium bg-white/5 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-200 border border-white/10 transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
                      title={
                        isCompactingContext
                          ? 'Compacting context with LLM...'
                          : !hasCompactableContent
                            ? 'No uncompacted turns to distill'
                            : 'Ask the active LLM to keep essentials and forget stale details'
                      }
                    >
                      {isCompactingContext ? (
                        <span className="w-3.5 h-3.5 border-2 border-zinc-400 border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <svg className="w-3.5 h-3.5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                      )}
                      <span>{isCompactingContext ? 'Compacting...' : 'Compact Context'}</span>
                    </button>

                    <button
                      onClick={() => {
                        onClearContext();
                        onClose();
                      }}
                      className="py-1.5 px-2.5 rounded-lg text-xs font-medium bg-white/5 hover:bg-red-500/15 text-zinc-400 hover:text-red-300 border border-white/10 transition-colors flex items-center justify-center cursor-pointer shadow-sm"
                      title="Clear active LLM context for next turns (keeps chat visible)"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <div className="p-3 border-b border-white/10 bg-[#161618]">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-300">Daily Quota</span>
                    {quotaInfo?.currentTier?.toLowerCase().includes('pro') || quotaInfo?.currentTier?.toLowerCase().includes('enterprise') ? (
                      <span className="text-[9px] bg-white/10 text-amber-300 px-1.5 py-0.5 rounded border border-amber-500/30 uppercase tracking-widest font-mono font-bold">PRO</span>
                    ) : (
                      <span className="text-[9px] bg-white/5 text-zinc-400 px-1.5 py-0.5 rounded border border-white/10 uppercase tracking-widest font-mono">FREE</span>
                    )}
                  </div>
                  <div className="flex items-baseline gap-1 mt-2">
                    <span className="text-xl font-semibold text-white">{quotaInfo?.usedPercentage || 0}%</span>
                    <span className="text-xs text-zinc-400">used</span>
                  </div>
                </div>

                <div className="p-3 space-y-2.5 bg-[#1a1a1c]">
                  <div className="flex justify-between items-center text-[10px]">
                    <span className="text-zinc-400 flex items-center gap-1">
                      <svg className="w-3 h-3 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Resets In
                    </span>
                    <span className="text-zinc-200 font-mono">{quotaInfo?.resetsIn || '24h 00m'}</span>
                  </div>
                  {(sessionTotalTokens > 0 || lastCompaction) && renderTokenAccounting()}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
