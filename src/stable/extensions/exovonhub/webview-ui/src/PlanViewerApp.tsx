import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/atom-one-dark.css';
import { getVsCodeApi } from './vscodeApi';

const vscodeApi = getVsCodeApi();

interface LineComment {
  id: string;
  selectedText: string;
  comment: string;
  timestamp: string;
}

interface SelectionPopup {
  text: string;
  x: number;
  y: number;
}

const cleanPlanMarkdown = (raw: string): string => {
  if (!raw) return '';
  let text = String(raw).trim();

  // If text is JSON formatted e.g. {"plan": "..."} or "string", extract inner value
  if (text.startsWith('{') || text.startsWith('"')) {
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed === 'string') {
        text = parsed;
      } else if (parsed && typeof parsed === 'object') {
        text = parsed.plan || parsed.content || parsed.markdown || parsed.text || text;
      }
    } catch {}
  }

  // Unescape literal \r\n, \n, and \t if present as raw string escape sequences
  if (text.includes('\\n') || text.includes('\\r')) {
    text = text.replace(/\\r\\n/g, '\n')
               .replace(/\\n/g, '\n')
               .replace(/\\t/g, '\t');
  }

  // 1. Strip thought and reasoning blocks
  text = text.replace(/<\|?thought[^>]*>[\s\S]*?(?:<\/thought>|<\|?channel\|?>|<\|?end_of_thought\|?>|$)/gi, '');
  text = text.replace(/<\|?think[^>]*>[\s\S]*?(?:<\/think>|<\|?end_of_thought\|?>|$)/gi, '');
  text = text.replace(/<channel\|thought>[\s\S]*?<\/channel>/gi, '');
  text = text.replace(/<\|?tool_call\|?>[\s\S]*?(?:<\/tool_call>|<\|?tool_call\|?>|$)/gi, '');
  
  // 2. Strip leftover tag fragments
  text = text.replace(/<\|?thought[^>]*>/gi, '')
             .replace(/<\/thought>/gi, '')
             .replace(/<\|?think[^>]*>/gi, '')
             .replace(/<\/think>/gi, '')
             .replace(/<\|?channel[^>]*>/gi, '')
             .replace(/<\/channel>/gi, '')
             .replace(/<\|?end_of_thought\|?>/gi, '')
             .replace(/<\|?start_of_thought\|?>/gi, '')
             .replace(/<\|im_end\|>/gi, '')
             .replace(/<\|im_start\|>/gi, '')
             .replace(/\|?>+$/g, '');

  // 3. Remove conversational preamble before the first markdown heading or list item
  const firstHeadingIndex = text.search(/^(?:#|\*\*|1\.|- )/m);
  if (firstHeadingIndex > 0) {
    const preamble = text.slice(0, firstHeadingIndex).toLowerCase();
    if (preamble.includes('apologize') || preamble.includes('here is') || preamble.includes('restart') || preamble.includes('let us') || preamble.includes('i will')) {
      text = text.slice(firstHeadingIndex);
    }
  }

  return text.trim();
};

export default function PlanViewerApp() {
  const [rawMarkdown, setRawMarkdown] = useState<string>('');
  const [planTitle, setPlanTitle] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isApproved, setIsApproved] = useState<boolean>(false);
  const [isRevising, setIsRevising] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<string>('');
  const [isRejecting, setIsRejecting] = useState<boolean>(false);
  const [copySuccess, setCopySuccess] = useState<boolean>(false);

  // Line-by-line / text selection commenting state
  const [selectionPopup, setSelectionPopup] = useState<SelectionPopup | null>(null);
  const [isCommenting, setIsCommenting] = useState<boolean>(false);
  const [commentDraft, setCommentDraft] = useState<string>('');
  const [comments, setComments] = useState<LineComment[]>([]);

  const articleRef = useRef<HTMLElement>(null);

  const markdown = cleanPlanMarkdown(rawMarkdown);
  const headingMatch = markdown.match(/^#\s+(.+)$/m);
  const extractedHeading = headingMatch ? headingMatch[1].replace(/[\[\]`*]/g, '').trim() : '';
  const displayTitle = planTitle || extractedHeading || 'Implementation Plan';

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.type === 'planData') {
        const newMarkdown = message.markdown || '';
        const newTitle = message.title || '';
        if (newTitle) {
          setPlanTitle(newTitle);
        }
        setRawMarkdown((prev) => {
          if (prev !== newMarkdown) {
            setComments([]);
            setIsApproved(false);
            setIsRevising(false);
            setIsRejecting(false);
            setFeedback('');
          }
          return newMarkdown;
        });
        setIsLoading(false);
      }
    };

    window.addEventListener('message', handleMessage);
    vscodeApi?.postMessage({ command: 'getPlan' });

    const timeout = setTimeout(() => {
      setIsLoading(false);
    }, 1500);

    return () => {
      window.removeEventListener('message', handleMessage);
      clearTimeout(timeout);
    };
  }, []);

  const handleApprove = () => {
    setIsApproved(true);
    setIsRevising(false);
    vscodeApi?.postMessage({ command: 'approvePlan' });
  };

  const handleReject = () => {
    let combinedFeedback = feedback.trim();
    if (comments.length > 0) {
      const formattedComments = comments
        .map((c, idx) => `${idx + 1}. On "${c.selectedText}":\n   Feedback: "${c.comment}"`)
        .join('\n\n');
      
      combinedFeedback = combinedFeedback
        ? `${combinedFeedback}\n\n### Specific Line Comments:\n${formattedComments}`
        : `Please revise the plan based on the following line comments:\n\n${formattedComments}`;
    }

    if (combinedFeedback) {
      setIsRevising(true);
      vscodeApi?.postMessage({ command: 'rejectPlan', feedback: combinedFeedback });
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

  // Text selection handler for line-by-line commenting
  const handleMouseUp = (e: React.MouseEvent) => {
    // If the mouse interaction is inside the comment control/popover, do nothing
    if ((e.target as HTMLElement)?.closest?.('.selection-comment-control')) {
      return;
    }

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.toString().trim()) {
      if (!isCommenting) {
        setSelectionPopup(null);
      }
      return;
    }

    const text = selection.toString().trim();
    if (text.length < 2) return;

    try {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      setSelectionPopup({
        text,
        x: Math.min(window.innerWidth - 140, Math.max(16, rect.left + (rect.width / 2) - 50)),
        y: Math.max(50, rect.top - 42),
      });
    } catch {
      if (!isCommenting) {
        setSelectionPopup(null);
      }
    }
  };

  const handleAddComment = () => {
    if (!selectionPopup || !commentDraft.trim()) return;

    const newComment: LineComment = {
      id: `comment_${Date.now()}`,
      selectedText: selectionPopup.text,
      comment: commentDraft.trim(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setComments((prev) => [...prev, newComment]);
    setCommentDraft('');
    setIsCommenting(false);
    setSelectionPopup(null);
  };

  const handleDeleteComment = (id: string) => {
    setComments((prev) => prev.filter((c) => c.id !== id));
  };

  const renderAlert = (text: string) => {
    const alertMatch = text.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*([\s\S]*)/i);
    if (!alertMatch) return null;
    const type = alertMatch[1].toUpperCase();
    const body = alertMatch[2];

    const styles: Record<string, { border: string; bg: string; titleColor: string }> = {
      NOTE: { border: 'border-[#0078d4]', bg: 'bg-[#0078d4]/10', titleColor: 'text-[#0078d4]' },
      TIP: { border: 'border-[#107c41]', bg: 'bg-[#107c41]/10', titleColor: 'text-[#107c41]' },
      IMPORTANT: { border: 'border-[#8764b8]', bg: 'bg-[#8764b8]/10', titleColor: 'text-[#8764b8]' },
      WARNING: { border: 'border-[#d83b01]', bg: 'bg-[#d83b01]/10', titleColor: 'text-[#d83b01]' },
      CAUTION: { border: 'border-[#e81123]', bg: 'bg-[#e81123]/10', titleColor: 'text-[#e81123]' },
    };

    const s = styles[type] || styles.NOTE;

    return (
      <div className={`my-4 pl-3.5 pr-4 py-2 border-l-[3px] ${s.border} ${s.bg} rounded-r-lg backdrop-blur-sm text-sm font-sans`}>
        <div className={`font-bold text-xs uppercase tracking-wide mb-1 ${s.titleColor}`}>
          {type}
        </div>
        <div className="text-zinc-300 leading-relaxed">{body}</div>
      </div>
    );
  };

  return (
    <div
      className="min-h-screen bg-[#0d0d12] text-zinc-200 flex flex-col font-sans selection:bg-white/20 selection:text-white"
      onMouseUp={handleMouseUp}
    >
      {/* Floating Selection '+' Comment Button */}
      {selectionPopup && !isCommenting && (
        <div
          className="selection-comment-control fixed z-50 animate-in zoom-in-95 duration-100"
          style={{ left: selectionPopup.x, top: selectionPopup.y }}
        >
          <button
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsCommenting(true);
            }}
            className="px-2.5 py-1 rounded-full bg-sky-500 hover:bg-sky-400 text-white flex items-center gap-1.5 shadow-2xl transition-transform hover:scale-105 cursor-pointer text-xs font-semibold"
            title="Add line comment"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"/></svg>
            <span>Comment</span>
          </button>
        </div>
      )}

      {/* Inline Comment Composer Popover */}
      {selectionPopup && isCommenting && (
        <div
          className="selection-comment-control fixed z-50 bg-[#14141d]/95 backdrop-blur-xl border border-white/15 rounded-xl p-3 shadow-2xl w-80 font-sans animate-in zoom-in-95 duration-150"
          style={{ left: Math.min(window.innerWidth - 340, Math.max(16, selectionPopup.x - 100)), top: Math.min(window.innerHeight - 180, selectionPopup.y + 35) }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="text-[11px] text-zinc-400 mb-1.5 truncate border-l-2 border-sky-400 pl-2 font-mono bg-white/[0.02] py-0.5">
            "{selectionPopup.text.slice(0, 50)}{selectionPopup.text.length > 50 ? '...' : ''}"
          </div>
          <textarea
            value={commentDraft}
            onChange={(e) => setCommentDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                handleAddComment();
              }
            }}
            placeholder="Add note or instruction on this line..."
            className="w-full h-16 bg-zinc-950/90 border border-white/10 rounded-lg p-2 text-xs text-zinc-100 focus:outline-none focus:border-sky-500/60 resize-none mb-2 font-sans placeholder:text-zinc-500"
            autoFocus
          />
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-zinc-500 font-mono">Ctrl+Enter to save</span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => {
                  setIsCommenting(false);
                  setSelectionPopup(null);
                  setCommentDraft('');
                }}
                className="px-2 py-1 text-zinc-400 hover:text-zinc-200 text-xs rounded transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleAddComment}
                disabled={!commentDraft.trim()}
                className="px-3 py-1 bg-sky-500 hover:bg-sky-400 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Centered Integrated Document Canvas */}
      <div className="max-w-4xl w-full mx-auto px-4 py-6 md:px-8 md:py-8 flex-1 flex flex-col">
        {/* Integrated Document Header Card */}
        <div className="bg-zinc-900/60 backdrop-blur-xl border border-white/10 rounded-2xl p-4 md:p-5 mb-6 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-base font-semibold text-zinc-100 tracking-tight flex items-center gap-2.5">
              <span>{displayTitle}</span>
              <span
                className={`text-[10px] font-mono font-medium px-2 py-0.5 rounded-full border flex items-center gap-1.5 ${
                  isApproved
                    ? 'bg-emerald-950/60 text-emerald-400 border-emerald-800/50'
                    : isRevising
                    ? 'bg-amber-950/60 text-amber-400 border-amber-800/50 animate-pulse'
                    : 'bg-white/5 text-zinc-400 border-white/10'
                }`}
              >
                {isApproved ? 'Approved' : isRevising ? 'Revising Plan...' : 'Review Required'}
              </span>
            </h1>
          </div>

          {/* Action Controls */}
          <div className="flex items-center gap-2 shrink-0">
            {comments.length > 0 && (
              <span className="px-2.5 py-1 rounded-lg bg-sky-950/50 text-sky-300 border border-sky-800/40 text-xs font-mono">
                {comments.length} {comments.length === 1 ? 'Comment' : 'Comments'}
              </span>
            )}

            <button
              onClick={handleCopy}
              className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-300 hover:text-white border border-white/10 text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer backdrop-blur-sm"
              title="Copy Raw Markdown"
            >
              <span>{copySuccess ? 'Copied!' : 'Copy Plan'}</span>
            </button>

            {!isApproved && (
              <>
                <button
                  onClick={() => setIsRejecting(!isRejecting)}
                  className="px-3.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-300 hover:text-white border border-white/10 text-xs font-medium transition-all cursor-pointer backdrop-blur-sm"
                >
                  {isRejecting ? 'Cancel' : 'Request Changes'}
                </button>

                <button
                  onClick={handleApprove}
                  className="px-4 py-1.5 rounded-lg bg-white hover:bg-zinc-200 text-zinc-950 font-semibold text-xs transition-all shadow-sm active:scale-95 flex items-center gap-1.5 cursor-pointer"
                >
                  <span>Proceed & Execute</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Reject / Feedback Drawer */}
        {isRejecting && (
          <div className="bg-zinc-900/70 backdrop-blur-xl border border-white/15 rounded-2xl p-4 mb-6 shadow-xl animate-in slide-in-from-top-2 duration-200">
            <label className="block text-xs font-medium text-zinc-300 mb-2">
              What modifications or adjustments should the agent make to this plan?
              {comments.length > 0 && (
                <span className="text-sky-400 ml-1.5 font-normal">
                  ({comments.length} line {comments.length === 1 ? 'comment' : 'comments'} will be attached)
                </span>
              )}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleReject()}
                placeholder="e.g. Do not touch file X, use existing helper method Y instead..."
                className="flex-1 bg-zinc-950/90 border border-white/15 rounded-xl px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-white/30 font-sans"
                autoFocus
              />
              <button
                onClick={handleReject}
                disabled={!feedback.trim() && comments.length === 0}
                className="px-4 py-2 bg-white hover:bg-zinc-200 disabled:opacity-40 text-zinc-950 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
              >
                Send Feedback & Revise
              </button>
            </div>
          </div>
        )}

        {/* Main Rendered Document Container */}
        <main className="flex-1 min-w-0">
          {markdown ? (
            <article ref={articleRef} className="bg-zinc-900/40 backdrop-blur-md border border-white/5 rounded-2xl p-6 md:p-8 space-y-4 leading-relaxed font-sans shadow-lg text-zinc-200">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
                components={{
                  h1: ({ children }) => (
                    <h1 className="text-2xl font-bold text-white mb-4 mt-2 pb-2 tracking-tight border-b border-white/10">
                      {children}
                    </h1>
                  ),
                  h2: ({ children }) => (
                    <h2 className="text-lg font-semibold text-zinc-100 mt-6 mb-3 tracking-normal">
                      {children}
                    </h2>
                  ),
                  h3: ({ children }) => (
                    <h3 className="text-sm font-semibold text-zinc-200 mt-4 mb-2">
                      {children}
                    </h3>
                  ),
                  h4: ({ children }) => (
                    <h4 className="text-xs font-semibold text-zinc-300 mt-3 mb-1">
                      {children}
                    </h4>
                  ),
                  p: ({ children }) => {
                    const textContent = String(children);
                    // Match [NEW], [MODIFY], [DELETE] badges in file references
                    if (/^\[(NEW|MODIFY|DELETE)\]/i.test(textContent)) {
                      const match = textContent.match(/^\[(NEW|MODIFY|DELETE)\]\s*(.*)/i);
                      if (match) {
                        const tag = match[1].toUpperCase();
                        const rest = match[2];
                        const badgeColor =
                          tag === 'NEW'
                            ? 'bg-blue-950/60 text-blue-400 border-blue-800/40'
                            : tag === 'MODIFY'
                            ? 'bg-amber-950/60 text-amber-400 border-amber-800/40'
                            : 'bg-rose-950/60 text-rose-400 border-rose-800/40';
                        return (
                          <p className="text-zinc-300 text-sm leading-relaxed mb-2 flex items-center gap-2">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold border ${badgeColor}`}>
                              [{tag}]
                            </span>
                            <span className="font-mono text-xs text-zinc-200">{rest}</span>
                          </p>
                        );
                      }
                    }
                    return (
                      <p className="text-zinc-300 text-sm leading-relaxed mb-3">
                        {children}
                      </p>
                    );
                  },
                  ul: ({ children }) => (
                    <ul className="list-disc list-inside space-y-1.5 text-zinc-300 text-sm mb-3 pl-1">
                      {children}
                    </ul>
                  ),
                  ol: ({ children }) => (
                    <ol className="list-decimal list-inside space-y-1.5 text-zinc-300 text-sm mb-3 pl-1">
                      {children}
                    </ol>
                  ),
                  li: ({ children }) => (
                    <li className="text-zinc-300 text-sm leading-relaxed">
                      {children}
                    </li>
                  ),
                  input: ({ type, checked, ...props }) => {
                    if (type === 'checkbox') {
                      return (
                        <input
                          type="checkbox"
                          checked={checked}
                          readOnly
                          className="w-3.5 h-3.5 mr-2 rounded border-white/20 bg-zinc-900 text-sky-400 focus:ring-0 focus:ring-offset-0 align-middle pointer-events-none accent-sky-500 inline-block"
                          {...props}
                        />
                      );
                    }
                    return <input type={type} checked={checked} {...props} />;
                  },
                  blockquote: ({ children }) => {
                    const rawText = String((children as any)?.[1]?.props?.children || children);
                    const alert = renderAlert(rawText);
                    if (alert) return alert;
                    return (
                      <blockquote className="my-3 pl-3.5 py-1 border-l-2 border-zinc-600 bg-white/[0.02] text-zinc-400 text-xs italic rounded-r">
                        {children}
                      </blockquote>
                    );
                  },
                  table: ({ children }) => (
                    <div className="my-4 overflow-x-auto rounded-xl border border-white/10 bg-zinc-950/50 backdrop-blur-sm shadow-md">
                      <table className="w-full text-left text-xs border-collapse font-sans">
                        {children}
                      </table>
                    </div>
                  ),
                  thead: ({ children }) => (
                    <thead className="bg-white/5 border-b border-white/10 text-zinc-300 font-semibold uppercase tracking-wider text-[10px]">
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
                    <th className="px-3.5 py-2 font-medium">{children}</th>
                  ),
                  td: ({ children }) => (
                    <td className="px-3.5 py-2 text-zinc-300">{children}</td>
                  ),
                  hr: () => <hr className="my-6 border-white/10" />,
                  pre: ({ children }) => <>{children}</>,
                  code({ inline, className, children, ...props }: React.ComponentPropsWithoutRef<'code'> & { inline?: boolean; node?: unknown }) {
                    const match = /language-(\w+)/.exec(className || '');
                    return !inline && match ? (
                      <div className="astrolabe-glass-codeblock relative group my-4 rounded-xl overflow-hidden shadow-xl backdrop-blur-md">
                        <div className="flex items-center justify-between bg-white/[0.04] border-b border-white/[0.08] px-3.5 py-1.5 select-none">
                          <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider font-semibold">{match[1]}</span>
                          <button
                            onClick={(e) => {
                              navigator.clipboard.writeText(String(children).replace(/\n$/, ''));
                              const btn = e.currentTarget;
                              btn.textContent = 'Copied!';
                              setTimeout(() => (btn.textContent = 'Copy'), 2000);
                            }}
                            className="text-[10px] text-zinc-400 hover:text-zinc-200 font-mono transition-colors cursor-pointer px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 border border-white/5"
                          >
                            Copy
                          </button>
                        </div>
                        <div className="p-3.5 overflow-x-auto scrollbar-thin text-xs font-mono leading-relaxed bg-transparent text-zinc-200">
                          <code className={`${className || ''} bg-transparent`} style={{ background: 'transparent' }} {...props}>
                            {children}
                          </code>
                        </div>
                      </div>
                    ) : (
                      <code className="bg-white/10 px-1.5 py-0.5 rounded border border-white/10 text-zinc-200 font-mono text-[11px]" {...props}>
                        {children}
                      </code>
                    );
                  },
                }}
              >
                {markdown}
              </ReactMarkdown>

              {/* Inline Line Comments & Plan Revision Thread */}
              {comments.length > 0 && (
                <div className="mt-8 pt-6 border-t border-white/10 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold text-zinc-200 uppercase tracking-wider font-mono flex items-center gap-2">
                      <svg className="w-3.5 h-3.5 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"/></svg>
                      <span>Line Comments & Feedback ({comments.length})</span>
                    </h3>
                    {!isApproved && (
                      <button
                        onClick={handleReject}
                        className="px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-white text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 shadow-sm"
                      >
                        <span>Send Feedback to Agent</span>
                      </button>
                    )}
                  </div>
                  <div className="space-y-2.5">
                    {comments.map((c, idx) => (
                      <div key={c.id} className="p-3 rounded-xl bg-zinc-950/60 border border-white/10 text-xs shadow-sm">
                        <div className="flex items-center justify-between text-[10px] text-zinc-400 mb-1.5 font-mono">
                          <span className="text-sky-400 font-semibold">Comment #{idx + 1}</span>
                          <div className="flex items-center gap-2">
                            <span>{c.timestamp}</span>
                            <button
                              onClick={() => handleDeleteComment(c.id)}
                              className="text-zinc-500 hover:text-rose-400 transition-colors p-0.5"
                              title="Delete comment"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                            </button>
                          </div>
                        </div>
                        <div className="text-[11px] text-zinc-300 italic mb-2 border-l-2 border-sky-500/80 pl-2.5 py-1 bg-sky-950/20 rounded-r font-mono">
                          "{c.selectedText}"
                        </div>
                        <div className="text-zinc-100 font-sans leading-relaxed pl-1">{c.comment}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </article>
          ) : isLoading ? (
            <div className="flex flex-col items-center justify-center py-20 text-center space-y-3 text-zinc-500">
              <svg className="w-8 h-8 animate-spin text-zinc-400" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              <p className="text-xs font-mono">Loading implementation plan...</p>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-center space-y-3 text-zinc-400">
              <p className="text-sm font-medium text-zinc-200">Implementation Plan Ready for Review</p>
              <p className="text-xs text-zinc-400 max-w-md">Click <strong>"Proceed & Execute"</strong> above to proceed, or highlight lines with your mouse to leave specific comments.</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
