import React from 'react';
import type { Message, VsCodeApi } from '../types';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import 'highlight.js/styles/atom-one-dark.css';
import TextareaAutosize from 'react-textarea-autosize';
import {
  ThinkIcon,
  ReadFileIcon,
  TerminalCommandIcon,
  CodeEditIcon,
  CodeSearchIcon,
  PlanIcon,
  LogIcon,
  StepStatusBadge
} from './icons/AnimatedToolIcons';

function TypewriterMarkdown({ content, chatEndRef, disableAnimation }: { content: string; chatEndRef?: React.RefObject<HTMLDivElement | null>, disableAnimation?: boolean }) {
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
        rehypePlugins={[rehypeHighlight]}
        components={{
          h1: ({ children }) => <h1 className="text-base font-bold text-white mt-4 mb-2 pb-1 border-b border-white/10">{children}</h1>,
          h2: ({ children }) => <h2 className="text-sm font-bold text-white mt-3 mb-1.5 pb-0.5 border-b border-white/5">{children}</h2>,
          h3: ({ children }) => <h3 className="text-[13px] font-semibold text-zinc-100 mt-2.5 mb-1">{children}</h3>,
          h4: ({ children }) => <h4 className="text-xs font-semibold text-zinc-200 mt-2 mb-1">{children}</h4>,
          p: ({ children }) => <p className="text-[13px] leading-relaxed mb-2.5 last:mb-0 text-zinc-300 font-sans">{children}</p>,
          ul: ({ children }) => <ul className="list-disc list-inside space-y-1 my-2 text-[13px] text-zinc-300 pl-1">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal list-inside space-y-1 my-2 text-[13px] text-zinc-300 pl-1">{children}</ol>,
          li: ({ children }) => <li className="text-[13px] leading-relaxed text-zinc-300">{children}</li>,
          blockquote: ({ children }) => <blockquote className="my-2.5 border-l-2 border-cyan-500/60 bg-zinc-900/60 py-1.5 px-3 rounded-r-md text-zinc-400 text-xs italic">{children}</blockquote>,
          table: ({ children }) => (
            <div className="my-2.5 overflow-x-auto rounded-lg border border-white/10 bg-zinc-950/60">
              <table className="w-full text-left text-xs border-collapse font-sans">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-zinc-900 border-b border-white/10 text-zinc-300 font-semibold uppercase text-[10px]">{children}</thead>,
          tbody: ({ children }) => <tbody className="divide-y divide-white/5 text-zinc-300">{children}</tbody>,
          tr: ({ children }) => <tr className="hover:bg-white/5 transition-colors">{children}</tr>,
          th: ({ children }) => <th className="px-3 py-2 font-medium">{children}</th>,
          td: ({ children }) => <td className="px-3 py-2 text-zinc-300">{children}</td>,
          hr: () => <hr className="my-4 border-white/10" />,
          code({ inline, className, children, ...props }: React.ComponentPropsWithoutRef<'code'> & { inline?: boolean; node?: unknown }) {
            const match = /language-(\w+)/.exec(className || '');
            return !inline && match ? (
              <div className="relative group mt-2 mb-2 border border-zinc-800 rounded-lg overflow-hidden bg-zinc-950">
                <div className="flex items-center justify-between bg-zinc-900 border-b border-zinc-800 px-3 py-1.5 select-none">
                  <span className="text-[9px] font-mono text-zinc-400 uppercase tracking-wider">{match[1]}</span>
                  <button
                    onClick={(e) => {
                      navigator.clipboard.writeText(String(children).replace(/\n$/, ''));
                      const btn = e.currentTarget;
                      btn.textContent = 'Copied!';
                      setTimeout(() => btn.textContent = 'Copy', 2000);
                    }}
                    className="text-[9px] text-zinc-500 hover:text-zinc-300 font-mono transition-colors cursor-pointer"
                  >
                    Copy
                  </button>
                </div>
                <div className="p-3 overflow-x-auto scrollbar-thin text-[11px] font-mono">
                  <code className={className} {...props}>
                    {children}
                  </code>
                </div>
              </div>
            ) : (
              <code className="bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-800 text-purple-300 font-mono text-[10.5px]" {...props}>
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


  selectedContextFiles: Array<{ name: string; type: string }>;
  setSelectedContextFiles: React.Dispatch<React.SetStateAction<Array<{ name: string; type: string }>>>;
  speculativeDiffs: Array<{ path: string; diffLines: Array<{ type: 'added' | 'removed' | 'unchanged'; text: string }> }>;
  setSpeculativeDiffs: React.Dispatch<React.SetStateAction<Array<{ path: string; diffLines: Array<{ type: 'added' | 'removed' | 'unchanged'; text: string }> }>>>;
  planLevel: 'none' | 'auto' | 'strict';
  setPlanLevel: (val: 'none' | 'auto' | 'strict') => void;
  vscodeApi?: VsCodeApi;
  chatEndRef: React.RefObject<HTMLDivElement | null>;
  activeEditorFile?: string;
  isPreempting?: boolean;
  handlePlanApproval?: (approved: boolean) => void;
  selectedModel?: string;
  inspectorActive?: boolean;
  handleModelChange?: (model: string) => void;
  attachedImages?: string[];
  setAttachedImages?: React.Dispatch<React.SetStateAction<string[]>>;
  quotaInfo?: { usedPercentage: number, dailyLimit: number, tokensUsed: number, currentTier: string, modelsUsed: string[], resetsIn: string } | null;
  activeLocalModel?: string;
  currentContextTokens?: number;
  maxContextTokens?: number;
}




function TaskProgressCard({ msg }: { msg: Message }) {
  // 1. Robust Working State Detection
  const hasTimeline = Boolean(msg.timeline && msg.timeline.length > 0);
  const hasRunningTimelineEvent = Boolean(hasTimeline && msg.timeline?.some((e: any) => e.status === 'running' || e.status === 'pending'));
  const hasRunningPlanStep = Boolean(msg.planSteps && msg.planSteps.some((s: any) => s.status === 'running' || s.status === 'pending'));
  
  // Active if message is not ended yet or has running events
  const isWorking = !msg.endTime && (hasRunningTimelineEvent || hasRunningPlanStep || !msg.text);

  // 2. Robust Error Detection across Timeline Events and Plan Steps
  const hasFailedEvent = Boolean(hasTimeline && msg.timeline?.some((e: any) => 
    e.status === 'failed' || 
    e.status === 'error' ||
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

  const hasFailedPlanStep = Boolean(msg.planSteps && msg.planSteps.some((s: any) => s.status === 'failed'));
  const hasError = hasFailedEvent || hasFailedPlanStep;

  // 3. Card Collapsed State
  // Card is EXPANDED while actively working, AUTOMATICALLY COLLAPSED when finished or errored
  const [isCollapsed, setIsCollapsed] = React.useState(!isWorking);

  React.useEffect(() => {
    if (isWorking) {
      setIsCollapsed(false); // Stay expanded while agent is actively working
    } else {
      setIsCollapsed(true);  // Automatically collapse when finished or errored
    }
  }, [isWorking, msg.endTime]);

  // 4. Progress Calculations
  const timelineCount = msg.timeline ? msg.timeline.length : 0;
  const completedTimelineCount = msg.timeline ? msg.timeline.filter((e: any) => e.status === 'success' || e.status === 'done').length : 0;
  const failedTimelineCount = msg.timeline ? msg.timeline.filter((e: any) => 
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
          <StepStatusBadge status={isWorking ? 'running' : hasError ? 'failed' : 'success'} />
          <span className={`text-[12px] font-bold ${isWorking ? 'glass-text-reflection text-cyan-200' : hasError ? 'text-rose-400' : 'text-emerald-400'}`}>
            {isWorking 
              ? 'Task in progress' 
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
            const renderEventIcon = () => {
              if (event.type === 'think') return <ThinkIcon status={status} />;
              if (event.type === 'log') return <LogIcon status={status} />;
              const tool = (event.toolName || '').toLowerCase();
              if (tool.includes('command') || tool.includes('terminal')) return <TerminalCommandIcon status={status} />;
              if (tool.includes('search') || tool.includes('grep') || tool.includes('find')) return <CodeSearchIcon status={status} />;
              if (tool.includes('patch') || tool.includes('edit') || tool.includes('replace') || tool.includes('create') || tool.includes('write')) return <CodeEditIcon status={status} />;
              if (tool.includes('view') || tool.includes('read') || tool.includes('dir') || tool.includes('list')) return <ReadFileIcon status={status} />;
              return <ReadFileIcon status={status} />;
            };

            return (
              <details key={event.id} className="group relative z-10 animate-in fade-in slide-in-from-left-2 duration-300" open={event.status === 'running'}>
                <summary className={`flex items-center gap-3 py-2 cursor-pointer list-none select-none hover:bg-white/10 transition-colors rounded-lg px-2 -ml-2 ${event.status === 'running' ? 'bg-zinc-800/60 border border-white/30 shadow-sm' : ''}`}>
                  <div className="w-6 h-6 shrink-0 flex items-center justify-center rounded-md bg-zinc-800 border border-white/25 shadow-md relative text-zinc-100">
                    {renderEventIcon()}
                  </div>
                  <span className={`text-[12px] shrink-0 uppercase tracking-wider font-bold ${event.status === 'running' ? 'glass-text-reflection text-cyan-200' : 'text-zinc-100'}`}>
                    {event.title}
                  </span>
                  <div className="flex-1 flex items-center justify-between min-w-0">
                    <span className="text-[11px] truncate font-mono flex-1 flex flex-col justify-center">
                    {event.type === 'think' && event.status === 'running' ? (
                      <div className="flex flex-col gap-1 w-full pr-4 py-1">
                        <span className="glass-text-cyan text-[11.5px] font-semibold">Thinking & Planning...</span>
                        <div className="w-full h-0.5 bg-zinc-800/80 rounded-full overflow-hidden">
                          <div className="w-full h-full bg-cyan-500/50 animate-pulse"></div>
                        </div>
                      </div>
                    ) : event.type === 'tool' && event.status === 'running' ? (
                      <div className="flex flex-col gap-1 w-full pr-4 py-1">
                        <span className="glass-text-cyan text-[11.5px] font-semibold">
                          {(() => {
                            try {
                              const payload = JSON.parse(event.content || '{}');
                              const file = payload.TargetFile || payload.relativePath || payload.AbsolutePath || payload.SearchPath || payload.DirectoryPath || payload.Cwd;
                              if (file) return `Accessing ${file.split('/').pop()}...`;
                            } catch { /* ignore JSON parsing error */ }
                            return `Executing ${event.toolName}...`;
                          })()}
                        </span>
                        <div className="w-full h-0.5 bg-zinc-800/80 rounded-full overflow-hidden">
                          <div className="w-full h-full bg-cyan-400/60 animate-pulse"></div>
                        </div>
                      </div>
                    ) : event.type === 'tool' ? (
                      <span className="text-zinc-300 font-mono text-[11px]">
                        {(() => {
                          try {
                            const payload = JSON.parse(event.content || '{}');
                            const file = payload.TargetFile || payload.relativePath || payload.AbsolutePath || payload.SearchPath || payload.DirectoryPath || payload.Cwd;
                            if (file) return `[${event.toolName}] ${file.split('/').pop()}`;
                          } catch { /* ignore JSON parsing error */ }
                          return event.content?.substring(0, 40);
                        })()}
                      </span>
                    ) : ''}
                  </span>
                  <span className="transform transition-transform duration-200 group-open:rotate-180 text-[11px] text-zinc-400 ml-2">
                    ↓
                  </span>
                </div>
              </summary>
              <div className="pl-[26px] pb-3 pr-2 pt-1">
                {event.type === 'think' ? (
                  <div className="text-[11.5px] leading-[1.65] text-zinc-200 font-sans whitespace-pre-wrap pl-1">
                    {event.content?.replace(/<\/?[a-zA-Z0-9_|-]+[^>]*>/gi, '').trim()}
                  </div>
                ) : event.type === 'log' ? (
                  event.content?.includes('❌') || event.content?.includes('Failed') || event.content?.includes('SYNTAX ERROR') ? (
                    <div className="bg-rose-950/40 border border-rose-800/60 rounded-xl p-3 text-[11.5px] font-mono text-rose-200 overflow-x-auto whitespace-pre-wrap leading-relaxed shadow-lg">
                      <div className="flex items-center gap-1.5 mb-1 text-rose-300 font-bold text-xs">
                        <span>⚠️ Error Diagnostic</span>
                      </div>
                      {event.content}
                    </div>
                  ) : (
                    <div className="bg-zinc-800/80 border border-white/15 rounded-xl p-2.5 text-[11px] font-mono text-zinc-200 overflow-x-auto whitespace-pre-wrap shadow-sm">
                      {event.content}
                    </div>
                  )
                ) : (() => {
                  let parsed: any = {};
                  try {
                    parsed = JSON.parse(event.content || '{}');
                  } catch {
                    parsed = { raw: event.content };
                  }

                  const isCommand = event.toolName === 'runCommand' || event.toolName === 'run_command' || parsed.CommandLine || parsed.command;
                  const commandText = parsed.CommandLine || parsed.command || (typeof event.content === 'string' ? event.content : '');
                  const filePath = parsed.TargetFile || parsed.relativePath || parsed.AbsolutePath || parsed.SearchPath || parsed.DirectoryPath || parsed.Cwd;

                  return (
                    <div className="bg-zinc-900 border border-white/20 rounded-xl overflow-hidden shadow-lg transition-all">
                      {/* Window Header */}
                      <div className="bg-zinc-800 px-3 py-1.5 border-b border-white/15 flex items-center justify-between select-none gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="w-2 h-2 rounded-full bg-zinc-600"></span>
                            <span className="w-2 h-2 rounded-full bg-zinc-600"></span>
                            <span className="w-2 h-2 rounded-full bg-zinc-600"></span>
                          </div>
                          <span className="text-[12px] font-mono font-bold text-zinc-100 uppercase tracking-wider pl-1 shrink-0">
                            {event.toolName || 'Tool Call'}
                          </span>
                          {filePath && (
                            <span className="text-[11px] font-mono bg-zinc-700/80 text-zinc-200 px-2 py-0.5 rounded border border-white/10 truncate max-w-[140px]" title={filePath}>
                              {filePath.split('/').pop()}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded uppercase tracking-wider ${event.status === 'running' ? 'bg-cyan-950 text-cyan-200 border border-cyan-700/50' : event.status === 'failed' ? 'bg-rose-950 text-rose-200 border border-rose-700/50' : 'bg-emerald-950 text-emerald-200 border border-emerald-700/50'}`}>
                            {event.status === 'running' ? 'Running' : event.status === 'failed' ? 'Failed' : 'Exit 0'}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              const textToCopy = isCommand ? commandText : (event.output || event.content || '');
                              navigator.clipboard.writeText(textToCopy);
                              const btn = e.currentTarget;
                              const oldText = btn.textContent;
                              btn.textContent = 'Copied!';
                              setTimeout(() => btn.textContent = oldText, 1800);
                            }}
                            className="text-[11px] font-mono text-zinc-300 hover:text-white bg-zinc-700/80 hover:bg-zinc-700 px-2 py-0.5 rounded border border-white/10 transition-colors cursor-pointer"
                          >
                            Copy
                          </button>
                        </div>
                      </div>

                      {/* Command / Input Payload Bar */}
                      {isCommand ? (
                        <div className="p-3 bg-zinc-850 border-b border-white/10 font-mono text-[11.5px] leading-relaxed text-zinc-100 select-all overflow-x-auto whitespace-pre">
                          <span className="text-zinc-400 font-bold select-none mr-2">$</span>
                          {commandText}
                        </div>
                      ) : filePath ? (
                        <div className="p-2.5 bg-zinc-850 border-b border-white/10 font-mono text-[11px] text-zinc-200 flex flex-wrap gap-2 items-center">
                          <span className="text-zinc-400 font-semibold">Path:</span>
                          <span className="text-zinc-100 font-medium select-all">{filePath}</span>
                        </div>
                      ) : null}

                      {/* Execution Output Console (Grayish slate & scrollable) */}
                      {event.output ? (
                        <div className="p-3 bg-zinc-900/90 max-h-56 min-h-[48px] overflow-y-auto overflow-x-auto scrollbar-thin select-all font-mono text-[11px] leading-relaxed text-zinc-200 whitespace-pre">
                          {event.output}
                        </div>
                      ) : !isCommand && event.content && event.content !== '{}' ? (
                        <div className="p-3 bg-zinc-900/90 max-h-56 min-h-[40px] overflow-y-auto overflow-x-auto scrollbar-thin select-all font-mono text-[11px] leading-relaxed text-zinc-200 whitespace-pre">
                          {(() => {
                            try {
                              return JSON.stringify(parsed, null, 2);
                            } catch {
                              return event.content;
                            }
                          })()}
                        </div>
                      ) : event.status === 'running' ? (
                        <div className="p-2.5 bg-zinc-900/90 font-mono text-[11px] text-zinc-300 flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
                          <span>Executing in background sandbox...</span>
                        </div>
                      ) : (
                        <div className="p-2.5 bg-zinc-900/90 font-mono text-[10.5px] text-zinc-400 italic">
                          Execution completed with no output.
                        </div>
                      )}
                    </div>
                  );
                })()}
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
  let name = modelStr.replace(/^local:/i, '');
  const parts = name.split(/[\\/]/);
  name = parts[parts.length - 1] || name;
  name = name.replace(/\.gguf$/i, '');
  return name;
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
  activeEditorFile,
  isPreempting,
  handlePlanApproval,
  selectedModel,
  inspectorActive,
  handleModelChange,
  attachedImages,
  setAttachedImages,
  quotaInfo,
  activeLocalModel,
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

  const [showContextInput, setShowContextInput] = React.useState(false);
  const [contextInputText, setContextInputText] = React.useState('');
  const [keepLastNTurns, setKeepLastNTurns] = React.useState<number>(3);
  const [showToolbox, setShowToolbox] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const isVisionSupported = !(
    selectedModel?.startsWith('deepseek') ||
    selectedModel?.startsWith('mimo') ||
    selectedModel?.startsWith('Qwen') ||
    selectedModel?.startsWith('glm')
  );

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!isVisionSupported) {
      if (vscodeApi) vscodeApi.postMessage({ command: 'log', text: '⚠️ The selected model does not support vision/image inputs.', logType: 'error' });
      return;
    }
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      if (vscodeApi) vscodeApi.postMessage({ command: 'log', text: '⚠️ Invalid format. Only standard images are allowed (no videos or documents).', logType: 'error' });
      return;
    }

    if (file.size > 5 * 1024 * 1024) { // 5MB limit
      if (vscodeApi) vscodeApi.postMessage({ command: 'log', text: '⚠️ Image too large. Please select an image under 5MB.', logType: 'error' });
      return;
    }

    if (attachedImages && attachedImages.length >= 3) {
      if (vscodeApi) vscodeApi.postMessage({ command: 'log', text: '⚠️ Maximum of 3 images can be attached per message.', logType: 'warning' });
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
        if (vscodeApi) vscodeApi.postMessage({ command: 'log', text: `📸 Attached image: ${file.name} (Resized)`, logType: 'info' });
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
    setShowToolbox(false);
  };

  return (
    <div className="flex-1 flex flex-col gap-3 min-h-0 justify-between relative">

      {/* UPSIDE EMPTY PLACE: CONTEXT PICKER HEADER */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-zinc-900/50 pb-2 bg-zinc-950/20 pt-1 px-1 rounded-t-xl shrink-0">
        <span className="text-[8px] font-mono text-zinc-500 uppercase tracking-wider pl-1">
          Context:
        </span>

        {/* Active Editor Indicator */}
        {activeEditorFile && (
          <div className="flex items-center gap-1.5 bg-purple-900/20 border border-purple-800/40 py-0.5 px-1.5 rounded-md font-mono text-[9px] text-purple-300 shadow-[0_0_10px_rgba(168,85,247,0.05)]">
            <span className="w-1.5 h-1.5 bg-purple-500 rounded-full animate-pulse"></span>
            <span>Active: {activeEditorFile}</span>
          </div>
        )}

        {selectedContextFiles.map((file, idx) => (
          <div
            key={idx}
            className="flex items-center gap-1 bg-zinc-950 border border-zinc-850 py-0.5 px-1.5 rounded font-mono text-[9px] text-zinc-400"
          >
            <span>📄 {file.name}</span>
            <button
              aria-label={`Remove ${file.name} from context`}
              onClick={() => setSelectedContextFiles(prev => prev.filter((_, i) => i !== idx))}
              className="text-[9px] text-zinc-600 hover:text-zinc-400 font-bold ml-0.5"
            >
              ×
            </button>
          </div>
        ))}

        {showContextInput ? (
          <div className="flex items-center gap-1.5 bg-zinc-950 border border-zinc-800 py-0.5 px-1.5 rounded font-mono text-[9px]">
            <input
              autoFocus
              type="text"
              value={contextInputText}
              onChange={(e) => setContextInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && contextInputText.trim()) {
                  setSelectedContextFiles(prev => [...prev, { name: contextInputText.trim(), type: 'code' }]);
                  setContextInputText('');
                  setShowContextInput(false);
                } else if (e.key === 'Escape') {
                  setShowContextInput(false);
                }
              }}
              placeholder="filename.ts..."
              className="bg-transparent text-zinc-300 outline-none w-24"
            />
            <button aria-label="Close context input" onClick={() => setShowContextInput(false)} className="text-zinc-500 hover:text-zinc-300">×</button>
          </div>
        ) : (
          <button
            aria-label="Add Context File"
            onClick={() => setShowContextInput(true)}
            className="bg-zinc-950 hover:bg-zinc-800 border border-zinc-850 text-zinc-500 hover:text-zinc-300 py-0.5 px-1.5 rounded font-mono text-[9px] font-bold"
          >
            + Add
          </button>
        )}
      </div>

      {/* INTERACTIVE CHAT THREAD (FEED) */}
      <div
        role="log"
        aria-live="polite"
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto space-y-4 pr-1 min-h-0 border border-zinc-900/50 bg-zinc-950/20 p-3 rounded-b-2xl shadow-inner scrollbar-thin"
      >
        {messages.map((msg, idx) => (
          <div
            key={msg.id}
            className={`flex flex-col max-w-[90%] ${msg.sender === 'user' ? 'ml-auto items-end' : 'mr-auto items-start'
              }`}
          >
            {/* Thinking/Working Components (Distinct from Chat Response) */}
            {msg.sender === 'agent' && msg.timeline && msg.timeline.length > 0 && (
              <TaskProgressCard msg={msg} />
            )}
            
            {msg.sender === 'agent' && !msg.text && (!msg.timeline || msg.timeline.length === 0) && isAgentThinking && (() => {
              const radius = 10;
              const circumference = 2 * Math.PI * radius;
              const hasProgress = msg.promptTokens !== undefined && msg.promptTokens > 0;
              const percent = hasProgress && msg.promptProcessed !== undefined
                ? Math.min(100, Math.max(0, Math.round((msg.promptProcessed / msg.promptTokens!) * 100)))
                : 0;
              const dashoffset = circumference - (percent / 100) * circumference;

              return (
                <div className="py-2 px-3 my-1.5 flex items-center gap-3 bg-zinc-900/40 border border-white/5 rounded-xl text-zinc-300 font-mono text-[11px] backdrop-blur-sm shadow-sm animate-in fade-in duration-200">
                  <div className="relative flex items-center justify-center w-6 h-6 shrink-0">
                    <svg className="w-6 h-6 transform -rotate-90" viewBox="0 0 26 26">
                      {/* Background Track */}
                      <circle
                        cx="13"
                        cy="13"
                        r={radius}
                        stroke="currentColor"
                        strokeWidth="2"
                        className="text-zinc-800"
                        fill="none"
                      />
                      {/* Animated Progress Ring */}
                      <circle
                        cx="13"
                        cy="13"
                        r={radius}
                        stroke="currentColor"
                        strokeWidth="2"
                        className="text-zinc-300 transition-all duration-150 ease-out"
                        fill="none"
                        strokeDasharray={circumference}
                        strokeDashoffset={hasProgress ? dashoffset : circumference * 0.75}
                        strokeLinecap="round"
                      />
                    </svg>
                    <span className="absolute text-[8px] font-medium text-zinc-300 font-mono">
                      {hasProgress ? `${percent}%` : ''}
                    </span>
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="font-medium text-zinc-200 flex items-center gap-1.5">
                      <span>Processing Prompt & Context</span>
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-zinc-400 animate-pulse"></span>
                    </span>
                    {hasProgress ? (
                      <span className="text-[9px] text-zinc-400 truncate">
                        Ingesting <span className="text-zinc-200 font-medium">{msg.promptProcessed?.toLocaleString() || 0}</span> / <span className="text-zinc-200 font-medium">{msg.promptTokens?.toLocaleString()}</span> tokens <span className="text-zinc-400">({percent}%)</span> into GPU...
                      </span>
                    ) : (
                      <span className="text-[9px] text-zinc-500">Preparing inference engine...</span>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Final Response Chat Bubble */}
            {(msg.text || (msg.images && msg.images.length > 0)) && (
              <div className="relative group/message w-full">
                <div
                  className={`py-2 px-1 text-sm leading-relaxed font-sans transition-all duration-150 markdown-body select-text ${msg.sender === 'user'
                    ? 'bg-zinc-900/50 border border-zinc-800/50 rounded-xl px-4 py-3'
                    : 'text-zinc-200 bg-transparent'
                    }`}
                >
                  {msg.images && msg.images.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-2">
                      {msg.images.map((imgData, idx) => (
                        <img key={idx} src={imgData} alt="Attached" className="max-h-32 rounded-md border border-zinc-800 object-contain" />
                      ))}
                    </div>
                  )}
                  {msg.text && !msg.isCommandApproval && !msg.isFileApproval && !msg.isPlanReview && (msg.sender === 'agent' ? (
                    <TypewriterMarkdown content={msg.text} chatEndRef={chatEndRef} disableAnimation={Boolean(msg.isHistory || msg.endTime || idx < messages.length - 1)} />
                  ) : (
                    <div className="text-zinc-200 text-[13px] leading-relaxed">
                      <ReactMarkdown
                        components={{
                          p: ({ children }) => <p className="mb-1.5 last:mb-0 text-zinc-200">{children}</p>,
                          code: ({ inline, className, children, ...props }: React.ComponentPropsWithoutRef<'code'> & { inline?: boolean; node?: unknown }) => (
                            <code className="bg-zinc-800/80 px-1.5 py-0.5 rounded border border-white/5 text-purple-300 font-mono text-[10.5px]" {...props}>
                              {children}
                            </code>
                          )
                        }}
                      >
                        {msg.text}
                      </ReactMarkdown>
                    </div>
                  ))}
                </div>

                {/* Sleek Floating Hover Toolbar (Completely hidden until cursor hovers over message card) */}
                {!msg.isCommandApproval && !msg.isFileApproval && !msg.isPlanReview && (
                  <div className="flex items-center justify-end gap-2 opacity-0 group-hover/message:opacity-100 transition-opacity duration-150 mt-1 select-none pr-1">
                    {msg.sender === 'agent' && msg.metrics?.completion_tps ? (
                      <span className="text-[10px] text-zinc-500 font-mono" title={`Prompt: ${msg.metrics.prompt_tokens?.toLocaleString() || 0} tokens | Output: ${msg.metrics.completion_tokens || 0} tokens | Latency: ${(msg.metrics.total_time_ms ? msg.metrics.total_time_ms / 1000 : 0).toFixed(2)}s`}>
                        {msg.metrics.completion_tps.toFixed(1)} t/s
                      </span>
                    ) : null}

                    {msg.timestamp && (
                      <span className="text-[10px] text-zinc-500 font-mono">
                        {msg.timestamp}
                      </span>
                    )}

                    {/* Copy Button (Clean SVG) */}
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

                    {/* Checkpoint Rollback / Restore Button (Clean SVG) */}
                    {msg.checkpoint && (
                      <button
                        type="button"
                        onClick={(e) => {
                          vscodeApi?.postMessage({
                            command: 'rollbackToCheckpoint',
                            checkpointId: msg.checkpoint.id
                          });
                          const btn = e.currentTarget;
                          const originalSvg = btn.innerHTML;
                          btn.innerHTML = `<svg class="w-3.5 h-3.5 text-cyan-400 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`;
                          setTimeout(() => { btn.innerHTML = originalSvg; }, 2000);
                        }}
                        className="p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors cursor-pointer"
                        title={`Restore files & chat to Checkpoint #${msg.checkpoint.stepNumber || 1}`}
                      >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="1 4 1 10 7 10"></polyline>
                          <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>
                        </svg>
                      </button>
                    )}

                    {/* Checkpoint Branch Button (Clean SVG) */}
                    {msg.checkpoint && (
                      <button
                        type="button"
                        onClick={(e) => {
                          vscodeApi?.postMessage({
                            command: 'branchFromCheckpoint',
                            checkpointId: msg.checkpoint.id
                          });
                          const btn = e.currentTarget;
                          const originalSvg = btn.innerHTML;
                          btn.innerHTML = `<svg class="w-3.5 h-3.5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;
                          setTimeout(() => { btn.innerHTML = originalSvg; }, 1500);
                        }}
                        className="p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors cursor-pointer"
                        title={`Branch conversation from Checkpoint #${msg.checkpoint.stepNumber || 1}`}
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
                )}
              </div>
            )}

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
        ))}



        <div ref={chatEndRef} />
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
      <div className="glass-panel-dark rounded-[24px] p-3 flex flex-col shadow-2xl shrink-0 transition-all focus-within:border-cyan-400/50">
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
          <div className="absolute inset-0 glass-panel-dark z-10 rounded-2xl flex items-center justify-center border border-emerald-500/30 shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
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
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSendMessage();
            }
          }}
          placeholder={isAgentThinking ? "Exovon is analyzing..." : "Ask Exovon Agent to write code or analyze files... (v1)"}
          className="w-full bg-transparent p-2 resize-none text-[13px] font-sans leading-relaxed text-zinc-100 placeholder:text-zinc-400 !outline-none !ring-0 !border-none focus:!outline-none focus:!ring-0 focus:!border-none scrollbar-thin shadow-none"
          style={{ boxShadow: 'none' }}
        />

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
        <div className="flex items-center justify-between pt-1.5 mt-1 border-t border-white/5">
          <div className="flex items-center gap-2 text-zinc-300">

            {/* Hidden File Input for Image Upload */}
            <input
              type="file"
              ref={fileInputRef}
              accept="image/*"
              className="hidden"
              onChange={handleImageSelect}
            />

            {/* Add Context Button (+) with Dropup Toolbox */}
            <div className="relative">
              <button
                onClick={() => setShowToolbox(!showToolbox)}
                className={`w-7 h-7 flex items-center justify-center glass-component-white rounded-full transition-colors focus:outline-none ${showToolbox ? 'bg-white/20 text-white' : 'text-zinc-300 hover:text-white'}`}
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
                          if (vscodeApi) vscodeApi.postMessage({ command: 'log', text: '⚠️ The selected model does not support vision/image inputs.', logType: 'error' });
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
              className={`w-7 h-7 flex items-center justify-center rounded-full transition-colors focus:outline-none ${inspectorActive ? 'bg-purple-500/30 text-purple-300 border border-purple-400/40' : 'glass-component-white text-zinc-300 hover:text-white'}`}
              title={inspectorActive ? "Deactivate Inspector" : "Inspect UI Element"}
              aria-label="Inspect UI Element"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 9 5 12 1.8-5.2L21 14Z" /><path d="M7.2 2.2 8 5.1" /><path d="m5.1 8-2.9-.8" /><path d="M14 4.1 12 6" /><path d="m6 12-1.9 2" /></svg>
            </button>

            {/* Modern Model Selector */}
            <div className="relative group flex items-center">
              <div
                className="flex items-center gap-2 px-3 py-1.5 glass-component-white rounded-full cursor-pointer transition-all active:scale-95"
                onClick={() => {
                  const nextState = !modelDropdownOpen;
                  setModelDropdownOpen(nextState);
                  setShowQuotaPopover(false);
                  if (nextState && vscodeApi) {
                    vscodeApi.postMessage({ command: 'getSettingsState' });
                  }
                }}
              >
                <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)] animate-pulse"></div>
                <span className="text-[11px] font-bold text-white tracking-wide uppercase">
                  {selectedModel?.startsWith('local:') ? `Local: ${formatModelDisplayName(selectedModel)}` : selectedModel === 'Qwen/Qwen3-235B-A22B-Instruct-2507' ? 'Astrolabe Base' : selectedModel === 'gemma-4-31b-it' ? 'Gemma 4' : selectedModel === 'mimo-v2.5' ? 'MiMo V2.5' : selectedModel === 'mimo-v2.5-pro' ? 'MiMo Pro' : selectedModel === 'deepseek-v4-flash' ? 'DS V4 Flash' : selectedModel === 'deepseek-v4-pro' ? 'DS V4 Pro' : selectedModel === 'glm-5.2' ? 'GLM 5.2' : selectedModel?.startsWith('@') ? 'ASTROLABE' : selectedModel || 'ASTROLABE-BASE'}
                </span>
                <svg className="w-3 h-3 text-zinc-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
              </div>

              {/* Dropdown Menu */}
              {modelDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setModelDropdownOpen(false)} />
                  <div className="absolute bottom-full left-0 mb-2 w-48 glass-panel-dark rounded-xl shadow-2xl z-50 overflow-hidden divide-y divide-white/10">
                    <div className="p-1.5">
                      <div className="px-2 py-1.5 text-[9px] font-bold text-zinc-400 uppercase tracking-widest">Standard</div>
                      <button
                        onClick={() => { handleModelChange?.('Qwen/Qwen3-235B-A22B-Instruct-2507'); setModelDropdownOpen(false); (document.activeElement as HTMLElement)?.blur(); }}
                        className={`w-full text-left px-2.5 py-2 rounded-lg text-xs flex flex-col gap-1 transition-colors ${selectedModel === 'Qwen/Qwen3-235B-A22B-Instruct-2507' ? 'glass-component-white text-emerald-300 font-bold' : 'text-zinc-200 hover:bg-white/10'}`}
                      >
                        <span className="font-semibold">Astrolabe Base (Free)</span>
                        <span className="text-[9px] font-mono text-zinc-400">Astrolabe Standard</span>
                      </button>
                      <button
                        onClick={() => { handleModelChange?.('gemma-4-31b-it'); setModelDropdownOpen(false); (document.activeElement as HTMLElement)?.blur(); }}
                        className={`w-full text-left px-2.5 py-2 rounded-lg text-xs flex flex-col gap-1 transition-colors ${selectedModel === 'gemma-4-31b-it' ? 'glass-component-white text-emerald-300 font-bold' : 'text-zinc-200 hover:bg-white/10'}`}
                      >
                        <span className="font-semibold">Gemma 4 31B IT (Free)</span>
                        <span className="text-[9px] font-mono text-zinc-400">Google Gemma 4</span>
                      </button>
                    </div>
                    <div className="p-1.5">
                      <div className="px-2 py-1.5 text-[9px] font-bold text-amber-400 uppercase tracking-widest flex items-center gap-1">
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
                        Pro Tier
                      </div>
                      <button onClick={() => { handleModelChange?.('deepseek-v4-flash'); setModelDropdownOpen(false); (document.activeElement as HTMLElement)?.blur(); }} className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-zinc-200 hover:bg-white/10">DeepSeek V4 Flash</button>
                      <button onClick={() => { handleModelChange?.('deepseek-v4-pro'); setModelDropdownOpen(false); (document.activeElement as HTMLElement)?.blur(); }} className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-zinc-200 hover:bg-white/10">DeepSeek V4 Pro</button>
                      <button onClick={() => { handleModelChange?.('mimo-v2.5'); setModelDropdownOpen(false); (document.activeElement as HTMLElement)?.blur(); }} className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-zinc-200 hover:bg-white/10">Xiaomi MiMo V2.5</button>
                      <button onClick={() => { handleModelChange?.('mimo-v2.5-pro'); setModelDropdownOpen(false); (document.activeElement as HTMLElement)?.blur(); }} className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-zinc-200 hover:bg-white/10">Xiaomi MiMo V2.5 Pro</button>
                      <button onClick={() => { handleModelChange?.('glm-5.2'); setModelDropdownOpen(false); (document.activeElement as HTMLElement)?.blur(); }} className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-zinc-200 hover:bg-white/10">GLM 5.2</button>
                    </div>
                    <div className="p-1.5">
                      <div className="px-2 py-1.5 text-[9px] font-bold text-emerald-400 uppercase tracking-widest flex items-center gap-1">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" /></svg>
                        Local Engine
                      </div>
                      {activeLocalModel ? (
                        <button
                          onClick={() => { handleModelChange?.(`local:${activeLocalModel}`); setModelDropdownOpen(false); (document.activeElement as HTMLElement)?.blur(); }}
                          className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition-colors ${selectedModel === `local:${activeLocalModel}` ? 'glass-component-white text-emerald-300 font-bold' : 'text-zinc-200 hover:bg-white/10'}`}
                        >
                          <div className="truncate w-full font-medium" title={activeLocalModel}>{formatModelDisplayName(activeLocalModel)}</div>
                        </button>
                      ) : (
                        <div className="px-2.5 py-1.5 text-[10px] text-zinc-400 font-mono">Select a local model in Settings.</div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Quota / Context Ring Widget */}
            <div className="relative">
              <button
                onClick={() => {
                  setShowQuotaPopover(!showQuotaPopover);
                  setModelDropdownOpen(false);
                }}
                className="relative flex items-center gap-1.5 px-2.5 py-1.5 glass-component-white rounded-full transition-colors focus:outline-none"
                title={selectedModel?.startsWith('local:') ? "Local Context Window Usage" : "Daily Quota Usage"}
              >
                {(() => {
                  const isLocal = selectedModel?.startsWith('local:');
                  const maxTokens = maxContextTokens || 8192;
                  const currentTokens = currentContextTokens || 0;
                  const pct = isLocal 
                    ? Math.min(100, Math.round((currentTokens / maxTokens) * 100))
                    : (quotaInfo?.usedPercentage || 0);

                  const radius = 6;
                  const dasharray = 2 * Math.PI * radius;
                  const dashoffset = dasharray * ((100 - pct) / 100);
                  const colorClass = pct > 90 ? 'text-red-400' : pct > 75 ? 'text-amber-400' : 'text-emerald-400';

                  return (
                    <div className="flex items-center gap-1.5">
                      <svg className="w-4 h-4 -rotate-90 transform" viewBox="0 0 16 16">
                        {/* Background Track */}
                        <circle cx="8" cy="8" r={radius} stroke="currentColor" strokeWidth="2.5" fill="transparent" className="text-white/20" />
                        {/* Progress */}
                        <circle cx="8" cy="8" r={radius} stroke="currentColor" strokeWidth="2.5" fill="transparent"
                          strokeDasharray={dasharray} strokeDashoffset={dashoffset} strokeLinecap="round"
                          className={`${colorClass} transition-all duration-700 ease-out`} />
                      </svg>
                      <span className="text-[10px] font-mono font-bold text-white">{Math.round(pct)}%</span>
                    </div>
                  );
                })()}
              </button>

              {/* Glassmorphism Popover */}
              {showQuotaPopover && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowQuotaPopover(false)} />
                  <div className="absolute right-0 bottom-full mb-2 w-64 rounded-xl glass-panel-dark border border-white/20 shadow-2xl overflow-hidden z-50 animate-in fade-in slide-in-from-bottom-2 duration-200">
                    {selectedModel?.startsWith('local:') ? (
                      <div>
                        <div className="p-3 border-b border-white/10 bg-gradient-to-r from-emerald-500/20 to-sky-500/20">
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-white">Local Context Window</span>
                            <span className="text-[9px] bg-emerald-500/20 text-emerald-300 px-1.5 py-0.5 rounded border border-emerald-500/40 uppercase tracking-widest font-mono font-bold">VULKAN GPU</span>
                          </div>
                          <div className="flex items-baseline gap-1 mt-2">
                            <span className="text-2xl font-light text-white">
                              {Math.min(100, Math.round(((currentContextTokens || 0) / (maxContextTokens || 8192)) * 100))}%
                            </span>
                            <span className="text-xs text-zinc-400 uppercase tracking-wide">Capacity</span>
                          </div>
                          <p className="text-[10px] font-mono text-zinc-300 mt-1">
                            {(currentContextTokens || 0).toLocaleString()} / {(maxContextTokens || 8192).toLocaleString()} tokens
                          </p>
                        </div>

                        <div className="p-3 space-y-3 bg-black/40">
                          <div className="w-full bg-zinc-900 rounded-full h-1.5 overflow-hidden border border-white/5">
                            <div 
                              className="bg-gradient-to-r from-emerald-400 to-sky-400 h-1.5 rounded-full transition-all duration-300"
                              style={{ width: `${Math.min(100, Math.max(3, Math.round(((currentContextTokens || 0) / (maxContextTokens || 8192)) * 100)))}%` }}
                            ></div>
                          </div>

                          {/* Context Scope Box (Last N Turns) */}
                          <div className="bg-zinc-950/70 p-2.5 rounded-xl border border-white/5 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] font-semibold text-zinc-200">Context Scope</span>
                              <div className="flex items-center gap-1.5 bg-zinc-900 px-2 py-0.5 rounded-lg border border-white/10">
                                <button
                                  onClick={() => {
                                    const next = Math.max(1, keepLastNTurns - 1);
                                    setKeepLastNTurns(next);
                                    vscodeApi?.postMessage({ command: 'setContextKeepLastNTurns', turns: next });
                                  }}
                                  className="text-xs text-zinc-400 hover:text-white px-1 font-bold"
                                  title="Decrease kept turns"
                                >
                                  -
                                </button>
                                <span className="text-xs font-mono font-bold text-sky-400 min-w-[2ch] text-center">
                                  {keepLastNTurns}
                                </span>
                                <button
                                  onClick={() => {
                                    const next = Math.min(20, keepLastNTurns + 1);
                                    setKeepLastNTurns(next);
                                    vscodeApi?.postMessage({ command: 'setContextKeepLastNTurns', turns: next });
                                  }}
                                  className="text-xs text-zinc-400 hover:text-white px-1 font-bold"
                                  title="Increase kept turns"
                                >
                                  +
                                </button>
                                <span className="text-[10px] text-zinc-400">turns</span>
                              </div>
                            </div>
                            <p className="text-[9.5px] text-zinc-400 leading-tight">
                              Keeps last {keepLastNTurns} turns in the model's active KV memory. Your chat transcript stays fully visible on screen.
                            </p>
                          </div>

                          <div className="flex gap-2">
                            <button
                              onClick={() => {
                                vscodeApi?.postMessage({ command: 'pruneKvCache' });
                                setShowQuotaPopover(false);
                              }}
                              className="flex-1 py-1.5 px-2 rounded-lg text-xs font-bold bg-sky-500/20 text-sky-300 hover:bg-sky-500/30 border border-sky-500/30 transition-colors flex items-center justify-center gap-1.5"
                              title="Prune older turns from KV memory while keeping chat transcript intact"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                              <span>Prune KV Cache</span>
                            </button>
                            <button
                              onClick={() => {
                                vscodeApi?.postMessage({ command: 'clearKvCache' });
                                setShowQuotaPopover(false);
                              }}
                              className="py-1.5 px-2.5 rounded-lg text-xs font-bold bg-red-500/20 text-red-300 hover:bg-red-500/30 border border-red-500/30 transition-colors flex items-center justify-center"
                              title="Reset active conversational context"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div className="p-3 border-b border-white/10 bg-gradient-to-r from-purple-500/20 to-blue-500/20">
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-white">Daily Quota</span>
                            {quotaInfo?.currentTier?.toLowerCase().includes('pro') || quotaInfo?.currentTier?.toLowerCase().includes('enterprise') ? (
                              <span className="text-[9px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded border border-amber-500/40 uppercase tracking-widest font-mono font-bold">PRO</span>
                            ) : (
                              <span className="text-[9px] glass-component-white text-zinc-300 px-1.5 py-0.5 rounded uppercase tracking-widest font-mono">FREE</span>
                            )}
                          </div>
                          <div className="flex items-baseline gap-1 mt-2">
                            <span className="text-2xl font-light text-white">{quotaInfo?.usedPercentage || 0}%</span>
                            <span className="text-xs text-zinc-400 uppercase tracking-wide">Used</span>
                          </div>
                        </div>

                        <div className="p-3 space-y-2.5 bg-black/40">
                          <div className="flex justify-between items-center text-[10px]">
                            <span className="text-zinc-400 flex items-center gap-1">
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                              Resets In
                            </span>
                            <span className="text-purple-300 font-mono font-bold">{quotaInfo?.resetsIn || '24h 00m'}</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* 3-Level Planning Mode Selector */}
            <div className="relative">
              <button
                type="button"
                aria-label="Planning Mode Selector"
                onClick={() => setPlanDropdownOpen(prev => !prev)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-medium transition-all cursor-pointer border ${
                  planLevel === 'strict'
                    ? 'bg-purple-950/70 text-purple-300 border-purple-800/60 shadow-sm'
                    : planLevel === 'none'
                    ? 'bg-amber-950/70 text-amber-300 border-amber-800/60 shadow-sm'
                    : 'bg-blue-950/70 text-blue-300 border-blue-800/60 shadow-sm'
                }`}
                title="Select Planning Mode (Direct, Auto, Strict Plan Lock)"
              >
                <span>{planLevel === 'strict' ? '🔒 Plan Lock' : planLevel === 'none' ? '⚡ Direct' : '⚖️ Auto'}</span>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`transition-transform duration-150 ${planDropdownOpen ? 'rotate-180' : ''}`}><path d="m6 9 6 6 6-6"/></svg>
              </button>

              {planDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setPlanDropdownOpen(false)} />
                  <div className="absolute right-0 bottom-full mb-2 w-64 bg-zinc-950/95 backdrop-blur-xl border border-white/15 rounded-xl shadow-2xl p-1.5 z-50 animate-in zoom-in-95 duration-150 font-sans">
                    <div className="text-[10px] font-mono text-zinc-400 px-2 py-1 uppercase tracking-wider font-semibold border-b border-white/5 mb-1">
                      Planning Mode (3 Levels)
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setPlanLevel('none');
                        setPlanDropdownOpen(false);
                      }}
                      className={`w-full text-left p-2 rounded-lg transition-colors flex flex-col gap-0.5 cursor-pointer ${
                        planLevel === 'none' ? 'bg-white/10 text-white font-medium' : 'hover:bg-white/5 text-zinc-300'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1.5 font-semibold text-amber-300">⚡ 1. Direct (No Plan)</span>
                        {planLevel === 'none' && <span className="text-[10px] text-amber-400 font-mono">✓ Active</span>}
                      </div>
                      <span className="text-[10px] text-zinc-400 font-normal">All write tools unlocked immediately. No plan required.</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setPlanLevel('auto');
                        setPlanDropdownOpen(false);
                      }}
                      className={`w-full text-left p-2 rounded-lg transition-colors flex flex-col gap-0.5 cursor-pointer ${
                        planLevel === 'auto' ? 'bg-white/10 text-white font-medium' : 'hover:bg-white/5 text-zinc-300'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1.5 font-semibold text-blue-300">⚖️ 2. Auto (Recommended)</span>
                        {planLevel === 'auto' && <span className="text-[10px] text-blue-400 font-mono">✓ Active</span>}
                      </div>
                      <span className="text-[10px] text-zinc-400 font-normal">Plans for complex tasks, executes directly for simple ones.</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setPlanLevel('strict');
                        setPlanDropdownOpen(false);
                      }}
                      className={`w-full text-left p-2 rounded-lg transition-colors flex flex-col gap-0.5 cursor-pointer ${
                        planLevel === 'strict' ? 'bg-white/10 text-white font-medium' : 'hover:bg-white/5 text-zinc-300'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1.5 font-semibold text-purple-300">🔒 3. Strict Plan Lock</span>
                        {planLevel === 'strict' && <span className="text-[10px] text-purple-400 font-mono">✓ Active</span>}
                      </div>
                      <span className="text-[10px] text-zinc-400 font-normal">All write tools locked until submitPlan is approved by you.</span>
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
              className="w-8 h-8 flex items-center justify-center shrink-0 rounded-full transition-all glass-btn disabled:opacity-30"
              disabled={!inputValue.trim()}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
            </button>
          )}
        </div>
      </div>

    </div>
  );
}
