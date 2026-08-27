import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/atom-one-dark.css';
import { getVsCodeApi } from './vscodeApi';

const vscodeApi = getVsCodeApi();

export default function PlanViewerApp() {
  const [markdown, setMarkdown] = useState<string>('');
  const [isApproved, setIsApproved] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<string>('');
  const [isRejecting, setIsRejecting] = useState<boolean>(false);
  const [copySuccess, setCopySuccess] = useState<boolean>(false);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.type === 'planData') {
        setMarkdown(message.markdown || '');
      }
    };

    window.addEventListener('message', handleMessage);
    vscodeApi?.postMessage({ command: 'getPlan' });

    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleApprove = () => {
    setIsApproved(true);
    vscodeApi?.postMessage({ command: 'approvePlan' });
  };

  const handleReject = () => {
    if (isRejecting && feedback.trim()) {
      vscodeApi?.postMessage({ command: 'rejectPlan', feedback: feedback.trim() });
      setIsRejecting(false);
      setFeedback('');
    } else {
      setIsRejecting(true);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(markdown);
    vscodeApi?.postMessage({ command: 'copyMarkdown' });
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  const renderAlert = (text: string) => {
    const alertMatch = text.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*([\s\S]*)/i);
    if (!alertMatch) return null;
    const type = alertMatch[1].toUpperCase();
    const body = alertMatch[2];

    const styles: Record<string, { border: string; bg: string; titleColor: string; icon: string }> = {
      NOTE: { border: 'border-blue-500/50', bg: 'bg-blue-950/30', titleColor: 'text-blue-400', icon: 'ℹ️' },
      TIP: { border: 'border-emerald-500/50', bg: 'bg-emerald-950/30', titleColor: 'text-emerald-400', icon: '💡' },
      IMPORTANT: { border: 'border-purple-500/50', bg: 'bg-purple-950/30', titleColor: 'text-purple-400', icon: '📌' },
      WARNING: { border: 'border-amber-500/50', bg: 'bg-amber-950/30', titleColor: 'text-amber-400', icon: '⚠️' },
      CAUTION: { border: 'border-rose-500/50', bg: 'bg-rose-950/30', titleColor: 'text-rose-400', icon: '🚨' },
    };

    const s = styles[type] || styles.NOTE;

    return (
      <div className={`my-3 p-3.5 rounded-xl border ${s.border} ${s.bg} text-[13px] leading-relaxed backdrop-blur-sm`}>
        <div className={`flex items-center gap-2 font-semibold text-xs tracking-wider uppercase mb-1.5 ${s.titleColor}`}>
          <span>{s.icon}</span>
          <span>{type}</span>
        </div>
        <div className="text-zinc-300 font-sans">{body}</div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-200 flex flex-col font-sans selection:bg-cyan-500/30 selection:text-cyan-200">
      {/* Sticky Header Bar */}
      <header className="sticky top-0 z-40 bg-zinc-950/80 backdrop-blur-xl border-b border-white/10 px-6 py-3.5 flex items-center justify-between shadow-2xl">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-zinc-900 border border-white/10 text-cyan-400 shadow-inner">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
              <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
            </svg>
          </div>
          <div>
            <h1 className="text-sm font-bold text-white tracking-wide flex items-center gap-2">
              <span>Implementation Plan</span>
              <span className={`text-[10px] font-mono font-medium px-2 py-0.5 rounded-full border ${isApproved ? 'bg-emerald-950/60 text-emerald-400 border-emerald-800/50' : 'bg-cyan-950/60 text-cyan-400 border-cyan-800/50'}`}>
                {isApproved ? 'Approved' : 'Review Required'}
              </span>
            </h1>
            <p className="text-[11px] text-zinc-400 font-mono">Rendered Architecture & Execution Blueprint</p>
          </div>
        </div>

        {/* Header Action Controls */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={handleCopy}
            className="px-3 py-1.5 rounded-lg bg-zinc-900/80 hover:bg-zinc-800 border border-white/10 text-zinc-300 hover:text-white text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer"
            title="Copy Raw Markdown"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            <span>{copySuccess ? 'Copied!' : 'Copy Plan'}</span>
          </button>

          {!isApproved && (
            <>
              <button
                onClick={() => setIsRejecting(!isRejecting)}
                className="px-3 py-1.5 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/50 text-rose-300 hover:text-rose-200 text-xs font-medium transition-all cursor-pointer"
              >
                {isRejecting ? 'Cancel' : 'Request Changes'}
              </button>

              <button
                onClick={handleApprove}
                className="px-4 py-1.5 rounded-lg bg-white hover:bg-zinc-100 text-zinc-900 font-semibold text-xs transition-all shadow-md active:scale-95 flex items-center gap-1.5 cursor-pointer"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>Proceed & Execute</span>
              </button>
            </>
          )}
        </div>
      </header>

      {/* Reject / Feedback Drawer */}
      {isRejecting && (
        <div className="bg-zinc-900/90 border-b border-rose-900/40 p-4 px-6 animate-in slide-in-from-top-2 duration-200">
          <label className="block text-xs font-semibold text-rose-300 mb-1.5">
            What modifications or adjustments should the agent make to this plan?
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleReject()}
              placeholder="e.g. Do not touch file X, use existing helper method Y instead..."
              className="flex-1 bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-rose-500"
              autoFocus
            />
            <button
              onClick={handleReject}
              disabled={!feedback.trim()}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
            >
              Send Feedback & Revise
            </button>
          </div>
        </div>
      )}

      {/* Main Rendered Document Container */}
      <main className="flex-1 max-w-4xl w-full mx-auto p-6 md:p-10">
        {markdown ? (
          <article className="space-y-4 leading-relaxed">
            <ReactMarkdown
              rehypePlugins={[rehypeHighlight]}
              components={{
                h1: ({ children }) => (
                  <h1 className="text-2xl md:text-3xl font-extrabold text-white pb-3 mb-6 border-b border-white/10 tracking-tight">
                    {children}
                  </h1>
                ),
                h2: ({ children }) => (
                  <h2 className="text-xl font-bold text-white mt-8 mb-4 pb-2 border-b border-white/5 flex items-center gap-2">
                    <span className="text-cyan-400">#</span>
                    <span>{children}</span>
                  </h2>
                ),
                h3: ({ children }) => (
                  <h3 className="text-base font-semibold text-zinc-100 mt-6 mb-2">
                    {children}
                  </h3>
                ),
                h4: ({ children }) => (
                  <h4 className="text-sm font-semibold text-zinc-200 mt-4 mb-2">
                    {children}
                  </h4>
                ),
                p: ({ children }) => (
                  <p className="text-zinc-300 text-sm leading-relaxed mb-3">
                    {children}
                  </p>
                ),
                ul: ({ children }) => (
                  <ul className="list-disc list-inside space-y-1.5 text-zinc-300 text-sm mb-4 pl-1">
                    {children}
                  </ul>
                ),
                ol: ({ children }) => (
                  <ol className="list-decimal list-inside space-y-1.5 text-zinc-300 text-sm mb-4 pl-1">
                    {children}
                  </ol>
                ),
                li: ({ children }) => (
                  <li className="text-zinc-300 text-sm leading-relaxed">
                    {children}
                  </li>
                ),
                blockquote: ({ children }) => {
                  const rawText = String((children as any)?.[1]?.props?.children || children);
                  const alert = renderAlert(rawText);
                  if (alert) return alert;
                  return (
                    <blockquote className="my-4 border-l-2 border-cyan-500/60 bg-zinc-900/50 py-2 px-4 rounded-r-lg text-zinc-400 text-xs italic">
                      {children}
                    </blockquote>
                  );
                },
                table: ({ children }) => (
                  <div className="my-4 overflow-x-auto rounded-xl border border-white/10 bg-zinc-950/60 shadow-lg">
                    <table className="w-full text-left text-xs border-collapse font-sans">
                      {children}
                    </table>
                  </div>
                ),
                thead: ({ children }) => (
                  <thead className="bg-zinc-900 border-b border-white/10 text-zinc-300 font-semibold uppercase tracking-wider text-[10px]">
                    {children}
                  </thead>
                ),
                tbody: ({ children }) => (
                  <tbody className="divide-y divide-white/5 text-zinc-300">
                    {children}
                  </tbody>
                ),
                tr: ({ children }) => (
                  <tr className="hover:bg-white/5 transition-colors">
                    {children}
                  </tr>
                ),
                th: ({ children }) => (
                  <th className="px-4 py-2.5 font-medium">{children}</th>
                ),
                td: ({ children }) => (
                  <td className="px-4 py-2.5">{children}</td>
                ),
                hr: () => <hr className="my-8 border-white/10" />,
                code({ inline, className, children, ...props }: React.ComponentPropsWithoutRef<'code'> & { inline?: boolean; node?: unknown }) {
                  const match = /language-(\w+)/.exec(className || '');
                  return !inline && match ? (
                    <div className="relative group my-4 rounded-xl border border-white/10 overflow-hidden bg-zinc-950 shadow-2xl">
                      <div className="flex items-center justify-between bg-zinc-900/90 border-b border-white/10 px-4 py-2 select-none">
                        <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest font-semibold">{match[1]}</span>
                        <button
                          onClick={(e) => {
                            navigator.clipboard.writeText(String(children).replace(/\n$/, ''));
                            const btn = e.currentTarget;
                            btn.textContent = 'Copied!';
                            setTimeout(() => btn.textContent = 'Copy', 2000);
                          }}
                          className="text-[10px] text-zinc-400 hover:text-white font-mono transition-colors cursor-pointer"
                        >
                          Copy
                        </button>
                      </div>
                      <div className="p-4 overflow-x-auto scrollbar-thin text-xs font-mono leading-relaxed">
                        <code className={className} {...props}>
                          {children}
                        </code>
                      </div>
                    </div>
                  ) : (
                    <code className="bg-zinc-900/90 px-1.5 py-0.5 rounded-md border border-white/10 text-purple-300 font-mono text-xs" {...props}>
                      {children}
                    </code>
                  );
                }
              }}
            >
              {markdown}
            </ReactMarkdown>
          </article>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-center space-y-3 text-zinc-500">
            <svg className="w-10 h-10 animate-spin text-zinc-600" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            <p className="text-sm font-mono">Loading implementation plan...</p>
          </div>
        )}
      </main>
    </div>
  );
}
