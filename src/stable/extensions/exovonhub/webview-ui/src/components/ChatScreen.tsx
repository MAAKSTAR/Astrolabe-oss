import React from 'react';
import type { Message, VsCodeApi } from '../types';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import 'highlight.js/styles/atom-one-dark.css';
import TextareaAutosize from 'react-textarea-autosize';
import { safeMarkdownUrlTransform, extractLegacyMediaText } from './chatMediaHelpers';
import { ContextMemoryPopover } from './ContextMemoryPopover';
import { ModelSelectorPopover } from './ModelSelectorPopover';
import { computeThreadTokenStats } from '../utils/threadTokenStats';
import {
  buildEffectiveHistory,
  extractDroppedPathsFromDataTransfer,
  normalizeDroppedPath,
  parseExternalDropMessage,
  type ContextFileItem,
} from '../utils/dragDropContext';
import {
  TerminalCommandIcon,
  CodeEditIcon,
  PlanIcon,
  StepStatusBadge,
  ToolStepIcon
} from './icons/AnimatedToolIcons';
import { resolveToolStepMeta } from '../utils/toolStepMetadata';

function TypewriterMarkdown({ content, chatEndRef, disableAnimation, vscodeApi }: { content: string; chatEndRef?: React.RefObject<HTMLDivElement | null>, disableAnimation?: boolean; vscodeApi?: VsCodeApi }) {
  const [displayed, setDisplayed] = React.useState(disableAnimation ? content : '');
  const indexRef = React.useRef(disableAnimation ? content.length : 0);

  React.useEffect(() => {
    if (disableAnimation) {
      setDisplayed(content);
      indexRef.current = content.length;
      return;
    }

    if (indexRef.current >= content.length) {
      setDisplayed(content);
      return;
    }

    const interval = setInterval(() => {
      if (indexRef.current < content.length) {
        const remaining = content.length - indexRef.current;
        const chunk = Math.max(2, Math.floor(remaining / 10));
        indexRef.current = Math.min(content.length, indexRef.current + chunk);

        setDisplayed(content.slice(0, indexRef.current));

        if (chatEndRef?.current) {
          chatEndRef.current.scrollIntoView({ behavior: 'auto' });
        }
      } else {
        clearInterval(interval);
      }
    }, 45);
    return () => clearInterval(interval);
  }, [content, chatEndRef, disableAnimation]);

  return (
    <div className="animate-fade-in text-zinc-200">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeHighlight]}
        urlTransform={safeMarkdownUrlTransform}
        components={{
          img: ({ src, alt, ...props }) => {
            if (!src) return null;
            return (
              <img
                src={src}
                alt={alt || 'Generated image'}
                className="w-full max-w-md rounded-2xl border border-white/10 shadow-xl object-contain my-2 bg-zinc-950/60"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                }}
                {...props}
              />
            );
          },
          h1: ({ children }) => <h1 className="text-[20px] font-bold text-white mt-5 mb-2.5 pb-2 border-b border-white/10">{children}</h1>,
          h2: ({ children }) => <h2 className="text-[17.5px] font-bold text-white mt-4 mb-2 pb-1 border-b border-white/5">{children}</h2>,
          h3: ({ children }) => <h3 className="text-[16px] font-semibold text-zinc-100 mt-3.5 mb-1.5">{children}</h3>,
          h4: ({ children }) => <h4 className="text-[15px] font-semibold text-zinc-200 mt-3 mb-1">{children}</h4>,
          p: ({ children }) => <p className="text-[15px] leading-[1.6] mb-3 last:mb-0 text-zinc-200 font-sans">{children}</p>,
          ul: ({ children }) => <ul className="list-disc list-inside space-y-1.5 my-2.5 text-[15px] text-zinc-200 pl-1 leading-[1.6]">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal list-inside space-y-1.5 my-2.5 text-[15px] text-zinc-200 pl-1 leading-[1.6]">{children}</ol>,
          li: ({ children }) => <li className="text-[15px] leading-[1.6] text-zinc-200">{children}</li>,
          blockquote: ({ children }) => <blockquote className="my-3 border-l-2 border-cyan-500/70 bg-zinc-900/60 py-2 px-3.5 rounded-r-lg text-zinc-300 text-[14.5px] leading-relaxed italic">{children}</blockquote>,
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto rounded-xl border border-white/10 bg-zinc-950/60">
              <table className="w-full text-left text-[13.5px] border-collapse font-sans">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-zinc-900 border-b border-white/10 text-zinc-200 font-semibold uppercase text-xs tracking-wider">{children}</thead>,
          tbody: ({ children }) => <tbody className="divide-y divide-white/5 text-zinc-300">{children}</tbody>,
          tr: ({ children }) => <tr className="hover:bg-white/5 transition-colors">{children}</tr>,
          th: ({ children }) => <th className="px-3.5 py-2.5 font-medium">{children}</th>,
          td: ({ children }) => <td className="px-3.5 py-2.5 text-zinc-200">{children}</td>,
          hr: () => <hr className="my-4 border-white/10" />,
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(e) => {
                e.preventDefault();
                if (href) {
                  if (href.startsWith('http://') || href.startsWith('https://')) {
                    vscodeApi?.postMessage({ command: 'openBrowserPreview', url: href });
                  } else {
                    vscodeApi?.postMessage({ command: 'openFile', path: href });
                  }
                }
              }}
              className="text-sky-400 hover:text-sky-300 underline underline-offset-2 cursor-pointer transition-colors"
            >
              {children}
            </a>
          ),
          code({ inline, className, children, ...props }: React.ComponentPropsWithoutRef<'code'> & { inline?: boolean; node?: unknown }) {
            const match = /language-(\w+)/.exec(className || '');
            if (!inline && match) {
              return (
                <div className="relative group mt-3 mb-3 border border-zinc-800 rounded-xl overflow-hidden bg-zinc-950">
                  <div className="flex items-center justify-between bg-zinc-900 border-b border-zinc-800 px-3.5 py-2 select-none">
                    <span className="text-[12px] font-mono text-zinc-400 uppercase tracking-wider">{match[1]}</span>
                    <button
                      onClick={(e) => {
                        navigator.clipboard.writeText(String(children).replace(/\n$/, ''));
                        const btn = e.currentTarget;
                        btn.textContent = 'Copied!';
                        setTimeout(() => btn.textContent = 'Copy', 2000);
                      }}
                      className="text-[11.5px] text-zinc-400 hover:text-zinc-200 font-mono transition-colors cursor-pointer px-2 py-0.5 rounded hover:bg-white/5"
                    >
                      Copy
                    </button>
                  </div>
                  <div className="p-3.5 overflow-x-auto scrollbar-thin text-[13px] font-mono leading-relaxed text-zinc-200">
                    <code className={className} {...props}>
                      {children}
                    </code>
                  </div>
                </div>
              );
            }

            const rawText = String(children).trim();
            const isFilePath = rawText.length > 2 && (
              /\.(md|markdown|ts|tsx|js|jsx|json|py|html|css|scss|yaml|yml|rs|go|c|cpp|h|java|png|jpe?g|gif|svg|webp|sh|bash)$/i.test(rawText) ||
              rawText.startsWith('docs/') ||
              rawText.startsWith('./') ||
              rawText.startsWith('/')
            );

            if (isFilePath) {
              return (
                <code
                  onClick={() => {
                    vscodeApi?.postMessage({ command: 'openFile', path: rawText });
                  }}
                  title={`Click to open ${rawText}`}
                  className="bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 hover:text-sky-200 px-1.5 py-0.5 rounded border border-sky-500/30 font-mono text-[13px] font-medium cursor-pointer transition-all inline-flex items-center gap-1 group shadow-sm hover:shadow"
                  {...props}
                >
                  <span>{children}</span>
                  <svg className="w-3.5 h-3.5 opacity-60 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </code>
              );
            }

            return (
              <code className="bg-zinc-850 px-1.5 py-0.5 rounded border border-white/10 text-sky-300 font-mono text-[13px] font-medium" {...props}>
                {children}
              </code>
            );
          }
        }}
      >
        {displayed}
      </ReactMarkdown>
    </div>
  );
}

interface ChatScreenProps {
  messages: Message[];
  isAgentThinking: boolean;
  stopClicks: number;
  inputValue: string;
  setInputValue: (val: string) => void;
  handleSendMessage: (text?: string) => void;
  setStopClicks: (val: number) => void;
  handleApproveCommand: (id: string, approved: boolean) => void;
  handleApproveFile: (id: string, approved: boolean) => void;


  selectedContextFiles: ContextFileItem[];
  setSelectedContextFiles: React.Dispatch<React.SetStateAction<ContextFileItem[]>>;
  speculativeDiffs: Array<{ path: string; diffLines: Array<{ type: 'added' | 'removed' | 'unchanged'; text: string }> }>;
  setSpeculativeDiffs: React.Dispatch<React.SetStateAction<Array<{ path: string; diffLines: Array<{ type: 'added' | 'removed' | 'unchanged'; text: string }> }>>>;
  planLevel: 'none' | 'auto' | 'strict';
  setPlanLevel: (val: 'none' | 'auto' | 'strict') => void;
  vscodeApi?: VsCodeApi;
  chatEndRef: React.RefObject<HTMLDivElement | null>;
  workspaceRoot?: string;
  isPreempting?: boolean;
  isCompactingContext?: boolean;
  onCompactContext?: () => void;
  onClearContext?: () => void;
  handlePlanApproval?: (approved: boolean) => void;
  selectedModel?: string;
  inspectorActive?: boolean;
  handleModelChange?: (model: string) => void;
  attachedImages?: string[];
  setAttachedImages?: React.Dispatch<React.SetStateAction<string[]>>;
  quotaInfo?: { usedPercentage: number, dailyLimit: number, tokensUsed: number, currentTier: string, modelsUsed: string[], resetsIn: string } | null;
  activeLocalModel?: string;
  activeDiffusionModel?: string;
  activeDiffusionResolution?: string;
  activeDiffusionModality?: string;
  availableLocalModels?: Array<{
    id: string;
    name: string;
    size_display?: string;
    quantization?: string;
    architecture?: string;
    loaded?: boolean;
    is_primary?: boolean;
    modality?: string;
    relative_path?: string;
    component_role?: string | null;
    model_family?: string;
  }>;
  currentContextTokens?: number;
  maxContextTokens?: number;
}

type ExtendedChatMessage = Message & {
  generatingModelName?: string;
  generatingMediaType?: 'image' | 'video';
  generatedMediaType?: 'image' | 'video';
  generatedMediaUrl?: string;
  generatedMediaMime?: string;
  savedPath?: string;
};




function TaskProgressCard({ msg }: { msg: Message }) {
  // 1. Robust Working State Detection
  const isCancelled = Boolean(msg.isCancelled);
  const hasTimeline = Boolean(msg.timeline && msg.timeline.length > 0);
  const hasRunningTimelineEvent = Boolean(hasTimeline && msg.timeline?.some((e: any) => e.status === 'running' || e.status === 'pending'));
  const hasRunningPlanStep = Boolean(msg.planSteps && msg.planSteps.some((s: any) => s.status === 'running' || s.status === 'pending'));
  
  // Active if message is not ended yet or has running events (and not stopped by user)
  const isWorking = !isCancelled && !msg.endTime && (hasRunningTimelineEvent || hasRunningPlanStep || !msg.text);

  // 2. Robust Error Detection across Timeline Events and Plan Steps
  // If stopped by user, do not scream failure or treat aborts as system errors
  const hasFailedEvent = Boolean(!isCancelled && hasTimeline && msg.timeline?.some((e: any) => 
    (e.status === 'failed' || e.status === 'error') && 
    (e.content && (
      e.content.includes('❌') || 
      e.content.includes('API ERROR') || 
      e.content.includes('ORCHESTRATION ERROR') || 
      e.content.includes('EXECUTION FAILED') ||
      e.content.includes('Command failed with exit code') ||
      e.content.includes('Error:') ||
      e.content.includes('ERR_')
    )) ||
    (e.title && (
      e.title.includes('ERROR') || 
      e.title.includes('FAILED') || 
      e.title.includes('CRASH')
    ))
  ));

  const hasFailedPlanStep = Boolean(!isCancelled && msg.planSteps && msg.planSteps.some((s: any) => s.status === 'failed'));
  const hasError = !isCancelled && (hasFailedEvent || hasFailedPlanStep);

  // 3. Card Collapsed State
  // Card is EXPANDED while actively working, AUTOMATICALLY COLLAPSED when finished, stopped, or errored
  const [isCollapsed, setIsCollapsed] = React.useState(!isWorking);

  React.useEffect(() => {
    if (isWorking) {
      setIsCollapsed(false); // Stay expanded while agent is actively working
    } else {
      setIsCollapsed(true);  // Automatically collapse when finished or stopped
    }
  }, [isWorking, msg.endTime, isCancelled]);

  // 4. Progress Calculations
  const timelineCount = msg.timeline ? msg.timeline.length : 0;
  const completedTimelineCount = msg.timeline ? msg.timeline.filter((e: any) => e.status === 'success' || e.status === 'done').length : 0;
  const failedTimelineCount = !isCancelled && msg.timeline ? msg.timeline.filter((e: any) => 
    e.status === 'failed' || 
    e.status === 'error' || 
    (e.content && e.content.includes('❌'))
  ).length : 0;

  return (
    <div className="mb-3 w-full glass-component-white rounded-xl overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-500 shadow-2xl border border-white/20">
      {/* Header Bar */}
      <div 
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="flex items-center justify-between px-4 py-2.5 bg-white/10 border-b border-white/20 hover:bg-white/15 cursor-pointer select-none transition-colors"
      >
        <div className="flex items-center gap-2">
          <StepStatusBadge status={isWorking ? 'running' : isCancelled ? 'stopped' : hasError ? 'failed' : 'success'} />
          <span className={`text-[12px] font-bold ${
            isWorking 
              ? 'glass-text-reflection text-cyan-200' 
              : isCancelled
              ? 'text-amber-400/90'
              : hasError 
              ? 'text-rose-400' 
              : 'text-emerald-400'
          }`}>
            {isWorking 
              ? 'Task in progress' 
              : isCancelled
              ? 'Agent Stopped by User'
              : hasError 
              ? `Task Failed (${failedTimelineCount > 0 ? `${failedTimelineCount} errors` : 'Error'})` 
              : 'Task Completed'} ({completedTimelineCount}/{timelineCount})
          </span>
        </div>

        {/* Manual Collapse / Expand Button */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setIsCollapsed(!isCollapsed);
          }}
          className="text-white/80 hover:text-white p-1 rounded transition-colors flex items-center gap-1.5 text-[11px] font-mono"
          title={isCollapsed ? "Expand Details" : "Collapse Details"}
        >
          <span className="text-[10.5px] uppercase tracking-wider text-zinc-300 font-mono font-medium">
            {isCollapsed ? "Expand" : "Collapse"}
          </span>
          <svg 
            className={`w-3.5 h-3.5 transform transition-transform duration-200 ${isCollapsed ? '' : 'rotate-180'}`} 
            fill="none" 
            viewBox="0 0 24 24" 
            stroke="currentColor" 
            strokeWidth="2"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {/* Timeline Steps (Visible when not collapsed) */}
      {!isCollapsed && msg.timeline && msg.timeline.length > 0 && (
        <div className="p-3 space-y-0.5 relative animate-in fade-in duration-200">
          <div className="absolute left-[23px] top-4 bottom-4 w-px border-l-2 border-dashed border-white/20 z-0"></div>
          {msg.timeline.map((event: any) => {
            const status = event.status || 'running';
            const stepMeta = resolveToolStepMeta(event);
            const { actionVerb, targetDisplay, lineInfo, parsedPayload, isCommand, commandText } = stepMeta;

            const formatToolOutput = (text: string) => {
              if (!text) return text;
              try {
                const parsed = JSON.parse(text);
                if (parsed && typeof parsed === 'object') {
                  if (typeof parsed.stdout === 'string' || typeof parsed.stderr === 'string') {
                    const out = (parsed.stdout || '').trim();
                    const err = (parsed.stderr || '').trim();
                    if (out && err) return `${out}\n\n[stderr]:\n${err}`;
                    if (out) return out;
                    if (err) return `[stderr]:\n${err}`;
                    if (parsed.status === 'success' || parsed.exitCode === 0) return 'Command finished with no output.';
                  }
                  if (parsed.result !== undefined) {
                    return typeof parsed.result === 'string' ? parsed.result : JSON.stringify(parsed.result, null, 2);
                  }
                }
              } catch {}
              return text
                .replace(/^File:\s*"[^"]+"\s*\(\d+\s*lines total\)\s*(Showing lines \d+ to \d+:\s*)?/i, '')
                .replace(/^File:\s*'[^']+'\s*\(\d+\s*lines total\)\s*(Showing lines \d+ to \d+:\s*)?/i, '')
                .trimStart();
            };

            const renderOutputLines = (rawText: string) => {
              const formatted = formatToolOutput(rawText);
              if (!formatted) return null;

              const lines: string[] = formatted.split('\n');
              const hasLineNumbers = lines.length > 0 && lines.some((l: string) => /^\s*\d+\s*\|\s?/.test(l));

              if (hasLineNumbers) {
                return (
                  <div className="space-y-0.5 font-mono text-[11px] leading-relaxed">
                    {lines.map((line: string, idx: number) => {
                      const match = line.match(/^(\s*\d+)\s*\|\s?(.*)$/);
                      if (match) {
                        return (
                          <div key={idx} className="flex hover:bg-white/[0.04] -mx-3 px-3 rounded transition-colors group/codeline">
                            <span className="text-zinc-500 select-none w-10 text-right pr-2.5 mr-2.5 border-r border-white/10 shrink-0 font-mono">
                              {match[1].trim()}
                            </span>
                            <span className="text-zinc-200 whitespace-pre overflow-x-auto">
                              {match[2]}
                            </span>
                          </div>
                        );
                      }
                      return (
                        <div key={idx} className="text-zinc-400 whitespace-pre">
                          {line}
                        </div>
                      );
                    })}
                  </div>
                );
              }

              return <div className="whitespace-pre font-mono text-[11px] leading-relaxed text-zinc-200">{formatted}</div>;
            };

            return (
              <details key={event.id} className="group relative z-10 animate-in fade-in slide-in-from-left-2 duration-300" open={event.status === 'running'}>
                <summary className={`flex items-center gap-2.5 py-1.5 cursor-pointer list-none select-none hover:bg-white/5 transition-colors rounded-lg px-2 -ml-2 ${event.status === 'running' ? 'bg-zinc-800/60 border border-white/20 shadow-sm' : ''}`}>
                  <div className="w-5 h-5 shrink-0 flex items-center justify-center rounded bg-zinc-800/90 border border-white/20 shadow-sm relative text-zinc-100">
                    <ToolStepIcon iconKind={stepMeta.iconKind} status={status} />
                  </div>

                  {event.type === 'tool' ? (
                    <div className="flex items-center gap-2 flex-1 min-w-0 pr-1">
                      <span className="text-[12px] font-semibold text-zinc-200 capitalize shrink-0">
                        {actionVerb}
                      </span>
                      {targetDisplay && (
                        <span className="text-[12px] font-medium text-zinc-100 font-mono truncate max-w-[200px]" title={stepMeta.rawTarget || stepMeta.filePath || targetDisplay}>
                          {targetDisplay}
                        </span>
                      )}
                      {lineInfo && (
                        <span className="text-[11px] font-mono text-zinc-500 font-normal shrink-0">
                          {lineInfo}
                        </span>
                      )}
                      {event.status === 'running' && (
                        <div className="w-12 h-1 bg-zinc-800/80 rounded-full overflow-hidden shrink-0 ml-auto">
                          <div className="w-full h-full bg-cyan-400/60 animate-pulse"></div>
                        </div>
                      )}
                    </div>
                  ) : event.type === 'think' ? (
                    <div className="flex items-center gap-2 flex-1 min-w-0 pr-1">
                      <span className={`text-[12px] font-semibold ${event.status === 'running' ? 'text-cyan-200' : 'text-zinc-200'} shrink-0`}>
                        {event.status === 'running' ? 'Thinking & Planning...' : 'Think'}
                      </span>
                      {event.status === 'running' && (
                        <div className="w-16 h-1 bg-zinc-800/80 rounded-full overflow-hidden shrink-0 ml-auto">
                          <div className="w-full h-full bg-cyan-400/60 animate-pulse"></div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 flex-1 min-w-0 pr-1">
                      <span className="text-[12px] font-medium text-zinc-300 truncate">
                        {event.title || event.content?.substring(0, 40)}
                      </span>
                    </div>
                  )}

                  <span className="transform transition-transform duration-200 group-open:rotate-180 text-[10px] text-zinc-400 ml-auto shrink-0 pl-1">
                    ▼
                  </span>
                </summary>

                <div className="pl-[26px] pb-3 pr-2 pt-1">
                  {event.type === 'think' ? (
                    <div className="text-[11.5px] leading-[1.65] text-zinc-200 font-sans whitespace-pre-wrap pl-1">
                      {event.content?.replace(/<\/?[a-zA-Z0-9_|-]+[^>]*>/gi, '').trim()}
                    </div>
                  ) : event.type === 'log' ? (
                    !isCancelled && !event.content?.includes('stopped') && !event.content?.includes('aborted') && (event.content?.includes('❌') || event.content?.includes('Failed') || event.content?.includes('SYNTAX ERROR')) ? (
                      <div className="bg-rose-950/40 border border-rose-800/60 rounded-xl p-3 text-[11.5px] font-mono text-rose-200 overflow-x-auto whitespace-pre-wrap leading-relaxed shadow-lg">
                        <div className="flex items-center gap-1.5 mb-1 text-rose-300 font-bold text-xs">
                          <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                          </svg>
                          <span>Error Diagnostic</span>
                        </div>
                        {event.content}
                      </div>
                    ) : (
                      <div className="bg-zinc-800/80 border border-white/15 rounded-xl p-2.5 text-[11px] font-mono text-zinc-200 overflow-x-auto whitespace-pre-wrap shadow-sm">
                        {event.content}
                      </div>
                    )
                  ) : (
                    <div className="bg-zinc-900/60 border border-white/10 rounded-xl overflow-hidden shadow-sm transition-all font-mono">
                      {/* Command Bar (clean, no fake window chrome) */}
                      {isCommand && (
                        <div className="flex items-center justify-between px-3 py-2 bg-zinc-800/60 border-b border-white/10 text-[11.5px] text-zinc-100">
                          <div className="flex items-center gap-2 overflow-x-auto select-all">
                            <span className="text-emerald-400 font-bold select-none">$</span>
                            <span className="whitespace-pre">{commandText}</span>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigator.clipboard.writeText(commandText);
                              const btn = e.currentTarget;
                              const oldText = btn.textContent;
                              btn.textContent = 'Copied!';
                              setTimeout(() => btn.textContent = oldText, 1800);
                            }}
                            className="text-[10px] text-zinc-400 hover:text-white px-2 py-0.5 rounded border border-white/10 hover:bg-zinc-700/60 transition-colors ml-2 shrink-0 cursor-pointer select-none"
                          >
                            Copy
                          </button>
                        </div>
                      )}

                      {/* Execution Output Console */}
                      {event.output ? (
                        <div className="p-3 bg-zinc-950/30 max-h-72 min-h-[40px] overflow-y-auto overflow-x-auto scrollbar-thin select-all">
                          {renderOutputLines(event.output)}
                        </div>
                      ) : !isCommand && event.content && event.content !== '{}' ? (
                        <div className="p-3 bg-zinc-950/30 max-h-72 min-h-[40px] overflow-y-auto overflow-x-auto scrollbar-thin select-all text-[11px] leading-relaxed text-zinc-200 whitespace-pre">
                          {(() => {
                            try {
                              return JSON.stringify(parsedPayload, null, 2);
                            } catch {
                              return event.content;
                            }
                          })()}
                        </div>
                      ) : event.status === 'running' ? (
                        <div className="p-2.5 bg-zinc-950/30 text-[11px] text-zinc-400 flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
                          <span>Executing in background sandbox...</span>
                        </div>
                      ) : (
                        <div className="p-2.5 bg-zinc-950/30 text-[10.5px] text-zinc-500 italic">
                          Execution completed with no output.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </details>
            );
        })}
        </div>
      )}
    </div>
  );
}



export function formatModelDisplayName(modelStr?: string): string {
  if (!modelStr) return '';
  let name = modelStr.replace(/^local:/i, '').replace(/^diffusion:/i, '');
  const parts = name.split(/[\\/]/);
  name = parts[parts.length - 1] || name;
  name = name.replace(/\.gguf$/i, '');
  return name;
}

export type ModelKind = 'video' | 'image' | 'music' | 'component' | 'llm';

export function inferModelKind(m: {
  id?: string;
  name?: string;
  architecture?: string;
  modality?: string;
  relative_path?: string;
  component_role?: string | null;
  model_family?: string;
}): ModelKind {
  const explicitModality = (m.modality || '').toLowerCase();
  if (explicitModality === 'video') return 'video';
  if (explicitModality === 'image' || explicitModality === 'diffusion') return 'image';
  if (explicitModality === 'music' || explicitModality === 'audio') return 'music';
  if (explicitModality === 'component' || m.component_role) return 'component';
  // Guard against daemon tagging .gguf diffusion/component models (e.g. Qwen-Image) as generic 'llm'.
  const rawDescriptor = `${m.id || ''} ${m.name || ''} ${m.relative_path || ''} ${m.model_family || ''}`.toLowerCase();
  const hasVisualOrComponentSignal =
    rawDescriptor.includes('mmproj') ||
    rawDescriptor.includes('z-image') ||
    rawDescriptor.includes('zimage') ||
    (rawDescriptor.includes('qwen') && rawDescriptor.includes('image')) ||
    rawDescriptor.includes('flux') ||
    rawDescriptor.includes('sdxl') ||
    rawDescriptor.includes('wan') ||
    rawDescriptor.includes('ltx') ||
    rawDescriptor.includes('hunyuan') ||
    rawDescriptor.includes('diffusion');
  if ((explicitModality === 'llm' || explicitModality === 'text') && !hasVisualOrComponentSignal) return 'llm';

  const relPath = (m.relative_path || '').replace(/\\/g, '/').toLowerCase();
  if (relPath.startsWith('video/')) return 'video';
  if (relPath.startsWith('image/')) return 'image';
  if (relPath.startsWith('music/') || relPath.startsWith('audio/')) return 'music';
  if (relPath.startsWith('component/') || relPath.startsWith('components/')) return 'component';
  if (relPath.startsWith('llm/')) return 'llm';

  const name = (m.name || m.id || '').toLowerCase();
  const normId = (m.id || '').replace(/\\/g, '/').toLowerCase();
  const arch = (m.architecture || '').toLowerCase();

  if (name.includes('mmproj') || name.startsWith('mmproj-') || arch.includes('clip')) {
    return 'component';
  }

  if (
    normId.includes('/video/') ||
    name.includes('wan-') ||
    name.includes('wan2') ||
    name.includes('wan_') ||
    name.includes('hunyuanvideo') ||
    name.includes('cogvideo') ||
    name.includes('ltx-') ||
    name.includes('ltx_') ||
    name.includes('mochi')
  ) {
    return 'video';
  }

  const isLlmKeyword = (
    name.includes('qwen') ||
    name.includes('gemma') ||
    name.includes('llama') ||
    name.includes('bonsai') ||
    name.includes('ornith') ||
    name.includes('lfm') ||
    name.includes('refact') ||
    name.includes('vibethinker')
  );
  if (isLlmKeyword && !name.includes('image')) {
    return 'llm';
  }

  const isImageKeyword = (
    normId.includes('/image/') ||
    name.includes('sd-') ||
    name.includes('sd_') ||
    name.includes('sd1') ||
    name.includes('sd2') ||
    name.includes('sdxl') ||
    name.includes('turbo') ||
    name.includes('diffusion') ||
    name.includes('flux') ||
    name.includes('schnell') ||
    name.includes('illustrious') ||
    name.includes('pony') ||
    name.includes('stable-diffusion') ||
    (name.includes('qwen') && name.includes('image')) ||
    arch.includes('diffusion') ||
    name.endsWith('.safetensors')
  );
  if (isImageKeyword) {
    return 'image';
  }

  return 'llm';
}

export function getModelCategory(m: {
  id?: string;
  name?: string;
  architecture?: string;
  modality?: string;
  relative_path?: string;
  component_role?: string | null;
  model_family?: string;
}): 'video' | 'diffusion' | 'projector' | 'llm' {
  const kind = inferModelKind(m);
  if (kind === 'video') return 'video';
  if (kind === 'image') return 'diffusion';
  if (kind === 'component') return 'projector';
  return 'llm';
}

interface TerminalDashProgressBarProps {
  msg: Message;
  modelName: string;
  isAgentThinking: boolean;
}

function TerminalDashProgressBar({
  msg,
  modelName,
  isAgentThinking,
}: TerminalDashProgressBarProps) {
  const TOTAL_DASHES = 26;
  const [percent, setPercent] = React.useState<number>(5);
  const percentRef = React.useRef<number>(5);

  const hasFirstToken = Boolean(msg.text || (msg.timeline && msg.timeline.length > 0));
  const hasProgress = msg.promptTokens !== undefined && msg.promptTokens > 0;
  const realPercent = msg.diffusionPercent !== undefined
    ? Math.min(100, Math.max(0, Math.round(msg.diffusionPercent)))
    : (hasProgress && msg.promptProcessed !== undefined
      ? Math.min(100, Math.max(0, Math.round((msg.promptProcessed / msg.promptTokens!) * 100)))
      : null);

  // Active smooth progression during prefill or image generation
  React.useEffect(() => {
    if (hasFirstToken && !msg.isGeneratingImage) {
      setPercent(100);
      percentRef.current = 100;
      return;
    }

    const interval = setInterval(() => {
      if (realPercent !== null) {
        percentRef.current = realPercent;
        setPercent(realPercent);
      } else {
        // Smoothly advance dashes during prefill / image denoising so it never looks frozen
        if (percentRef.current < 95) {
          const step = Math.max(1, Math.round((95 - percentRef.current) * 0.12));
          const next = Math.min(95, percentRef.current + step);
          percentRef.current = next;
          setPercent(next);
        }
      }
    }, 60);

    return () => clearInterval(interval);
  }, [hasFirstToken, realPercent, msg.isGeneratingImage]);

  // If first token arrived or agent stopped thinking, prefill is done (unless generating image)
  if ((hasFirstToken && !msg.isGeneratingImage) || !isAgentThinking) {
    return null;
  }

  const filledCount = Math.max(1, Math.min(TOTAL_DASHES, Math.round((percent / 100) * TOTAL_DASHES)));
  const unfilledCount = Math.max(0, TOTAL_DASHES - filledCount);
  const filledDashes = '-'.repeat(filledCount);
  const unfilledDashes = '-'.repeat(unfilledCount);

  return (
    <div className="py-1 my-1 w-full font-mono text-[11px] leading-relaxed select-none">
      {/* Line 1: Model Name (Bigger, pure white font) */}
      <div className="text-white text-sm font-bold tracking-tight mb-1">
        {modelName}
      </div>

      {/* Line 2: Horizontal Dash Progress Bar */}
      <div className="flex items-center gap-x-1.5 font-mono text-[11px] leading-tight select-none">
        <span className="tracking-tighter inline-flex items-center font-mono">
          <span className="text-amber-400 font-bold">
            {filledDashes}
          </span>
          <span className="text-zinc-700 font-medium">
            {unfilledDashes}
          </span>
        </span>
        <span className="text-amber-400 font-semibold">
          ({percent}%)
        </span>
      </div>
      {(msg.diffusionStage || (msg.diffusionTotalSteps && msg.diffusionTotalSteps > 0)) && (
        <div className="text-[11px] text-zinc-400 mt-1 truncate">
          {msg.diffusionTotalSteps && msg.diffusionTotalSteps > 0
            ? `Step ${msg.diffusionStep ?? 0}/${msg.diffusionTotalSteps} · ${msg.diffusionStage || 'Generating...'}`
            : msg.diffusionStage}
        </div>
      )}
    </div>
  );
}

export function ChatScreen({
  messages,
  isAgentThinking,
  stopClicks,
  inputValue,
  setInputValue,
  handleSendMessage,
  setStopClicks,
  handleApproveCommand,
  handleApproveFile,


  selectedContextFiles,
  setSelectedContextFiles,
  speculativeDiffs,
  setSpeculativeDiffs,
  planLevel,
  setPlanLevel,
  vscodeApi,
  chatEndRef,
  workspaceRoot,
  isPreempting,
  isCompactingContext,
  onCompactContext,
  onClearContext,
  handlePlanApproval,
  selectedModel,
  inspectorActive,
  handleModelChange,
  attachedImages,
  setAttachedImages,
  quotaInfo,
  activeLocalModel,
  activeDiffusionModel,
  activeDiffusionResolution,
  activeDiffusionModality,
  availableLocalModels,
  currentContextTokens,
  maxContextTokens
}: ChatScreenProps) {
  // Smart Scroll state
  const [autoScroll, setAutoScroll] = React.useState(true);

  // Smart stop timeout
  React.useEffect(() => {
    if (stopClicks === 1) {
      const timer = setTimeout(() => {
        setStopClicks(0);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [stopClicks, setStopClicks]);

  React.useEffect(() => {
    if (autoScroll && chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'auto' });
    }
  }, [messages, isAgentThinking, autoScroll, chatEndRef]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const isAtBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 40;
    setAutoScroll(isAtBottom);
  };

  const [showReviewModal, setShowReviewModal] = React.useState(false);
  const [expandedDiffs, setExpandedDiffs] = React.useState<Record<string, boolean>>({});

  const [showQuotaPopover, setShowQuotaPopover] = React.useState(false);
  const [modelDropdownOpen, setModelDropdownOpen] = React.useState(false);
  const [planDropdownOpen, setPlanDropdownOpen] = React.useState(false);

  const [isDraggingInput, setIsDraggingInput] = React.useState(false);
  const inputDragDepthRef = React.useRef(0);
  const [expandedCompactions, setExpandedCompactions] = React.useState<Record<string, boolean>>({});
  const [showToolbox, setShowToolbox] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const rawSelectedModel = (selectedModel || '').replace(/^(?:diffusion|video|local):/i, '');
  const matchedActiveModel = (availableLocalModels || []).find(m =>
    m.id === rawSelectedModel ||
    m.name === rawSelectedModel ||
    (m.id?.split(/[\\/]/).pop() || '') === rawSelectedModel ||
    (activeDiffusionModel && (m.id === activeDiffusionModel || m.name === activeDiffusionModel || (m.id?.split(/[\\/]/).pop() || '') === activeDiffusionModel))
  );
  const activeVisualKind = selectedModel
    ? inferModelKind({
        ...(matchedActiveModel || {}),
        id: matchedActiveModel?.id || rawSelectedModel,
        name: matchedActiveModel?.name || rawSelectedModel,
        modality: matchedActiveModel?.modality || (selectedModel.startsWith('video:') ? 'video' : (selectedModel.startsWith('diffusion:') ? activeDiffusionModality : undefined))
      })
    : (activeDiffusionModel && !activeLocalModel
        ? inferModelKind({
            ...(matchedActiveModel || {}),
            id: activeDiffusionModel,
            name: activeDiffusionModel,
            modality: activeDiffusionModality || matchedActiveModel?.modality
          })
        : 'llm');
  const isVideoMode = activeVisualKind === 'video' || (
    Boolean(activeDiffusionModel) &&
    !activeLocalModel &&
    activeDiffusionModality === 'video' &&
    (!selectedModel || selectedModel.startsWith('diffusion:') || selectedModel.startsWith('video:'))
  );
  const isDiffusion = Boolean(
    selectedModel?.startsWith('diffusion:') ||
    selectedModel?.startsWith('video:') ||
    (!selectedModel && activeDiffusionModel && !activeLocalModel) ||
    activeVisualKind === 'image' ||
    isVideoMode
  );

  const isVisionSupported = isDiffusion || !(
    selectedModel?.startsWith('deepseek') ||
    selectedModel?.startsWith('mimo') ||
    (selectedModel?.startsWith('Qwen') && !selectedModel.toLowerCase().includes('vl') && !selectedModel.toLowerCase().includes('image')) ||
    selectedModel?.startsWith('glm')
  );

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!isVisionSupported) {
      if (vscodeApi) vscodeApi.postMessage({ command: 'log', text: 'The selected model does not support vision/image inputs.', logType: 'error' });
      return;
    }
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      if (vscodeApi) vscodeApi.postMessage({ command: 'log', text: 'Invalid format. Only standard images are allowed (no videos or documents).', logType: 'error' });
      return;
    }

    if (file.size > 5 * 1024 * 1024) { // 5MB limit
      if (vscodeApi) vscodeApi.postMessage({ command: 'log', text: 'Image too large. Please select an image under 5MB.', logType: 'error' });
      return;
    }

    if (attachedImages && attachedImages.length >= 3) {
      if (vscodeApi) vscodeApi.postMessage({ command: 'log', text: 'Maximum of 3 images can be attached per message.', logType: 'warning' });
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const MAX_WIDTH = 1024;
        const MAX_HEIGHT = 1024;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }
        canvas.width = width;
        canvas.height = height;
        if (ctx) ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);

        if (setAttachedImages) {
          setAttachedImages(prev => [...prev, dataUrl]);
        }
        if (vscodeApi) vscodeApi.postMessage({ command: 'log', text: `Attached image: ${file.name} (Resized)`, logType: 'info' });
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
    setShowToolbox(false);
  };

  // --- DRAG AND DROP INTEGRATION ---
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const attachFileContext = (rawPath: string) => {
    const { cleanPath, relPath, isImage } = normalizeDroppedPath(rawPath, workspaceRoot);
    if (!cleanPath) return;

    if (isImage) {
      if (vscodeApi) {
        vscodeApi.postMessage({ command: 'readImageAsBase64', path: cleanPath });
      }
      return;
    }

    setSelectedContextFiles((prev) => {
      if (prev.some((f) => (f.path && f.path === cleanPath) || f.name === relPath)) {
        return prev;
      }
      if (prev.length >= 5) {
        if (vscodeApi) {
          vscodeApi.postMessage({ command: 'log', text: 'Maximum of 5 context files can be attached per message.', logType: 'warning' });
        }
        return prev;
      }
      return [...prev, { name: relPath, path: cleanPath, type: 'file' }];
    });
  };

  const applyExternalDropRef = React.useRef<(raw: unknown) => void>(() => {});
  React.useEffect(() => {
    applyExternalDropRef.current = (raw: unknown) => {
      const payload = parseExternalDropMessage(raw);
      if (!payload) return;
      if (payload.filePaths.length > 0) {
        payload.filePaths.forEach(attachFileContext);
        return;
      }
      if (payload.snippetText) {
        setInputValue(inputValue ? `${inputValue.trim()}\n\n${payload.snippetText}\n` : payload.snippetText);
      }
    };
  });

  React.useEffect(() => {
    const handleBridgeMessage = (event: MessageEvent) => {
      const msg = event.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'externalDragState') {
        const active = Boolean(msg.active);
        inputDragDepthRef.current = active ? 1 : 0;
        setIsDraggingInput(active);
        return;
      }
      if (msg.type === 'externalDropFiles') {
        inputDragDepthRef.current = 0;
        setIsDraggingInput(false);
        applyExternalDropRef.current(msg);
      }
    };
    window.addEventListener('message', handleBridgeMessage);
    return () => window.removeEventListener('message', handleBridgeMessage);
  }, []);

  const handleInputDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    inputDragDepthRef.current += 1;
    setIsDraggingInput(true);
  };

  const handleInputDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    if (!isDraggingInput) {
      setIsDraggingInput(true);
    }
  };

  const handleInputDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    inputDragDepthRef.current = Math.max(0, inputDragDepthRef.current - 1);
    if (inputDragDepthRef.current === 0) {
      setIsDraggingInput(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    inputDragDepthRef.current = 0;
    setIsDraggingInput(false);

    // 1. OS desktop / file manager file drops
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length > 0) {
      files.forEach((file) => {
        const isImage = file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|svg|bmp)$/i.test(file.name);
        if (isImage) {
          if (file.size > 5 * 1024 * 1024) {
            if (vscodeApi) vscodeApi.postMessage({ command: 'log', text: `Image "${file.name}" exceeds 5MB limit.`, logType: 'error' });
            return;
          }
          const reader = new FileReader();
          reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
              const canvas = document.createElement('canvas');
              const ctx = canvas.getContext('2d');
              const MAX_WIDTH = 1024;
              const MAX_HEIGHT = 1024;
              let width = img.width;
              let height = img.height;
              if (width > height) {
                if (width > MAX_WIDTH) {
                  height *= MAX_WIDTH / width;
                  width = MAX_WIDTH;
                }
              } else {
                if (height > MAX_HEIGHT) {
                  width *= MAX_HEIGHT / height;
                  height = MAX_HEIGHT;
                }
              }
              canvas.width = width;
              canvas.height = height;
              if (ctx) ctx.drawImage(img, 0, 0, width, height);
              const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
              if (setAttachedImages) {
                setAttachedImages((prev) => (prev.length < 3 ? [...prev, dataUrl] : prev));
              }
              if (vscodeApi) vscodeApi.postMessage({ command: 'log', text: `Attached dropped image: ${file.name}`, logType: 'info' });
            };
            img.src = event.target?.result as string;
          };
          reader.readAsDataURL(file);
        } else {
          const filePath = (file as any).path || file.name;
          attachFileContext(filePath);
        }
      });
      return;
    }

    // 2. VS Code Explorer / Editor Tabs / Selected Code drops
    const { filePaths, snippetText } = extractDroppedPathsFromDataTransfer(e.dataTransfer);
    if (filePaths.length > 0) {
      filePaths.forEach(attachFileContext);
      return;
    }

    if (snippetText) {
      setInputValue(inputValue ? `${inputValue.trim()}\n\n${snippetText}\n` : snippetText);
    }
  };

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="flex-1 flex flex-col gap-3 min-h-0 justify-between relative"
    >
      {/* INTERACTIVE CHAT THREAD (FEED) */}
      <div
        role="log"
        aria-live="polite"
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto pr-1 min-h-0 py-2 scrollbar-thin"
      >
        <div className="max-w-4xl mx-auto w-full px-2 space-y-4">
        {messages.map((msg, idx) => {
          if (msg.contextMarkerType === 'compacted' || msg.contextMarkerType === 'cleared') {
            const isCompact = msg.contextMarkerType === 'compacted';
            const isExpanded = Boolean(expandedCompactions[msg.id]);
            const savedCount =
              typeof msg.beforeTokens === 'number' && typeof msg.afterTokens === 'number'
                ? Math.max(0, msg.beforeTokens - msg.afterTokens)
                : 0;
            return (
              <div key={msg.id} className="my-3 flex flex-col items-center">
                <div className="w-full flex items-center gap-2 text-[10.5px] font-mono text-zinc-400">
                  <div className="flex-1 h-px bg-white/10" />
                  <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 px-3 py-1 rounded-full bg-white/5 border border-white/10">
                    <span className={isCompact ? 'text-sky-400' : 'text-amber-400'}>
                      {isCompact ? '⚡' : '🧹'}
                    </span>
                    <span className="text-zinc-300 font-semibold">
                      {isCompact
                        ? `Context Compacted${
                            msg.beforeTokens && msg.afterTokens
                              ? ` (~${msg.beforeTokens.toLocaleString()} → ~${msg.afterTokens.toLocaleString()} tokens${savedCount > 0 ? ` · -${savedCount.toLocaleString()} freed` : ''})`
                              : ''
                          }`
                        : 'Context Cleared — Fresh KV Memory'}
                    </span>
                    {isCompact && msg.text && (
                      <button
                        type="button"
                        onClick={() => setExpandedCompactions((prev) => ({ ...prev, [msg.id]: !prev[msg.id] }))}
                        className="text-sky-400 hover:text-sky-300 underline underline-offset-2 ml-1 cursor-pointer"
                      >
                        {isExpanded ? 'Hide Brief' : 'View Brief'}
                      </button>
                    )}
                  </div>
                  <div className="flex-1 h-px bg-white/10" />
                </div>
                {isCompact && isExpanded && msg.text && (
                  <div className="mt-2 w-full max-w-2xl rounded-xl bg-[#161618] border border-white/10 p-3 text-xs text-zinc-300 font-sans leading-relaxed">
                    <div className="whitespace-pre-wrap">{msg.text}</div>
                    <div className="mt-2 pt-2 border-t border-white/5 text-[10px] font-mono text-zinc-500">
                      Previous messages and their turn token counts stay visible above; only this brief and newer turns remain in active KV memory.
                    </div>
                  </div>
                )}
              </div>
            );
          }

          const isPrefilling = msg.sender === 'agent' &&
            !msg.text &&
            (!msg.timeline || msg.timeline.length === 0) &&
            !msg.isGeneratingImage &&
            !msg.isHistory &&
            !msg.endTime &&
            idx === messages.length - 1 &&
            isAgentThinking;

          return (
            <div
              key={msg.id}
              className={`flex flex-col max-w-[90%] ${msg.sender === 'user' ? 'ml-auto items-end' : 'mr-auto items-start'
                }`}
            >
              {/* Thinking/Working Components (Distinct from Chat Response) */}
              {msg.sender === 'agent' && msg.isGeneratingImage && (() => {
                const extMsg = msg as ExtendedChatMessage;
                const activeMediaModel = formatModelDisplayName(
                  extMsg.generatingModelName || activeDiffusionModel || activeLocalModel || selectedModel
                );
                const isVideoGen = extMsg.generatingMediaType === 'video' || isVideoMode;
                return (
                  <div className="w-full max-w-md flex flex-col items-start gap-2.5 my-3 z-10 animate-in fade-in duration-200">
                    {activeMediaModel && (
                      <div className="flex items-center gap-2 text-zinc-200 text-xs font-medium tracking-wide">
                        <span className="text-emerald-400 animate-pulse text-sm">✦</span>
                        <span className="truncate max-w-[320px]">{activeMediaModel}</span>
                      </div>
                    )}
                    <div className={`w-full ${isVideoGen ? 'aspect-video' : 'aspect-square'} rounded-3xl bg-[#18181b] border border-white/10 relative overflow-hidden shadow-2xl`}>
                      {/* Smooth metallic shimmer sweep */}
                      <div
                        className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.08] to-transparent animate-[shimmer_2s_infinite]"
                        style={{ pointerEvents: 'none' }}
                      />
                      <div className="absolute inset-x-0 bottom-0 h-1 bg-white/10">
                        <div
                          className="h-full bg-emerald-400/80 transition-all duration-300"
                          style={{ width: `${Math.min(100, Math.max(5, msg.diffusionPercent ?? 5))}%` }}
                        />
                      </div>
                    </div>
                    <div className="text-[11px] text-zinc-400 font-mono">
                      {msg.diffusionTotalSteps && msg.diffusionTotalSteps > 0
                        ? `Step ${msg.diffusionStep ?? 0}/${msg.diffusionTotalSteps} · ${msg.diffusionStage || 'Generating...'} (${msg.diffusionPercent ?? 0}%)`
                        : (msg.diffusionStage || (isVideoGen ? 'Preparing video pipeline...' : 'Preparing image pipeline...'))}
                    </div>
                  </div>
                );
              })()}

              {/* Terminal Dash Progress Bar: Active during prefill or image gen */}
              {isPrefilling && (
                <TerminalDashProgressBar
                  msg={msg}
                  modelName={formatModelDisplayName(activeLocalModel || selectedModel || 'Local Model')}
                  isAgentThinking={isAgentThinking}
                />
              )}

              {/* Task/Thinking Card: NEVER blocked, renders immediately as thoughts stream in */}
              {msg.sender === 'agent' && !msg.isGeneratingImage && msg.timeline && msg.timeline.length > 0 && (
                <TaskProgressCard msg={msg} />
              )}

              {/* Final Response Chat Bubble: Appears immediately when text begins streaming */}
              {(() => {
                const extMsg = msg as ExtendedChatMessage;
                const b64ImageFallback = extMsg.generatedMediaType !== 'video' && extMsg.generatedImageB64
                  ? `data:${extMsg.generatedMediaMime || 'image/png'};base64,${extMsg.generatedImageB64}`
                  : undefined;
                const videoSrc = extMsg.generatedMediaUrl && extMsg.generatedMediaType === 'video'
                  ? extMsg.generatedMediaUrl
                  : (extMsg.generatedMediaType === 'video' && extMsg.generatedImageB64 && extMsg.generatedMediaMime
                    ? `data:${extMsg.generatedMediaMime};base64,${extMsg.generatedImageB64}`
                    : undefined);
                const parsedMedia = msg.sender === 'agent'
                  ? extractLegacyMediaText(msg.text, extMsg.savedPath, Boolean(extMsg.generatedMediaUrl || b64ImageFallback))
                  : { cleanedText: msg.text || '', resolvedSavedPath: extMsg.savedPath, fallbackImageSrc: undefined };
                const imageSrc = extMsg.generatedMediaType !== 'video'
                  ? (extMsg.generatedMediaUrl || b64ImageFallback || parsedMedia.fallbackImageSrc)
                  : undefined;
                const hasVideoMedia = extMsg.generatedMediaType === 'video' && Boolean(videoSrc);
                const hasImageMedia = Boolean(imageSrc);
                const savedPath = parsedMedia.resolvedSavedPath;
                const savedBasename = savedPath ? (savedPath.split(/[\\/]/).pop() || savedPath) : '';
                const bodyText = msg.sender === 'agent' ? parsedMedia.cleanedText : msg.text;
                if (!(bodyText || (msg.images && msg.images.length > 0) || hasVideoMedia || hasImageMedia || savedPath)) return null;
                return (
              <div className="relative group/message w-full">
                <div
                  className={`py-2 px-1 text-[15px] leading-[1.6] font-sans transition-all duration-150 markdown-body select-text ${msg.sender === 'user'
                    ? 'bg-zinc-900/60 border border-zinc-800/60 rounded-2xl px-4 py-3 text-zinc-100 shadow-sm'
                    : 'text-zinc-200 bg-transparent'
                    }`}
                >
                  {hasImageMedia && imageSrc && (
                    <div className="mb-2">
                      <img
                        src={imageSrc}
                        alt="Generated image"
                        className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-950/60 shadow-xl object-contain"
                        onError={(e) => {
                          const imgEl = e.currentTarget as HTMLImageElement;
                          if (b64ImageFallback && imgEl.src !== b64ImageFallback) {
                            imgEl.src = b64ImageFallback;
                          } else {
                            imgEl.style.display = 'none';
                          }
                        }}
                      />
                    </div>
                  )}
                  {hasVideoMedia && videoSrc && (
                    <div className="mb-2">
                      <video
                        controls
                        autoPlay
                        loop
                        muted
                        playsInline
                        src={videoSrc}
                        className="w-full max-w-md rounded-2xl border border-white/10 bg-black shadow-xl"
                      />
                    </div>
                  )}
                  {savedPath && (
                    <div className="mb-1.5 flex items-center">
                      <button
                        type="button"
                        onClick={() => vscodeApi?.postMessage({ command: 'openFile', path: savedPath })}
                        title={savedPath}
                        className="inline-flex items-center gap-1.5 text-[11.5px] font-mono text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
                      >
                        <span className="truncate max-w-[320px]">{savedBasename}</span>
                        <svg className="w-3 h-3 opacity-70 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </button>
                    </div>
                  )}
                  {msg.images && msg.images.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-2">
                      {msg.images.map((imgData, idx) => (
                        <img key={idx} src={imgData} alt="Attached" className="max-h-32 rounded-md border border-zinc-800 object-contain" />
                      ))}
                    </div>
                  )}
                  {msg.contextFiles && msg.contextFiles.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {msg.contextFiles.map((fileLabel, fileIdx) => (
                        <span
                          key={fileIdx}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-[11px] font-mono text-zinc-300"
                        >
                          <span>📄</span>
                          <span className="truncate max-w-[220px]">{fileLabel}</span>
                        </span>
                      ))}
                    </div>
                  )}
                  {bodyText && !msg.isCommandApproval && !msg.isFileApproval && !msg.isPlanReview && (msg.sender === 'agent' ? (
                    <TypewriterMarkdown content={bodyText} chatEndRef={chatEndRef} disableAnimation={Boolean(msg.isHistory || msg.endTime || idx < messages.length - 1)} vscodeApi={vscodeApi} />
                  ) : (
                    <div className="text-zinc-100 text-[15px] leading-[1.6]">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        rehypePlugins={[rehypeRaw]}
                        urlTransform={safeMarkdownUrlTransform}
                        components={{
                          p: ({ children }) => <p className="mb-2 last:mb-0 text-zinc-100 text-[15px] leading-[1.6] font-sans">{children}</p>,
                          code: ({ inline, className, children, ...props }: React.ComponentPropsWithoutRef<'code'> & { inline?: boolean; node?: unknown }) => (
                            <code className="bg-zinc-800/80 px-1.5 py-0.5 rounded border border-white/10 text-sky-300 font-mono text-[13px] font-medium" {...props}>
                              {children}
                            </code>
                          )
                        }}
                      >
                        {bodyText}
                      </ReactMarkdown>
                    </div>
                  ))}
                </div>

                {/* Agent Token Metrics & Action Footer (Always visible) */}
                {msg.sender === 'agent' ? (
                  <div className="flex items-center justify-between gap-3 mt-2 pt-1.5 border-t border-white/5 select-none text-[10.5px] font-mono text-zinc-500">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {msg.metrics?.total_tokens || (msg.metrics?.prompt_tokens && msg.metrics?.completion_tokens) ? (
                        <span className="truncate">
                          <span className="text-zinc-300 font-medium">{((msg.metrics.total_tokens ?? ((msg.metrics.prompt_tokens || 0) + (msg.metrics.completion_tokens || 0)))).toLocaleString()}</span> tokens
                          <span className="text-zinc-500 font-normal ml-1.5">
                            ({(msg.metrics.prompt_tokens || 0).toLocaleString()} in · {(msg.metrics.completion_tokens || 0).toLocaleString()} out)
                            {(() => {
                              const tps = msg.metrics.completion_tps ?? msg.metrics.tps;
                              if (tps === undefined || tps === null || isNaN(tps) || tps <= 0) return null;
                              const formatted = tps < 10 ? tps.toFixed(1) : Math.round(tps);
                              return ` · ${formatted} tps`;
                            })()}
                            {msg.autoCompaction && (
                              <span className="ml-1.5 text-sky-400">
                                · compacted ~{msg.autoCompaction.beforeTokens.toLocaleString()}→~{msg.autoCompaction.afterTokens.toLocaleString()}
                              </span>
                            )}
                          </span>
                        </span>
                      ) : msg.promptTokens ? (
                        <span>
                          <span className="text-zinc-300 font-medium">{msg.promptTokens.toLocaleString()}</span> prompt tokens
                          {msg.autoCompaction && (
                            <span className="ml-1.5 text-sky-400">
                              · compacted ~{msg.autoCompaction.beforeTokens.toLocaleString()}→~{msg.autoCompaction.afterTokens.toLocaleString()}
                            </span>
                          )}
                        </span>
                      ) : msg.autoCompaction ? (
                        <span className="text-sky-400">
                          KV compacted ~{msg.autoCompaction.beforeTokens.toLocaleString()} → ~{msg.autoCompaction.afterTokens.toLocaleString()}
                        </span>
                      ) : null}
                    </div>

                    <div className="flex items-center gap-2 shrink-0 ml-auto">
                      {msg.timestamp && (
                        <span className="text-[10px] text-zinc-600 font-mono">{msg.timestamp}</span>
                      )}
                      {/* Copy Button */}
                      <button
                        type="button"
                        onClick={(e) => {
                          navigator.clipboard.writeText(msg.text || '');
                          const btn = e.currentTarget;
                          const originalSvg = btn.innerHTML;
                          btn.innerHTML = `<svg class="w-3.5 h-3.5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
                          setTimeout(() => { btn.innerHTML = originalSvg; }, 1500);
                        }}
                        className="p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors cursor-pointer"
                        title="Copy"
                      >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                      </button>

                      {/* Checkpoint Rollback / Restore Button */}
                      {msg.checkpoint && (
                        <button
                          type="button"
                          onClick={() => {
                            if (vscodeApi) {
                              vscodeApi.postMessage({ command: 'rollbackToCheckpoint', checkpointId: msg.checkpoint.id });
                            }
                          }}
                          className="p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors cursor-pointer"
                          title={`Rollback workspace to Checkpoint #${msg.checkpoint.stepNumber || msg.checkpoint.id.substring(0, 8)}`}
                        >
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                            <path d="M3 3v5h5" />
                          </svg>
                        </button>
                      )}
                      {/* Checkpoint Branch Button */}
                      {msg.checkpoint && (
                        <button
                          type="button"
                          onClick={() => {
                            vscodeApi?.postMessage({
                              command: 'branchFromCheckpoint',
                              checkpointId: msg.checkpoint.id
                            });
                          }}
                          className="p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors cursor-pointer"
                          title={`Branch conversation from Checkpoint #${msg.checkpoint.stepNumber || msg.checkpoint.id.substring(0, 8)}`}
                        >
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="6" y1="3" x2="6" y2="15"></line>
                            <circle cx="18" cy="6" r="3"></circle>
                            <circle cx="6" cy="18" r="3"></circle>
                            <path d="M18 9a9 9 0 0 1-9 9"></path>
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-end gap-2 opacity-0 group-hover/message:opacity-100 transition-opacity duration-150 mt-1 select-none pr-1">
                    {msg.timestamp && (
                      <span className="text-[10px] text-zinc-500 font-mono">
                        {msg.timestamp}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        navigator.clipboard.writeText(msg.text || '');
                        const btn = e.currentTarget;
                        const originalSvg = btn.innerHTML;
                        btn.innerHTML = `<svg class="w-3.5 h-3.5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
                        setTimeout(() => { btn.innerHTML = originalSvg; }, 1500);
                      }}
                      className="p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors cursor-pointer"
                      title="Copy"
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                      </svg>
                    </button>
                  </div>
                )}
              </div>
                );
              })()}

            {/* INLINE APPROVAL CARDS (GLASSMORPHIC & SOLID) */}
            {msg.isCommandApproval && (
              <div className="mt-2 w-full backdrop-blur-xl bg-zinc-900/80 border border-white/10 p-3.5 rounded-xl shadow-2xl space-y-3 select-none transition-all duration-300">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 bg-zinc-800 border border-white/25 rounded-lg text-zinc-100 flex items-center justify-center shadow-md">
                      <TerminalCommandIcon status="running" className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="text-[12.5px] font-semibold text-zinc-100 block leading-tight">
                        Terminal Execution Request
                      </span>
                      <span className="text-[10px] text-zinc-400 font-mono">
                        Host process requires approval
                      </span>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded bg-zinc-800 text-zinc-200 border border-white/10">
                    Review Required
                  </span>
                </div>

                <div className="relative bg-zinc-950/90 p-3 rounded-lg border border-white/5 font-mono text-[11.5px] leading-relaxed text-zinc-100 select-all overflow-x-auto whitespace-pre max-h-28 scrollbar-thin">
                  <span className="text-zinc-500 font-bold select-none mr-2">$</span>
                  {msg.commandToApprove}
                </div>

                <div className="flex items-center gap-2 w-full pt-0.5">
                  <button
                    aria-label="Approve command execution"
                    onClick={() => handleApproveCommand(msg.approvalId!, true)}
                    className="flex-1 py-2 px-3 bg-zinc-100 hover:bg-white text-zinc-900 font-semibold text-[12px] rounded-lg shadow-sm transition-all duration-150 active:scale-[0.98] flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                    Approve & Run
                  </button>
                  <button
                    aria-label="Reject command execution"
                    onClick={() => handleApproveCommand(msg.approvalId!, false)}
                    className="py-2 px-3 bg-zinc-800/80 hover:bg-zinc-700/80 text-zinc-200 hover:text-white border border-white/10 text-[12px] font-medium rounded-lg transition-all duration-150 active:scale-[0.98] cursor-pointer"
                  >
                    Reject
                  </button>
                </div>
              </div>
            )}

            {msg.isFileApproval && (
              <div className="mt-2 w-full backdrop-blur-xl bg-zinc-900/80 border border-white/10 p-3.5 rounded-xl shadow-2xl space-y-3 select-none transition-all duration-300">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 bg-zinc-800 border border-white/25 rounded-lg text-zinc-100 flex items-center justify-center shadow-md">
                      <CodeEditIcon status="running" className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="text-[12.5px] font-semibold text-zinc-100 block leading-tight">
                        File Modification Request
                      </span>
                      <span className="text-[10px] text-zinc-400 font-mono capitalize">
                        Action: {msg.fileChangeType}
                      </span>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded bg-zinc-800 text-zinc-200 border border-white/10">
                    Pending Diff
                  </span>
                </div>

                <div className="bg-zinc-950/90 p-2.5 rounded-lg border border-white/5 text-[11px] font-mono text-zinc-200 flex items-center gap-2">
                  <span className="text-zinc-500">Path:</span>
                  <span className="text-zinc-100 font-medium truncate">{msg.filePathToApprove}</span>
                </div>

                {msg.fileDetailsToApprove && (
                  <div className="bg-zinc-950/50 p-2.5 rounded-lg border border-white/5 text-[10.5px] text-zinc-300">
                    {msg.fileDetailsToApprove}
                  </div>
                )}

                <button
                  onClick={() => vscodeApi?.postMessage({ command: 'openSpeculativeDiff', filePath: msg.filePathToApprove })}
                  className="w-full py-2 px-3 bg-zinc-800/60 hover:bg-zinc-800 text-zinc-200 hover:text-white border border-white/10 text-[11px] font-medium rounded-lg transition-all duration-150 flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="20" x2="18" y2="10"></line>
                    <line x1="12" y1="20" x2="12" y2="4"></line>
                    <line x1="6" y1="20" x2="6" y2="14"></line>
                  </svg>
                  View Native Diff Tab
                </button>

                <div className="flex items-center gap-2 w-full pt-0.5">
                  <button
                    aria-label="Approve file edit"
                    onClick={() => handleApproveFile(msg.approvalId!, true)}
                    className="flex-1 py-2 px-3 bg-zinc-100 hover:bg-white text-zinc-900 font-semibold text-[12px] rounded-lg shadow-sm transition-all duration-150 active:scale-[0.98] flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                    Approve Edit
                  </button>
                  <button
                    aria-label="Reject file edit"
                    onClick={() => handleApproveFile(msg.approvalId!, false)}
                    className="py-2 px-3 bg-zinc-800/80 hover:bg-zinc-700/80 text-zinc-200 hover:text-white border border-white/10 text-[12px] font-medium rounded-lg transition-all duration-150 active:scale-[0.98] cursor-pointer"
                  >
                    Reject
                  </button>
                </div>
              </div>
            )}

            {msg.isPlanReview && (
              <div className="mt-2 w-full backdrop-blur-xl bg-zinc-900/80 border border-white/10 p-3.5 rounded-xl shadow-2xl space-y-3 select-none transition-all duration-300">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 bg-zinc-800 border border-white/25 rounded-lg text-zinc-100 flex items-center justify-center shadow-md">
                      <PlanIcon status="running" className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="text-[12.5px] font-semibold text-zinc-100 block leading-tight">
                        Implementation Plan Review
                      </span>
                      <span className="text-[10px] text-zinc-400 font-mono">
                        Generated plan opened in editor tab
                      </span>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded bg-zinc-800 text-zinc-200 border border-white/10">
                    Plan Ready
                  </span>
                </div>

                <div className="flex items-center gap-2 w-full pt-1">
                  <button
                    aria-label="Review plan again"
                    onClick={() => vscodeApi?.postMessage({ command: 'reviewPlanAgain' })}
                    className="py-2 px-3 bg-zinc-800/60 hover:bg-zinc-800 text-zinc-200 hover:text-white border border-white/10 text-[12px] font-medium rounded-lg transition-all duration-150 cursor-pointer"
                  >
                    View Plan
                  </button>
                  <button
                    aria-label="Approve plan"
                    onClick={() => handlePlanApproval?.(true)}
                    className="flex-1 py-2 px-3 bg-zinc-100 hover:bg-white text-zinc-900 font-semibold text-[12px] rounded-lg shadow-sm transition-all duration-150 active:scale-[0.98] flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    Proceed
                  </button>
                  <button
                    aria-label="Reject plan"
                    onClick={() => handlePlanApproval?.(false)}
                    className="py-2 px-3 bg-zinc-800/80 hover:bg-zinc-700/80 text-zinc-200 hover:text-white border border-white/10 text-[12px] font-medium rounded-lg transition-all duration-150 active:scale-[0.98] cursor-pointer"
                  >
                    Reject
                  </button>
                </div>
              </div>
            )}

          </div>
          );
        })}



        <div ref={chatEndRef} />
        </div>
      </div>

      {/* Full-Screen Review Modal */}
      {showReviewModal && (
        <div className="absolute inset-0 z-50 bg-[#1e1e1e] flex flex-col animate-in fade-in zoom-in-95 duration-200 shadow-2xl rounded-2xl overflow-hidden border border-white/5">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-white/10 shrink-0 bg-[#212121]">
            <div className="flex items-center gap-3">
              <button onClick={() => setShowReviewModal(false)} className="text-zinc-400 hover:text-white transition-colors" title="Close">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
              </button>
              <span className="text-sm font-semibold text-zinc-200">{speculativeDiffs.length} File{speculativeDiffs.length !== 1 ? 's' : ''} With Changes</span>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  speculativeDiffs.forEach(diff => {
                    if (vscodeApi) vscodeApi.postMessage({ command: 'rejectSpeculativeDiff', filePath: diff.path });
                  });
                  setSpeculativeDiffs([]);
                  setShowReviewModal(false);
                }}
                className="text-xs text-zinc-400 hover:text-white transition-colors"
              >
                Reject all
              </button>
              <button
                onClick={() => {
                  speculativeDiffs.forEach(diff => {
                    if (vscodeApi) vscodeApi.postMessage({ command: 'acceptSpeculativeDiff', filePath: diff.path });
                  });
                  setSpeculativeDiffs([]);
                  setShowReviewModal(false);
                }}
                className="bg-[#0078D4] hover:bg-[#106EBE] text-white text-xs font-medium px-3 py-1.5 rounded transition-colors"
              >
                Accept all
              </button>
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2 scrollbar-thin">
            {speculativeDiffs.map((diff, idx) => {
              const additions = diff.diffLines.filter(l => l.type === 'added').length;
              const deletions = diff.diffLines.filter(l => l.type === 'removed').length;
              const isExpanded = expandedDiffs[diff.path];

              return (
                <div key={idx} className="bg-[#2d2d2d] border border-white/5 rounded-lg overflow-hidden shrink-0">
                  <div
                    className="flex items-center justify-between p-3 cursor-pointer hover:bg-white/5 transition-colors"
                    onClick={() => setExpandedDiffs(prev => ({ ...prev, [diff.path]: !prev[diff.path] }))}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-[11px] font-mono text-zinc-300">{diff.path.split('/').pop()}</span>
                      <span className="text-[10px] font-mono text-zinc-500 truncate max-w-[200px]">{diff.path}</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="flex gap-2 text-[10px] font-mono">
                        {additions > 0 && <span className="text-emerald-400">+{additions}</span>}
                        {deletions > 0 && <span className="text-rose-400">-{deletions}</span>}
                      </div>
                      <svg className={`w-4 h-4 text-zinc-500 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path></svg>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="bg-[#1e1e1e] border-t border-white/5 p-3 overflow-x-auto text-[11px] font-mono whitespace-pre scrollbar-thin">
                      {diff.diffLines.map((line, lIdx) => (
                        <div key={lIdx} className={`
                          ${line.type === 'added' ? 'text-emerald-400 bg-emerald-950/30' : ''}
                          ${line.type === 'removed' ? 'text-rose-400 bg-rose-950/30' : ''}
                          ${line.type === 'unchanged' ? 'text-zinc-500' : ''}
                          px-2 py-0.5 rounded-sm
                        `}>
                          {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '} {line.text}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Slim Review Changes Bar */}
      {speculativeDiffs.length > 0 && !showReviewModal && (
        <div className="bg-[#2d2d2d] border border-white/5 rounded-lg flex items-center justify-between py-1.5 px-3 shadow-lg mb-2 shrink-0 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="flex items-center gap-2">
            <svg className="w-3.5 h-3.5 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
            <span className="text-[11px] font-mono text-zinc-300 flex items-center gap-1.5">
              <span className="flex gap-1 font-bold">
                <span className="text-emerald-400">+{speculativeDiffs.reduce((acc, d) => acc + d.diffLines.filter(l => l.type === 'added').length, 0)}</span>
                <span className="text-rose-400">-{speculativeDiffs.reduce((acc, d) => acc + d.diffLines.filter(l => l.type === 'removed').length, 0)}</span>
              </span>
              <span className="text-zinc-500 ml-1">{speculativeDiffs.length} File{speculativeDiffs.length !== 1 ? 's' : ''} With Changes</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                speculativeDiffs.forEach(diff => {
                  if (vscodeApi) vscodeApi.postMessage({ command: 'rejectSpeculativeDiff', filePath: diff.path });
                });
                setSpeculativeDiffs([]);
              }}
              className="text-[10px] text-zinc-400 hover:text-zinc-200 transition-colors pr-2"
            >
              Reject all
            </button>
            <button
              onClick={() => {
                speculativeDiffs.forEach(diff => {
                  if (vscodeApi) vscodeApi.postMessage({ command: 'acceptSpeculativeDiff', filePath: diff.path });
                });
                setSpeculativeDiffs([]);
              }}
              className="bg-[#0078D4] hover:bg-[#106EBE] text-white text-[10px] font-medium px-2 py-1 rounded transition-colors"
            >
              Accept all
            </button>
            <div className="w-px h-3 bg-zinc-700 mx-1"></div>
            <button
              onClick={() => setShowReviewModal(true)}
              className="text-zinc-400 hover:text-zinc-200 flex items-center gap-1 text-[10px]"
              title="Review Changes"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"></path></svg>
              Review
            </button>
          </div>
        </div>
      )}

      {/* INTERACTIVE INPUT CONTROL BOX */}
      <div className="w-full max-w-4xl mx-auto px-2 pb-1 shrink-0">
        <div
          onDragEnter={handleInputDragEnter}
          onDragOver={handleInputDragOver}
          onDragLeave={handleInputDragLeave}
          onDrop={handleDrop}
          className={`bg-[#1a1a1c] border rounded-2xl p-2.5 flex flex-col shadow-md shrink-0 transition-all relative ${
            isDraggingInput
              ? 'border-sky-400/70 ring-2 ring-sky-500/25 bg-[#1b222c]'
              : 'border-white/10 focus-within:border-sky-500/40 focus-within:ring-1 focus-within:ring-sky-500/20'
          }`}
        >
        {isDraggingInput && (
          <div className="pointer-events-none mb-1.5 flex items-center justify-center gap-1.5 py-1 px-2.5 rounded-lg bg-sky-500/10 border border-dashed border-sky-400/40 text-[11px] font-mono text-sky-300">
            <span>Drop file or editor tab to attach into prompt context</span>
          </div>
        )}

        {!autoScroll && (
          <div className="absolute bottom-32 right-4 z-10 flex flex-col gap-2">
            <button
              aria-label="Scroll to bottom"
              onClick={() => {
                setAutoScroll(true);
                chatEndRef.current?.scrollIntoView({ behavior: 'auto' });
              }}
              className="p-2 glass-btn rounded-full shadow-lg transition-all transform hover:scale-105 animate-fade-in"
            >
              ↓
            </button>
          </div>
        )}

        {/* Pre-empt Toast Overlay */}
        {isPreempting && (
          <div className="absolute inset-0 bg-[#1a1a1c] z-10 rounded-2xl flex items-center justify-center border border-emerald-500/30 shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-emerald-500/10 to-transparent -translate-x-full animate-[shimmer_1.5s_infinite]"></div>
            <p className="text-[10px] font-mono font-bold text-emerald-400 z-20 flex items-center gap-2">
              <span className="animate-pulse">⚡</span> Pre-empting context queue...
            </p>
          </div>
        )}

        <TextareaAutosize
          aria-label="Chat input"
          minRows={1}
          maxRows={8}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'copy';
          }}
          onDrop={handleDrop}
          onKeyDown={(e) => {
            const isCtrl = e.ctrlKey || e.metaKey;
            if (isCtrl && e.key) {
              const k = e.key.toLowerCase();
              if (['c', 'v', 'x', 'a', 'z', 'y'].includes(k)) {
                e.stopPropagation();
                if (k === 'a') {
                  e.currentTarget.select();
                }
                return;
              }
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSendMessage();
            }
          }}
          onPaste={(e) => {
            const items = e.clipboardData?.items;
            if (items) {
              for (let i = 0; i < items.length; i++) {
                if (items[i].type.startsWith('image/')) {
                  const file = items[i].getAsFile();
                  if (file) {
                    e.preventDefault();
                    const reader = new FileReader();
                    reader.onload = (event) => {
                      const dataUrl = event.target?.result as string;
                      if (setAttachedImages) {
                        setAttachedImages(prev => (prev.length < 3 ? [...prev, dataUrl] : prev));
                      }
                      if (vscodeApi) vscodeApi.postMessage({ command: 'log', text: 'Attached image from clipboard', logType: 'info' });
                    };
                    reader.readAsDataURL(file);
                    return;
                  }
                }
              }
            }
            e.stopPropagation();
          }}
          onCopy={(e) => e.stopPropagation()}
          onCut={(e) => e.stopPropagation()}
          placeholder={
            isAgentThinking
              ? "Astrolabe is thinking & analyzing..."
              : "Ask Astrolabe anything, or command it to build & edit code..."
          }
          className="w-full bg-transparent p-2 resize-none text-sm font-sans leading-relaxed text-zinc-100 placeholder:text-zinc-400 !outline-none !ring-0 !border-none focus:!outline-none focus:!ring-0 focus:!border-none scrollbar-thin shadow-none select-text cursor-text"
          style={{ boxShadow: 'none' }}
        />

        {selectedContextFiles.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-2 pb-2">
            {selectedContextFiles.map((file, idx) => (
              <div
                key={`${file.path || file.name}-${idx}`}
                title={file.path || file.name}
                className="inline-flex items-center gap-1.5 bg-zinc-900/90 border border-white/10 hover:border-sky-500/30 py-0.5 px-2 rounded-lg font-mono text-[11px] text-zinc-200 transition-colors"
              >
                <span className="text-sky-400">📄</span>
                <span className="truncate max-w-[200px]">{file.name}</span>
                <button
                  type="button"
                  aria-label={`Remove ${file.name} from context`}
                  onClick={() => setSelectedContextFiles((prev) => prev.filter((_, i) => i !== idx))}
                  className="text-zinc-500 hover:text-zinc-200 font-bold ml-0.5 cursor-pointer"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {attachedImages && attachedImages.length > 0 && (
          <div className="flex flex-wrap gap-2 px-2 pb-2">
            {attachedImages.map((img, idx) => (
              <div key={idx} className="relative group">
                <img src={img} alt="Attachment" className="w-12 h-12 rounded-lg border border-white/20 object-cover shadow-md" />
                <button
                  onClick={() => setAttachedImages && setAttachedImages(prev => prev.filter((_, i) => i !== idx))}
                  className="absolute -top-1.5 -right-1.5 glass-btn rounded-full w-4 h-4 flex items-center justify-center text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Remove image"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Tools Toolbar & Submit Button Row */}
        <div className="flex items-end justify-between gap-1.5 pt-1.5 mt-1 border-t border-white/5 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 text-zinc-300 min-w-0 flex-1">

            {/* Hidden File Input for Image Upload */}
            <input
              type="file"
              ref={fileInputRef}
              accept="image/*"
              className="hidden"
              onChange={handleImageSelect}
            />

            {/* Add Context Button (+) with Dropup Toolbox */}
            <div className="relative shrink-0">
              <button
                onClick={() => setShowToolbox(!showToolbox)}
                className={`w-7 h-7 flex items-center justify-center bg-white/5 hover:bg-white/10 border border-white/10 rounded-full transition-colors focus:outline-none ${showToolbox ? 'bg-white/20 text-white' : 'text-zinc-400 hover:text-white'}`}
                title="Add Context"
                aria-label="Add Context"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              </button>

              {/* Toolbox Dropup Menu */}
              {showToolbox && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowToolbox(false)}></div>
                  <div className="absolute bottom-full left-0 mb-2 w-48 glass-panel-dark rounded-xl shadow-2xl z-50 flex flex-col py-1 overflow-hidden animate-in fade-in slide-in-from-bottom-2">
                    <button
                      onClick={() => {
                        if (!isVisionSupported) {
                          if (vscodeApi) vscodeApi.postMessage({ command: 'log', text: 'The selected model does not support vision/image inputs.', logType: 'error' });
                          setShowToolbox(false);
                          return;
                        }
                        setShowToolbox(false);
                        fileInputRef.current?.click();
                      }}
                      className={`flex items-center gap-2 px-3 py-2 text-xs transition-colors text-left ${isVisionSupported ? 'text-zinc-200 hover:bg-white/10 hover:text-white' : 'text-zinc-500 cursor-not-allowed'}`}
                      title={!isVisionSupported ? "Not supported by current model" : "Upload Image"}
                    >
                      <span className={`flex items-center ${!isVisionSupported ? "opacity-50" : ""}`}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                      </span>
                      <span>Upload Image</span>
                    </button>
                    <button
                      onClick={() => {
                        setShowToolbox(false);
                        setInputValue(inputValue + (inputValue.length > 0 && !inputValue.endsWith(' ') ? ' @' : '@'));
                        document.querySelector('textarea')?.focus();
                      }}
                      className="flex items-center gap-2 px-3 py-2 text-xs text-zinc-200 hover:bg-white/10 hover:text-white transition-colors text-left"
                    >
                      <span className="flex items-center">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                      </span>
                      <span>Search File (@)</span>
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* Inspect UI Button */}
            <button
              onClick={() => {
                if (vscodeApi) vscodeApi.postMessage({ command: 'toggleInspector' });
              }}
              className={`w-7 h-7 shrink-0 flex items-center justify-center rounded-full transition-colors focus:outline-none ${inspectorActive ? 'bg-sky-500/20 text-sky-300 border border-sky-400/30' : 'bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-400 hover:text-white'}`}
              title={inspectorActive ? "Deactivate Inspector" : "Inspect UI Element"}
              aria-label="Inspect UI Element"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 9 5 12 1.8-5.2L21 14Z" /><path d="M7.2 2.2 8 5.1" /><path d="m5.1 8-2.9-.8" /><path d="M14 4.1 12 6" /><path d="m6 12-1.9 2" /></svg>
            </button>

            {/* Modern Model Selector */}
            <div className="group flex items-center min-w-[96px] max-w-[135px] min-[440px]:max-w-[180px] flex-1 min-[410px]:flex-initial">
              <div
                data-model-selector-trigger="true"
                className="flex items-center gap-1.5 min-[360px]:gap-2 px-2 min-[360px]:px-2.5 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full cursor-pointer transition-all active:scale-95 min-w-0 max-w-full"
                onClick={() => {
                  const nextState = !modelDropdownOpen;
                  setModelDropdownOpen(nextState);
                  setShowQuotaPopover(false);
                  if (nextState && vscodeApi) {
                    vscodeApi.postMessage({ command: 'getSettingsState' });
                  }
                }}
              >
                <div className={`w-2 h-2 shrink-0 rounded-full ${
                  isDiffusion
                    ? (activeDiffusionModel ? 'bg-cyan-400 animate-pulse shadow-sm shadow-cyan-400/50' : 'bg-zinc-600')
                    : (activeLocalModel ? 'bg-emerald-500' : 'bg-zinc-600')
                }`}></div>
                <span className={`text-[11px] font-semibold tracking-wide uppercase truncate min-w-0 ${
                  isDiffusion
                    ? (activeDiffusionModel ? 'text-zinc-100' : 'text-zinc-400')
                    : (activeLocalModel ? 'text-zinc-100' : 'text-zinc-400')
                }`} title={
                  isDiffusion
                    ? (activeDiffusionModel ? `${isVideoMode ? 'Video' : 'Diffusion'}: ${formatModelDisplayName(activeDiffusionModel)}` : (isVideoMode ? 'No Video Model' : 'No Image Model'))
                    : (activeLocalModel ? `Local: ${formatModelDisplayName(activeLocalModel)}` : 'No Model Loaded')
                }>
                  {isDiffusion
                    ? (activeDiffusionModel ? `${isVideoMode ? 'Video' : 'Diffusion'}: ${formatModelDisplayName(activeDiffusionModel)}${activeDiffusionResolution ? ` (${activeDiffusionResolution})` : ''}` : (isVideoMode ? 'No Video Model' : 'No Image Model'))
                    : (activeLocalModel ? `Local: ${formatModelDisplayName(activeLocalModel)}` : 'No Model Loaded')}
                </span>
                <svg className="w-3 h-3 text-zinc-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
              </div>
            </div>

            {/* Quota / Context Ring Widget */}
            {(() => {
              const eff = buildEffectiveHistory(messages);
              const tokenStats = computeThreadTokenStats(messages);
              return (
                <ContextMemoryPopover
                  open={showQuotaPopover}
                  onToggle={() => {
                    setShowQuotaPopover(!showQuotaPopover);
                    setModelDropdownOpen(false);
                  }}
                  onClose={() => setShowQuotaPopover(false)}
                  selectedModel={selectedModel}
                  currentContextTokens={currentContextTokens}
                  maxContextTokens={maxContextTokens}
                  tokenStats={tokenStats}
                  quotaInfo={quotaInfo}
                  isAgentThinking={isAgentThinking}
                  isCompactingContext={Boolean(isCompactingContext)}
                  hasCompactableContent={eff.hasCompactableContent}
                  isCompacted={eff.isCompacted}
                  onCompactContext={() => onCompactContext?.()}
                  onClearContext={() => onClearContext?.()}
                />
              );
            })()}

            {/* 3-Level Planning Mode Selector */}
            <div className="min-[360px]:relative shrink-0">
              <button
                type="button"
                aria-label="Planning Mode Selector"
                onClick={() => setPlanDropdownOpen(prev => !prev)}
                className={`flex items-center gap-1 min-[360px]:gap-1.5 px-2 min-[360px]:px-2.5 py-1 rounded-full text-[11px] font-medium transition-all cursor-pointer border ${
                  planLevel === 'strict'
                    ? 'bg-zinc-800/80 text-zinc-200 border-zinc-700 shadow-sm'
                    : planLevel === 'none'
                    ? 'bg-zinc-800/80 text-zinc-200 border-zinc-700 shadow-sm'
                    : 'bg-zinc-800/80 text-zinc-200 border-zinc-700 shadow-sm'
                }`}
                title="Select Planning Mode"
              >
                {planLevel === 'strict' ? (
                  <svg className="w-3 h-3 shrink-0 text-zinc-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/></svg>
                ) : planLevel === 'none' ? (
                  <svg className="w-3 h-3 shrink-0 text-zinc-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                ) : (
                  <svg className="w-3 h-3 shrink-0 text-zinc-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"/></svg>
                )}
                <span>{planLevel === 'strict' ? 'Plan' : planLevel === 'none' ? 'Direct' : 'Auto'}</span>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`transition-transform duration-150 text-zinc-400 ${planDropdownOpen ? 'rotate-180' : ''}`}><path d="m6 9 6 6 6-6"/></svg>
              </button>

              {planDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setPlanDropdownOpen(false)} />
                  <div className="absolute left-0 right-0 min-[360px]:left-auto min-[360px]:right-0 min-[360px]:w-56 bottom-full mb-2 bg-[#121217]/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl p-1 z-50 animate-in zoom-in-95 duration-150 font-sans">
                    <button
                      type="button"
                      onClick={() => {
                        setPlanLevel('none');
                        setPlanDropdownOpen(false);
                      }}
                      className={`w-full text-left p-2 rounded-lg transition-colors flex items-center justify-between cursor-pointer ${
                        planLevel === 'none' ? 'bg-white/10 text-white' : 'hover:bg-white/5 text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <svg className="w-3.5 h-3.5 shrink-0 text-zinc-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                        <div>
                          <div className="text-xs font-medium">Direct</div>
                          <div className="text-[10px] text-zinc-500">Execute immediately</div>
                        </div>
                      </div>
                      {planLevel === 'none' && (
                        <svg className="w-3.5 h-3.5 text-zinc-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7"/></svg>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setPlanLevel('auto');
                        setPlanDropdownOpen(false);
                      }}
                      className={`w-full text-left p-2 rounded-lg transition-colors flex items-center justify-between cursor-pointer ${
                        planLevel === 'auto' ? 'bg-white/10 text-white' : 'hover:bg-white/5 text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <svg className="w-3.5 h-3.5 shrink-0 text-zinc-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"/></svg>
                        <div>
                          <div className="text-xs font-medium">Auto</div>
                          <div className="text-[10px] text-zinc-500">Plan when needed</div>
                        </div>
                      </div>
                      {planLevel === 'auto' && (
                        <svg className="w-3.5 h-3.5 text-zinc-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7"/></svg>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setPlanLevel('strict');
                        setPlanDropdownOpen(false);
                      }}
                      className={`w-full text-left p-2 rounded-lg transition-colors flex items-center justify-between cursor-pointer ${
                        planLevel === 'strict' ? 'bg-white/10 text-white' : 'hover:bg-white/5 text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <svg className="w-3.5 h-3.5 shrink-0 text-zinc-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/></svg>
                        <div>
                          <div className="text-xs font-medium">Plan</div>
                          <div className="text-[10px] text-zinc-500">Require plan approval</div>
                        </div>
                      </div>
                      {planLevel === 'strict' && (
                        <svg className="w-3.5 h-3.5 text-zinc-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7"/></svg>
                      )}
                    </button>
                  </div>
                </>
              )}
            </div>

          </div>

          {/* Submit / Stop Button */}
          {isAgentThinking ? (
            <button
              onClick={() => {
                if (stopClicks === 0) {
                  setStopClicks(1);
                } else {
                  setStopClicks(0);
                  if (vscodeApi) vscodeApi.postMessage({ command: 'cancelAgent' });
                }
              }}
              className={`w-8 h-8 flex items-center justify-center shrink-0 transition-all rounded-full ${stopClicks === 1
                ? 'bg-amber-500 hover:bg-amber-600 text-black animate-pulse shadow-[0_0_15px_rgba(245,158,11,0.5)]'
                : 'bg-red-600 hover:bg-red-500 text-white'
                }`}
              title={stopClicks === 1 ? 'Confirm Stop' : 'Stop Agent'}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12"></rect></svg>
            </button>
          ) : (
            <button
              aria-label="Submit message"
              onClick={() => handleSendMessage()}
              className="w-8 h-8 flex items-center justify-center shrink-0 rounded-full transition-all bg-sky-500 hover:bg-sky-400 text-white disabled:opacity-25 disabled:hover:bg-sky-500 shadow-sm"
              disabled={!inputValue.trim() && (!attachedImages || attachedImages.length === 0) && selectedContextFiles.length === 0}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
            </button>
          )}
        </div>
        <ModelSelectorPopover
          open={modelDropdownOpen}
          onClose={() => setModelDropdownOpen(false)}
          availableLocalModels={availableLocalModels}
          activeLocalModel={activeLocalModel}
          activeDiffusionModel={activeDiffusionModel}
          activeDiffusionModality={activeDiffusionModality}
          isDiffusion={isDiffusion}
          isVideoMode={isVideoMode}
          handleModelChange={handleModelChange}
          vscodeApi={vscodeApi}
        />
      </div>
      </div>

    </div>
  );
}
