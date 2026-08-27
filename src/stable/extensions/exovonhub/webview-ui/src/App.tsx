import { useState, useEffect, useRef } from 'react'
import { flushSync } from 'react-dom'
import type { Message, ToolCall, ChatThread } from './types'
import { ChatScreen } from './components/ChatScreen'
import { CortexCanvas } from './components/CortexCanvas'
import { HubScreen } from './components/HubScreen'
import { getVsCodeApi } from './vscodeApi'

import { MotionStudioPanel } from './components/MotionStudioPanel'

// Safely obtain VS Code API (graceful fail to mock in local browser HMR development)
const vscodeApi = getVsCodeApi();

// Clean utility function to bypass React compiler impure render warnings
let _idCounter = 0;
const generateMessageId = (prefix: string): string => {
  _idCounter++;
  return `${Date.now()}-${String(_idCounter).padStart(5, '0')}-${prefix}-${Math.random().toString(36).slice(2, 6)}`;
};

interface GovernorStatus {
  cpuThreads: number;
  allocatedMb: number;
  totalMemMb: number;
  engine: string;
  nodeCount: number;
  pruningGuardrails: string;
}

export default function App() {
  // Navigation
  const [activeTab, setActiveTab] = useState<'agent' | 'cortex' | 'motion' | 'hub'>('agent');
  
  // Workspace Info

  const [speculativeDiffs, setSpeculativeDiffs] = useState<Array<{ path: string; diffLines: Array<{ type: 'added' | 'removed' | 'unchanged'; text: string }> }>>([]);
  const [activeEditorFile, setActiveEditorFile] = useState<string | undefined>(undefined);
  const [isGovernorModalOpen, setIsGovernorModalOpen] = useState<boolean>(false);
  const [governorStatus, setGovernorStatus] = useState<GovernorStatus | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>('Qwen/Qwen3-235B-A22B-Instruct-2507');
  const [activeLocalModel, setActiveLocalModel] = useState<string>('');
  
  // Cortex State
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [cortexElements, setCortexElements] = useState<any[]>([]);
  const [agentFocusNodes, setAgentFocusNodes] = useState<string[]>([]);

  // Tab 1: AI Agent Thread State
  const [inputValue, setInputValue] = useState<string>('');
  const [isAgentThinking, setIsAgentThinking] = useState<boolean>(false);
  const [isPreempting, setIsPreempting] = useState<boolean>(false);
  const [stopClicks, setStopClicks] = useState<number>(0);
  const [selectedContextFiles, setSelectedContextFiles] = useState<Array<{ name: string; type: string }>>([]);
  const [attachedImages, setAttachedImages] = useState<string[]>([]);
  
  // Chat Persistence State
  const [chatThreads, setChatThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [isThreadsSidebarOpen, setIsThreadsSidebarOpen] = useState<boolean>(false);

  const [isLoadingThread, setIsLoadingThread] = useState<boolean>(false);
  const [isPlanMode, setIsPlanMode] = useState<boolean>(true);
  const [inspectorActive, setInspectorActive] = useState<boolean>(false);

  // Quota Info State
  const [quotaInfo, setQuotaInfo] = useState<{ usedPercentage: number, dailyLimit: number, tokensUsed: number, currentTier: string, modelsUsed: string[], resetsIn: string } | null>(null);

  // Local & Agent Context Window State
  const [currentContextTokens, setCurrentContextTokens] = useState<number>(0);
  const [maxContextTokens, setMaxContextTokens] = useState<number>(8192);

  useEffect(() => {
    // Fetch initial quota when component mounts if vscodeApi is available
    if (vscodeApi) {
      vscodeApi.postMessage({ command: 'fetchQuota' });
    }
  }, []);

  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      sender: 'agent',
      text: 'I am your Exovon Agent. I can scan your active workspace, compile optimized static bundles, and globally distribute your application to the Edge CDN. What would you like to inspect or deploy today?',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isHistory: true
    }
  ]);
  
  const chatEndRef = useRef<HTMLDivElement>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedStateRef = useRef<Record<string, string>>({});

  useEffect(() => {
    lastSavedStateRef.current = {};
  }, [activeThreadId]);

  // Save latest messages to SQLite instantly
  useEffect(() => {
    if (activeThreadId && messages.length > 0 && vscodeApi) {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      
      debounceTimerRef.current = setTimeout(() => {
        // Filter out the client-side welcome message and transient approval/review prompts
        const msgsToSave = messages.filter(m => m.id !== 'welcome' && !m.isFileApproval && !m.isCommandApproval && !m.isPlanReview).map(msg => {
          const copy = { ...msg };
          if (copy.fileDetailsToApprove) copy.fileDetailsToApprove = undefined;
          if (copy.commandToApprove) copy.commandToApprove = undefined;
          return copy;
        });
        
        let changedCount = 0;
        msgsToSave.forEach(msg => {
          const stringified = JSON.stringify(msg);
          if (lastSavedStateRef.current[msg.id] !== stringified) {
            vscodeApi.postMessage({ command: 'saveChatMessage', threadId: activeThreadId, message: msg });
            lastSavedStateRef.current[msg.id] = stringified;
            changedCount++;
          }
        });
        
        // Also request an updated thread list to update timestamps in the sidebar
        if (changedCount > 0) {
          vscodeApi.postMessage({ command: 'getChatThreads' });
        }
      }, 2000); // 2 second debounce
    }
    
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [messages, activeThreadId]);

  const handleClearChat = () => {
    if (vscodeApi) {
      vscodeApi.postMessage({ command: 'createNewThread' });
    }
  };

  // Auto-scroll is now handled by Smart Scroll inside ChatScreen

  // Auto-refresh quota when agent finishes generating
  useEffect(() => {
    if (!isAgentThinking && vscodeApi) {
      vscodeApi.postMessage({ command: 'fetchQuota' });
    }
  }, [isAgentThinking]);

  // Listen to messages from VS Code Extension Backend
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      switch (message.type) {
        case 'workspaceInfo':
          // Autonomous mode state is managed natively now
          // if (message.isAutonomous !== undefined) {
          //   // ...
          // }
          break;
        case 'settingsState':
          if (message.model) {
            setSelectedModel(message.model);
          }
          if (message.localLlmModelName !== undefined) {
            setActiveLocalModel(message.localLlmModelName);
            if (message.localLlmModelName) {
              setSelectedModel(prev => prev?.startsWith('local:') ? `local:${message.localLlmModelName}` : prev);
            }
          }
          if (message.ctx_size) {
            setMaxContextTokens(message.ctx_size);
          }
          break;

        case 'modelLoaded':
          if (message.modelId) {
            const baseName = message.modelId.split('/').pop() || message.modelId;
            setActiveLocalModel(baseName);
            setSelectedModel(prev => prev?.startsWith('local:') ? `local:${baseName}` : prev);
          }
          if (message.ctx_size) {
            setMaxContextTokens(message.ctx_size);
          }
          break;

        case 'modelUnloaded':
          setActiveLocalModel('');
          setSelectedModel(prev => prev?.startsWith('local:') ? 'Qwen/Qwen3-235B-A22B-Instruct-2507' : prev);
          break;

        case 'quotaInfo':
          setQuotaInfo(message.data);
          break;

        case 'authStateChanged':
          if (message.loggedIn) {
             vscodeApi?.postMessage({ command: 'fetchQuota' });
          }
          break;
          
        case 'governorStatus':
          setGovernorStatus(message.status);
          break;
          
        case 'cortexGraphUpdate':
          setCortexElements(message.elements);
          break;
          
        case 'agentFocusNodes':
          setAgentFocusNodes(message.nodeIds);
          break;
          
        case 'activeEditorChanged':
          setActiveEditorFile(message.fileName);
          break;
          
        case 'agentLog':
          setIsPreempting(false);
          if (message.text.includes('🛑')) {
             setIsAgentThinking(false);
             setStopClicks(0);
          }
          if (!message.messageId) break;
          setMessages(prev => {
            const copy = [...prev];
            const targetIdx = copy.findIndex(m => m.id === message.messageId);
            if (targetIdx !== -1) {
              const lastMsg = copy[targetIdx];
              const timeline = [...(lastMsg.timeline || [])];
              
              let logTitle = message.text;
              // strip emojis and take first 25 chars
              logTitle = logTitle.replace(/^[^\w]+/g, '').substring(0, 25).trim();
              if (!logTitle) logTitle = 'System Log';
              
              const isInternalVerboseLog = 
                message.text.includes('Initializing isolated') ||
                message.text.includes('Copy-on-Write Shadow') ||
                message.text.includes('Starting Exovon AI Agent') ||
                message.text.includes('AI reasoning step');

              if (!isInternalVerboseLog) {
                timeline.push({
                  id: 'log-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
                  type: 'log',
                  status: 'success',
                  title: logTitle,
                  content: message.text
                });
              }

              copy[targetIdx] = {
                ...lastMsg,
                logs: [...(lastMsg.logs || []), { text: message.text, logType: message.logType }],
                timeline
              };
            }
            return copy;
          });
          break;
        case 'agentPromptProgress':
          if (message.promptTokens) {
            setCurrentContextTokens(message.promptTokens);
          }
          if (!message.messageId) break;
          setMessages(prev => {
            const copy = [...prev];
            const targetIdx = copy.findIndex(m => m.id === message.messageId);
            if (targetIdx !== -1) {
              copy[targetIdx] = {
                ...copy[targetIdx],
                promptTokens: message.promptTokens,
                promptProcessed: message.promptProcessed
              };
            }
            return copy;
          });
          break;

        case 'agentMetrics':
          if (message.metrics?.prompt_tokens) {
            setCurrentContextTokens(message.metrics.prompt_tokens);
          }
          if (!message.messageId) break;
          setMessages(prev => {
            const copy = [...prev];
            const targetIdx = copy.findIndex(m => m.id === message.messageId);
            if (targetIdx !== -1) {
              copy[targetIdx] = {
                ...copy[targetIdx],
                metrics: message.metrics
              };
            }
            return copy;
          });
          break;

        case 'contextCleared':
          setCurrentContextTokens(0);
          break;

        case 'contextPruned':
          if (message.estimatedTokens !== undefined) {
            setCurrentContextTokens(message.estimatedTokens);
          }
          break;

        case 'agentReasoning':
          if (!message.messageId) break;
          setMessages(prev => {
            const copy = [...prev];
            const targetIdx = copy.findIndex(m => m.id === message.messageId);
            if (targetIdx !== -1) {
              const lastMsg = copy[targetIdx];
              const rawStream = (lastMsg.rawStream || '') + message.text;
              
              const timeline = [...(lastMsg.timeline || [])];
              let lastEvent = timeline[timeline.length - 1];
              
              if (!lastEvent || lastEvent.type !== 'think' || lastEvent.status !== 'running') {
                lastEvent = {
                  id: 'think-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
                  type: 'think',
                  status: 'running',
                  title: 'Think',
                  content: ''
                };
                timeline.push(lastEvent);
              }
              lastEvent.content += message.text;

              copy[targetIdx] = {
                ...lastMsg,
                rawStream,
                timeline
              };
            }
            return copy;
          });
          break;

        case 'agentFinalAnswer':
          setIsPreempting(false);
          if (!message.messageId) break;
          setMessages(prev => {
            const copy = [...prev];
            const targetIdx = copy.findIndex(m => m.id === message.messageId);
            if (targetIdx !== -1) {
              const lastMsg = copy[targetIdx];
              
              const finalText = message.text || '';
              
              // Clean up <thought> and <think> tags from the final text
              let cleanedText = finalText
                .replace(/<\|?thought[^>]*>[\s\S]*?<\/thought>/gi, '')
                .replace(/<\|?think[^>]*>[\s\S]*?<\/think>/gi, '')
                .replace(/<\|?channel[^>]*>[\s\S]*?<\/channel>/gi, '')
                .replace(/<\|?channel\|?>thought[\s\S]*?<\|?channel\|?>/gi, '')
                .replace(/<reasoning[^>]*>[\s\S]*?<\/reasoning>/gi, '')
                .replace(/<reason[^>]*>[\s\S]*?<\/reason>/gi, '')
                .replace(/<\|?thought[^>]*>/gi, '')
                .replace(/<\/thought>/gi, '')
                .replace(/<\|?think[^>]*>/gi, '')
                .replace(/<\/think>/gi, '')
                .replace(/<\|?channel[^>]*>/gi, '')
                .replace(/<\/channel>/gi, '')
                .replace(/<\|?end_of_thought\|?>/gi, '')
                .replace(/<\|?start_of_thought\|?>/gi, '')
                .trim();

              const timeline = [...(lastMsg.timeline || [])];
              
              // Remove the last think block if it was just the final answer
              if (timeline.length > 0 && timeline[timeline.length - 1].type === 'think') {
                 timeline.pop();
              }

              copy[targetIdx] = {
                ...lastMsg,
                text: cleanedText,
                timeline,
                endTime: Date.now()
              };
            }
            return copy;
          });
          break;
          
        case 'agentPlanUpdate':
          setIsPreempting(false);
          if (!message.messageId) break;
          setMessages(prev => {
            const copy = [...prev];
            const targetIdx = copy.findIndex(m => m.id === message.messageId);
            if (targetIdx !== -1) {
              const lastMsg = copy[targetIdx];
              copy[targetIdx] = {
                ...lastMsg,
                planSteps: message.planSteps
              };
            }
            return copy;
          });
          break;
        case 'agentUsage':
          // Handle totalTokens usage if needed in future
          break;
        case 'agentPreemptingQueue':
          setIsPreempting(true);
          break;
        case 'agentChat':
          setIsPreempting(false);
          setMessages(prev => [
            ...prev,
            {
              id: 'chat-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
              sender: 'agent',
              text: '',
              reasoning: message.text,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            }
          ]);
          break;

        case 'agentComplete':
          setIsAgentThinking(false);
          setStopClicks(0);
          setMessages(prev => {
            const copy = [...prev];
            // Sweep ALL messages to force any stuck 'running' states to 'failed' or complete
            let updated = false;
            for (let i = 0; i < copy.length; i++) {
              if (copy[i].sender === 'agent') {
                const msgCopy = { ...copy[i] };
                if (msgCopy.toolCalls) {
                  msgCopy.toolCalls = msgCopy.toolCalls.map(t => {
                    if (t.status === 'running') { updated = true; return { ...t, status: 'failed' }; }
                    return t;
                  });
                }
                if (msgCopy.planSteps) {
                  msgCopy.planSteps = msgCopy.planSteps.map(p => {
                    if (p.status === 'running') { updated = true; return { ...p, status: 'success' }; }
                    return p;
                  });
                }
                if (msgCopy.timeline) {
                  msgCopy.timeline = msgCopy.timeline.map(e => {
                    if (e.status === 'running') { updated = true; return { ...e, status: e.type === 'think' ? 'success' : 'failed' }; }
                    return e;
                  });
                }
                if (updated) copy[i] = msgCopy;
              }
            }
            return copy;
          });
          break;

        case 'agentSpeculativeDiffs':
          if (message.diffs) {
            setSpeculativeDiffs(message.diffs);
          }
          break;

        case 'speculativeDiffResolved':
          if (message.filePath) {
            setSpeculativeDiffs(prev => prev.filter(diff => diff.path !== message.filePath));
          }
          break;

        case 'agentPlanReview':
          // C4: Plan-Before-Execute — show plan review card in chat
          setMessages(prev => [
            ...prev,
            {
              id: generateMessageId('plan-review'),
              sender: 'agent',
              text: '',
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              isPlanReview: true
            }
          ]);
          break;

        case 'agentPlanResolved':
          setMessages(prev => 
            prev.map(msg => 
              msg.isPlanReview 
                ? { 
                    ...msg, 
                    isPlanReview: false, 
                    text: message.approved ? '✔️ Plan was approved and executed.' : '❌ Implementation Plan was rejected.'
                  } 
                : msg
            )
          );
          break;

        case 'agentToolStart':
          setIsPreempting(false);
          setIsAgentThinking(true);
          if (!message.messageId) break;
          setMessages(prev => {
            const copy = [...prev];
            const targetIdx = copy.findIndex(m => m.id === message.messageId);
            if (targetIdx !== -1) {
              const lastMsg = copy[targetIdx];
              const existingTools = lastMsg.toolCalls || [];
              const newTool: ToolCall = {
                id: message.toolId,
                name: message.toolName,
                args: message.toolArgs,
                status: 'running'
              };
              
              const timeline = [...(lastMsg.timeline || [])];
              
              // If there was a running think block, mark it success
              const lastEvent = timeline[timeline.length - 1];
              if (lastEvent && lastEvent.type === 'think' && lastEvent.status === 'running') {
                timeline[timeline.length - 1] = { ...lastEvent, status: 'success' };
              }
              
              let toolTitle: string;
              let parsedArgs: Record<string, string> = {};
              try { parsedArgs = JSON.parse(message.toolArgs); } catch { /* ignore */ }
              
              if (message.toolName === 'viewFile' || message.toolName === 'listDir') {
                const path = parsedArgs.AbsolutePath || parsedArgs.DirectoryPath || parsedArgs.relativePath || '';
                toolTitle = `Read | ${path.split('/').pop() || 'file'}`;
              } else if (message.toolName === 'multiReplaceFileContent' || message.toolName === 'replaceFileContent' || message.toolName === 'write_to_file') {
                const path = parsedArgs.TargetFile || parsedArgs.relativePath || '';
                toolTitle = `Edit | ${path.split('/').pop() || 'file'}`;
              } else if (message.toolName === 'runCommand' || message.toolName === 'run_command') {
                const cmd = parsedArgs.CommandLine || parsedArgs.command || '';
                toolTitle = `Execute | ${cmd.substring(0, 15)}${cmd.length > 15 ? '...' : ''}`;
              } else if (message.toolName === 'grepSearch' || message.toolName === 'search_web' || message.toolName === 'grep_search') {
                const q = parsedArgs.Query || parsedArgs.query || '';
                toolTitle = `Search | ${q.substring(0, 15)}${q.length > 15 ? '...' : ''}`;
              } else {
                toolTitle = message.toolName;
              }

              timeline.push({
                id: message.toolId,
                type: 'tool',
                status: 'running',
                title: toolTitle,
                content: message.toolArgs,
                toolName: message.toolName
              });

              copy[targetIdx] = {
                ...lastMsg,
                toolCalls: [...existingTools, newTool],
                timeline
              };
            }
            return copy;
          });
          break;

        case 'agentToolComplete':
          if (!message.messageId) break;
          setMessages(prev => {
            const copy = [...prev];
            const targetIdx = copy.findIndex(m => m.id === message.messageId);
            if (targetIdx !== -1) {
              const lastMsg = copy[targetIdx];
              if (lastMsg.toolCalls) {
                const updatedTools = lastMsg.toolCalls.map(t => 
                  t.id === message.toolId ? { ...t, status: message.toolStatus as 'running' | 'success' | 'failed' } : t
                );
                
                const timeline = [...(lastMsg.timeline || [])];
                const toolIdx = timeline.findIndex(e => e.id === message.toolId);
                if (toolIdx !== -1) {
                  timeline[toolIdx] = { ...timeline[toolIdx], status: message.toolStatus as 'running' | 'success' | 'failed' };
                }

                copy[targetIdx] = {
                  ...lastMsg,
                  toolCalls: updatedTools,
                  timeline
                };
              }
            }
            return copy;
          });
          break;

        case 'commandApprovalRequested':
          setMessages(prev => [
            ...prev,
            {
              id: message.id,
              sender: 'agent',
              text: `⚠️ Host terminal command requires your review and explicit approval:`,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              isCommandApproval: true,
              approvalId: message.id,
              commandToApprove: message.command
            }
          ]);
          break;

        case 'fileApprovalRequested':
          setMessages(prev => [
            ...prev,
            {
              id: message.id,
              sender: 'agent',
              text: `⚠️ Workspace file action requires your review and explicit approval:`,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              isFileApproval: true,
              approvalId: message.id,
              fileChangeType: message.changeType,
              filePathToApprove: message.filePath,
              fileDetailsToApprove: message.details
            }
          ]);
          break;

        case 'chatThreadsLoaded':
          if (message.threads) {
            setChatThreads(message.threads);
            setActiveThreadId(prev => {
              const prevExists = prev && message.threads.some((t: ChatThread) => t.id === prev);
              if (!prevExists) {
                if (message.threads.length > 0) {
                  if (vscodeApi) vscodeApi.postMessage({ command: 'loadChatThread', threadId: message.threads[0].id });
                  return message.threads[0].id;
                } else {
                  if (vscodeApi) vscodeApi.postMessage({ command: 'createNewThread' });
                  return null;
                }
              }
              return prev;
            });
          }
          break;
        case 'newThreadCreated':
          setIsLoadingThread(false);
          if (message.threadId) {
            setActiveThreadId(message.threadId);
            setMessages([{
              id: 'welcome',
              sender: 'agent',
              text: 'I am your Exovon Agent. I can scan your active workspace, compile optimized static bundles, and globally distribute your application to the Edge CDN. What would you like to inspect or deploy today?',
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              isHistory: true
            }]);
          }
          break;
        case 'chatHistoryLoaded':
          setIsLoadingThread(false);
          if (message.messages && message.messages.length > 0) {
            setMessages(message.messages.map((m: unknown) => ({ ...(m as object), isHistory: true })));
          } else {
             setMessages([{
              id: 'welcome',
              sender: 'agent',
              text: 'I am your Exovon Agent. I can scan your active workspace, compile optimized static bundles, and globally distribute your application to the Edge CDN. What would you like to inspect or deploy today?',
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              isHistory: true
            }]);
          }
          break;
        case 'focusInput': {
          setActiveTab('agent');
          const chatInputFocus = document.querySelector('textarea') as HTMLTextAreaElement;
          if (chatInputFocus) {
            chatInputFocus.focus();
          }
          break;
        }
        case 'appendInput': {
          setActiveTab('agent');
          setInputValue(prev => prev + (prev.endsWith(' ') || prev === '' ? '' : ' ') + message.text);
          const chatInputAppend = document.querySelector('textarea') as HTMLTextAreaElement;
          if (chatInputAppend) {
            chatInputAppend.focus();
          }
          break;
        }
        case 'inspectorElementSelected': {
          setActiveTab('agent');
          setInputValue(prev => prev + (prev.endsWith(' ') || prev === '' ? '' : '\n\n') + message.context + ' ');
          const chatInputInspector = document.querySelector('textarea') as HTMLTextAreaElement;
          if (chatInputInspector) {
            chatInputInspector.focus();
          }
          break;
        }
        case 'inspectorStateChanged': {
          setInspectorActive(message.isActive);
          break;
        }
        case 'appendInputAndSubmit': {
          setActiveTab('agent');
          setInputValue(''); // Clear input since we're submitting it
          if (vscodeApi) {
            vscodeApi.postMessage({
              command: 'agentChat',
              text: message.text,
              useContext: true
            });
          }
          break;
        }
        case 'openCssEditor': {
          // Scaffold for CSS Editor panel
          setActiveTab('agent'); // We'll add this tab if needed, or just show a modal
          // For now, let's just append it to chat as a command
          const prompt = `Please open the CSS editor or update the CSS for the following element: \n${message.elementData?.outerHTML}`;
          setInputValue(prompt);
          document.querySelector('textarea')?.focus();
          break;
        }
        case 'cancelAgentShortcut':
          if (vscodeApi) {
             vscodeApi.postMessage({ command: 'cancelAgent' });
          }
          break;
        case 'openHistory':
          setIsThreadsSidebarOpen(true);
          break;
        case 'toggleAutoMode':
          // Auto mode toggle event from native sidebar
          if (vscodeApi) {
            // Note: Since webview no longer tracks this state, we need the backend to flip its own state
            vscodeApi.postMessage({ command: 'toggleAutonomousModeNative' });
          }
          break;
        case 'injectRejectionFeedback': {
          const userMsgId = Date.now().toString() + '-rej';
          
          setMessages(prev => {
            const userMsg = {
              id: userMsgId,
              sender: 'user' as 'user' | 'agent',
              text: message.text,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            };
            return [...prev, userMsg];
          });
          
          // Trigger a silent send immediately
          setTimeout(() => {
            if (vscodeApi) {
              setMessages(prev => {
                 const agentId = Date.now().toString() + '-agent';
                 const agentPlaceholderMsg = {
                   id: agentId,
                   sender: 'agent' as 'user' | 'agent',
                   text: '',
                   timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                   startTime: Date.now()
                 };
                 
                 // Collect history to send
                 const msgHistory = [...prev, agentPlaceholderMsg];
                 
                 // Filter out timeline fields for history
                 const cleanHistory = msgHistory.filter(m => m.id !== agentId).map(m => ({
                    role: m.sender,
                    parts: [{ text: m.text }]
                 }));

                 setIsAgentThinking(true);
                 
                 vscodeApi.postMessage({
                   command: 'initiateAgent',
                   mode: 'architect',
                   prompt: message.text,
                   previousMessages: cleanHistory,
                   messageId: agentId
                 });
                 
                 return msgHistory;
              });
            }
          }, 100);
          break;
        }
      }
    };

    window.addEventListener('message', handleMessage);
    
    if (vscodeApi) {
      vscodeApi.postMessage({ command: 'getWorkspaceInfo' });
      vscodeApi.postMessage({ command: 'getSettingsState' });
      vscodeApi.postMessage({ command: 'getChatThreads' });
    }

    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Action: Developer responds to Host Command Approval
  const handleApproveCommand = (id: string, approved: boolean) => {
    setMessages(prev => prev.filter(msg => msg.id !== id));

    if (vscodeApi) {
      vscodeApi.postMessage({
        command: 'respondToCommandApproval',
        id,
        approved
      });
      // Also delete it from backend history so it doesn't reappear as a ghost on reload
      vscodeApi.postMessage({
        command: 'deleteChatMessage',
        threadId: activeThreadId,
        messageId: id
      });
    }
  };

  // Action: Developer responds to Workspace File Modification Approval
  const handleApproveFile = (id: string, approved: boolean) => {
    setMessages(prev => prev.filter(msg => msg.id !== id));

    if (vscodeApi) {
      vscodeApi.postMessage({
        command: 'respondToFileApproval',
        id,
        approved
      });
      // Also delete it from backend history so it doesn't reappear as a ghost on reload
      vscodeApi.postMessage({
        command: 'deleteChatMessage',
        threadId: activeThreadId,
        messageId: id
      });
    }
  };

  // Action: User submits prompt in Chat
  const handleSendMessage = (textToSend?: string) => {
    const promptText = textToSend || inputValue;
    if (!promptText.trim() && attachedImages.length === 0 || isAgentThinking) return;

    const userMsgId = generateMessageId('user');
    const agentId = generateMessageId('agent');

    // Capture images synchronously for the message payload
    const imagesToSubmit = [...attachedImages];

    // Use flushSync to guarantee state and DOM are fully committed before triggering backend.
    // This fixes the React batching race condition where rapid backend stream replies would
    // mistakenly fetch the previous state's last agent message.
    flushSync(() => {
      // Append user message
      const userMsg: Message = {
        id: userMsgId,
        sender: 'user',
        text: promptText,
        images: imagesToSubmit,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      setInputValue('');
      setAttachedImages([]);
      setIsAgentThinking(true);

      // Append initial agent response structure WITHOUT hardcoded plans
      const agentPlaceholderMsg: Message = {
        id: agentId,
        sender: 'agent',
        text: '',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        startTime: Date.now()
      };
      
      setMessages(prev => [...prev, userMsg, agentPlaceholderMsg]);
    });

    // Call Backend Extension
    if (vscodeApi) {
      vscodeApi.postMessage({
        command: 'initiateAgent',
        mode: 'architect',
        prompt: promptText,
        contextFiles: selectedContextFiles.map(f => f.name),
        images: imagesToSubmit,
        messageId: agentId,
        threadId: activeThreadId
      });
    }
  };

  return (
    <div className="h-screen overflow-hidden bg-transparent flex flex-col p-3 select-none relative font-sans">


      {/* SLEEK NAVIGATION TABS */}
      <nav role="tablist" aria-label="Main Navigation" className="flex items-center justify-between glass-panel-dark p-1 rounded-xl mb-3 text-xs select-none shadow-xl border border-white/10">
        <div className="flex-1 flex items-center gap-0.5 min-w-0">
          <button
            role="tab"
            aria-selected={activeTab === 'agent'}
            aria-controls="tabpanel-agent"
            onClick={() => setActiveTab('agent')}
            className={`flex-1 py-1.5 font-semibold transition-all duration-150 rounded-lg text-center truncate px-1 ${
              activeTab === 'agent'
                ? 'glass-component-white text-white font-bold shadow-md'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5'
            }`}
          >
            Agent
          </button>
          
          <button
            role="tab"
            aria-selected={activeTab === 'cortex'}
            aria-controls="tabpanel-cortex"
            onClick={() => setActiveTab('cortex')}
            className={`flex-1 py-1.5 font-semibold transition-all duration-150 rounded-lg text-center truncate px-1 ${
              activeTab === 'cortex'
                ? 'glass-component-white text-white font-bold shadow-md'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5'
            }`}
          >
            Cortex
          </button>

          <button
            role="tab"
            aria-selected={activeTab === 'motion'}
            aria-controls="tabpanel-motion"
            onClick={() => setActiveTab('motion')}
            className={`flex-1 py-1.5 font-semibold transition-all duration-150 rounded-lg text-center truncate px-1 ${
              activeTab === 'motion'
                ? 'glass-component-white text-white font-bold shadow-md'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5'
            }`}
          >
            Motion
          </button>
          
          <button
            role="tab"
            aria-selected={activeTab === 'hub'}
            aria-controls="tabpanel-hub"
            onClick={() => setActiveTab('hub')}
            className={`flex-1 py-1.5 font-semibold transition-all duration-150 rounded-lg text-center truncate px-1 ${
              activeTab === 'hub'
                ? 'glass-component-white text-white font-bold shadow-md'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5'
            }`}
          >
            Hub
          </button>
        </div>

        {/* QUICK ACTION BUTTONS (NEW CHAT & PAST CHATS) */}
        <div className="flex items-center gap-1 ml-1.5 border-l border-white/10 pl-1.5 shrink-0">
          <button
            onClick={() => handleClearChat()}
            className="flex items-center gap-1 px-2 py-1 bg-emerald-600/30 hover:bg-emerald-600/60 text-emerald-300 hover:text-white border border-emerald-500/30 rounded-lg text-[10px] font-mono font-bold transition-all shadow-sm shrink-0"
            title="Start New Chat"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4"/>
            </svg>
            <span className="hidden xs:inline">New</span>
          </button>

          <button
            onClick={() => setIsThreadsSidebarOpen(true)}
            className="p-1.5 bg-zinc-900/60 hover:bg-zinc-800 border border-zinc-800 rounded-lg text-zinc-400 hover:text-zinc-200 transition-colors shrink-0"
            title="Past Chats & Threads"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
        </div>
      </nav>

      {/* MAIN CONTAINER */}
      <main className="flex-1 overflow-hidden flex flex-col relative" role="tabpanel" id={`tabpanel-${activeTab}`}>
        
        {/* TAB 1: CURSOR-STYLE AGENT */}
        {activeTab === 'agent' && (
          isLoadingThread ? (
            <div className="flex-1 flex items-center justify-center">
              <span className="animate-spin w-5 h-5 border-2 border-t-emerald-500 border-zinc-800 rounded-full"></span>
            </div>
          ) : (
          <ChatScreen
            messages={messages}
            isAgentThinking={isAgentThinking}
            stopClicks={stopClicks}
            inputValue={inputValue}
            setInputValue={setInputValue}
            handleSendMessage={handleSendMessage}
            setStopClicks={setStopClicks}
            handleApproveCommand={handleApproveCommand}
            handleApproveFile={handleApproveFile}
            selectedContextFiles={selectedContextFiles}
            setSelectedContextFiles={setSelectedContextFiles}
            speculativeDiffs={speculativeDiffs}
            setSpeculativeDiffs={setSpeculativeDiffs}
            isPlanMode={isPlanMode}
            setIsPlanMode={setIsPlanMode}
            vscodeApi={vscodeApi}
            chatEndRef={chatEndRef}
            activeEditorFile={activeEditorFile}
            isPreempting={isPreempting}
            selectedModel={selectedModel}
            inspectorActive={inspectorActive}
            attachedImages={attachedImages}
            setAttachedImages={setAttachedImages}
            quotaInfo={quotaInfo}
            activeLocalModel={activeLocalModel}
            currentContextTokens={currentContextTokens}
            maxContextTokens={maxContextTokens}
            handleModelChange={(model: string) => {

              setSelectedModel(model);
              if (vscodeApi) {
                vscodeApi.postMessage({ command: 'updatePreferredModel', value: model });
              }
            }}
            handlePlanApproval={(approved: boolean) => {
              setMessages(prev => prev.filter(msg => !msg.isPlanReview));
              vscodeApi?.postMessage({ command: 'respondToPlanApproval', approved });
            }}
          />
          )
        )}

        {/* TAB 2: CORTEX GRAPH */}
        {activeTab === 'cortex' && (
          <div className="flex-1 min-h-0">
            <CortexCanvas elements={cortexElements} agentFocusNodeIds={agentFocusNodes} />
          </div>
        )}

        {/* TAB 4: MOTION STUDIO */}
        {activeTab === 'motion' && (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <MotionStudioPanel />
          </div>
        )}

        {/* TAB 5: HUB (AGENTS MARKETPLACE) */}
        {activeTab === 'hub' && (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <HubScreen 
              onInstallAgent={(agentId) => {
                vscodeApi?.postMessage({ command: 'installAgent', agentId });
              }}
            />
          </div>
        )}

      </main>


      {/* GOVERNOR MODAL */}
      {isGovernorModalOpen && (
        <div className="absolute inset-0 z-50 bg-zinc-950/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setIsGovernorModalOpen(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="governor-title" className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 w-full shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3 border-b border-zinc-800 pb-2">
              <h2 id="governor-title" className="text-xs font-bold font-mono text-zinc-200">System Governor</h2>
              <button aria-label="Close System Governor" onClick={() => setIsGovernorModalOpen(false)} className="text-zinc-500 hover:text-zinc-300">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            
            {governorStatus ? (
              <div className="font-mono text-[10px] text-zinc-400 space-y-2">
                <div className="flex justify-between">
                  <span className="text-zinc-500">Architecture:</span>
                  <span className="text-zinc-200">{governorStatus.cpuThreads} Threads</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Memory:</span>
                  <span className="text-zinc-200">{governorStatus.allocatedMb} MB / {governorStatus.totalMemMb} MB</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Vector Engine:</span>
                  <span className="text-zinc-200">{governorStatus.engine}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Code Entities:</span>
                  <span className="text-zinc-200">{governorStatus.nodeCount} Nodes Inferred</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Pruning Rules:</span>
                  <span className="text-zinc-200">{governorStatus.pruningGuardrails}</span>
                </div>
              </div>
            ) : (
              <div className="text-[10px] font-mono text-zinc-500 text-center py-4 animate-pulse">
                Fetching Telemetry...
              </div>
            )}
          </div>
        </div>
      )}

      {/* PAST CHATS SIDEBAR MODAL */}
      {isThreadsSidebarOpen && (
        <div className="absolute inset-0 z-50 bg-zinc-950/80 backdrop-blur-sm flex justify-end" onClick={() => setIsThreadsSidebarOpen(false)}>
          <div role="dialog" aria-modal="true" aria-label="Past Chats" className="w-64 bg-zinc-900 border-l border-zinc-800 h-full flex flex-col shadow-2xl animate-slide-in-right" onClick={e => e.stopPropagation()}>
            <div className="p-3 border-b border-zinc-800 flex items-center justify-between">
              <h2 className="text-xs font-bold font-mono text-zinc-200">Past Chats</h2>
              <button aria-label="Close Past Chats" onClick={() => setIsThreadsSidebarOpen(false)} className="text-zinc-500 hover:text-zinc-300">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            
            <div className="p-2 border-b border-zinc-800/50 bg-zinc-900/50">
              <button
                aria-label="Start New Chat"
                onClick={() => {
                  handleClearChat();
                  setIsThreadsSidebarOpen(false);
                }}
                className="w-full flex items-center justify-center gap-2 py-2 mb-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-bold text-[11px] shadow-sm transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4"/></svg>
                New Chat
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {chatThreads.map(thread => (
                <div key={thread.id} className={`group flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors ${activeThreadId === thread.id ? 'bg-zinc-800 border border-zinc-700' : 'hover:bg-zinc-800/50 border border-transparent'}`}>
                  <button
                    aria-label={`Select Chat Thread: ${thread.title || 'Empty chat'}`}
                    onClick={() => {
                      if (vscodeApi && thread.id !== activeThreadId) {
                        vscodeApi.postMessage({ command: 'loadChatThread', threadId: thread.id });
                        setIsThreadsSidebarOpen(false);
                      }
                    }}
                    className="flex-1 text-left min-w-0"
                  >
                    <div className="text-[10px] text-zinc-300 truncate font-semibold mb-0.5">{thread.title || 'Empty chat'}</div>
                    <div className="text-[9px] text-zinc-500 truncate">{new Date(thread.updated_at).toLocaleString()}</div>
                  </button>
                  <button
                    aria-label={`Delete Chat Thread: ${thread.title || 'Empty chat'}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (vscodeApi) {
                        vscodeApi.postMessage({ command: 'requestDeleteChatThread', threadId: thread.id });
                      }
                    }}
                    className="p-2 text-zinc-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity mr-1"
                    title="Delete Chat"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                  </button>
                </div>
              ))}
              {chatThreads.length === 0 && (
                <div className="text-center p-4 text-[10px] text-zinc-500">No past chats found.</div>
              )}
            </div>
          </div>
          <div className="flex-1" onClick={() => setIsThreadsSidebarOpen(false)} />
        </div>
      )}

    </div>
  );
}
