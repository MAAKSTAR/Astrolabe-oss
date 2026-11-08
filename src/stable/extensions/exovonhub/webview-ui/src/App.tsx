import { useState, useEffect, useRef } from 'react'
import { flushSync } from 'react-dom'
import type { Message, ToolCall, ChatThread } from './types'
import { ChatScreen } from './components/ChatScreen'
import { ChatHistoryDrawer } from './components/ChatHistoryDrawer'
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
  const [selectedModel, setSelectedModel] = useState<string>('');
  const selectedModelRef = useRef<string>(selectedModel);
  useEffect(() => {
    selectedModelRef.current = selectedModel;
  }, [selectedModel]);
  const [activeLocalModel, setActiveLocalModel] = useState<string>('');
  const [activeDiffusionModel, setActiveDiffusionModel] = useState<string>('');
  const [availableLocalModels, setAvailableLocalModels] = useState<Array<{ id: string; name: string; size_display?: string; quantization?: string }>>([]);
  
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
  const [workspaceRoot, setWorkspaceRoot] = useState<string>('');
  
  // Chat Persistence State
  const [chatThreads, setChatThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [isThreadsSidebarOpen, setIsThreadsSidebarOpen] = useState<boolean>(false);

  const [isLoadingThread, setIsLoadingThread] = useState<boolean>(false);
  const [planLevel, setPlanLevel] = useState<'none' | 'auto' | 'strict'>('auto');
  const [inspectorActive, setInspectorActive] = useState<boolean>(false);

  // Quota Info State
  const [quotaInfo, setQuotaInfo] = useState<{ usedPercentage: number, dailyLimit: number, tokensUsed: number, currentTier: string, modelsUsed: string[], resetsIn: string } | null>(null);

  // Local & Agent Context Window State
  const [currentContextTokens, setCurrentContextTokens] = useState<number>(0);
  const [maxContextTokens, setMaxContextTokens] = useState<number>(8192);

  useEffect(() => {
    // Fetch initial quota and live engine settings state
    if (vscodeApi) {
      vscodeApi.postMessage({ command: 'fetchQuota' });
      vscodeApi.postMessage({ command: 'getSettingsState' });
    }

    // Auto-poll engine state every 3.5s so when a new model is loaded, UI updates itself immediately
    const pollInterval = setInterval(() => {
      if (vscodeApi) {
        vscodeApi.postMessage({ command: 'getSettingsState' });
      }
    }, 3500);

    return () => clearInterval(pollInterval);
  }, []);

  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      sender: 'agent',
      text: 'I am Astrolabe, your autonomous AI assistant. I can help you research topics, answer questions, analyze documentation, and build or modify your code. How can I assist you today?',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isHistory: true
    }
  ]);
  
  const chatEndRef = useRef<HTMLDivElement>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedStateRef = useRef<Record<string, string>>({});
  const messagesRef = useRef<Message[]>(messages);
  messagesRef.current = messages;
  const activeThreadIdRef = useRef<string | null>(activeThreadId);
  activeThreadIdRef.current = activeThreadId;

  // Persist active thread selection in localStorage for instant restore on restart
  useEffect(() => {
    if (activeThreadId) {
      localStorage.setItem('astrolabe_last_active_thread_id', activeThreadId);
    }
  }, [activeThreadId]);

  const flushSaveMessages = (threadId: string | null, msgs: Message[]) => {
    if (!threadId || msgs.length === 0 || !vscodeApi) return;
    const msgsToSave = msgs.filter(m => m.id !== 'welcome' && !m.isFileApproval && !m.isCommandApproval && !m.isPlanReview).map(msg => {
      const copy = { ...msg };
      if (copy.fileDetailsToApprove) copy.fileDetailsToApprove = undefined;
      if (copy.commandToApprove) copy.commandToApprove = undefined;
      return copy;
    });
    
    let changedCount = 0;
    msgsToSave.forEach(msg => {
      const stringified = JSON.stringify(msg);
      if (lastSavedStateRef.current[msg.id] !== stringified) {
        vscodeApi.postMessage({ command: 'saveChatMessage', threadId, message: msg });
        lastSavedStateRef.current[msg.id] = stringified;
        changedCount++;
      }
    });
    
    if (changedCount > 0) {
      vscodeApi.postMessage({ command: 'getChatThreads' });
    }
  };

  // Immediate save on IDE close, reload, or page hide to guarantee no lost turns
  useEffect(() => {
    const handleUnload = () => {
      if (activeThreadIdRef.current && messagesRef.current.length > 0) {
        flushSaveMessages(activeThreadIdRef.current, messagesRef.current);
      }
    };
    window.addEventListener('beforeunload', handleUnload);
    window.addEventListener('pagehide', handleUnload);
    return () => {
      window.removeEventListener('beforeunload', handleUnload);
      window.removeEventListener('pagehide', handleUnload);
    };
  }, []);

  useEffect(() => {
    return () => {
      // Flush before switching thread
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        flushSaveMessages(activeThreadIdRef.current, messagesRef.current);
      }
      lastSavedStateRef.current = {};
    };
  }, [activeThreadId]);

  // Save latest messages to SQLite with smooth debounce
  useEffect(() => {
    if (activeThreadId && messages.length > 0 && vscodeApi) {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      
      debounceTimerRef.current = setTimeout(() => {
        flushSaveMessages(activeThreadId, messages);
      }, 500); // 500ms responsive debounce
    }
    
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        // Guarantee pending work is not dropped when messages state updates rapidly
        flushSaveMessages(activeThreadIdRef.current, messagesRef.current);
      }
    };
  }, [messages, activeThreadId]);

  const handleClearChat = () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      if (activeThreadIdRef.current && messagesRef.current.length > 0) {
        flushSaveMessages(activeThreadIdRef.current, messagesRef.current);
      }
    }
    lastSavedStateRef.current = {};
    if (vscodeApi) {
      vscodeApi.postMessage({ command: 'createNewThread' });
    }
  };

  const handleSelectThread = (threadId: string) => {
    if (!vscodeApi) return;
    if (threadId === activeThreadId) {
      return;
    }
    // Flush pending changes before switching
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      if (activeThreadIdRef.current && messagesRef.current.length > 0) {
        flushSaveMessages(activeThreadIdRef.current, messagesRef.current);
      }
    }
    setIsLoadingThread(true);
    lastSavedStateRef.current = {};
    vscodeApi.postMessage({ command: 'loadChatThread', threadId });
  };

  const handleDeleteThread = (threadId: string) => {
    if (vscodeApi) {
      vscodeApi.postMessage({ command: 'requestDeleteChatThread', threadId });
    }
  };

  const handleRenameThread = (threadId: string, newTitle: string) => {
    if (vscodeApi) {
      vscodeApi.postMessage({ command: 'renameChatThread', threadId, title: newTitle });
    }
  };

  const handleClearAllThreads = () => {
    if (vscodeApi) {
      vscodeApi.postMessage({ command: 'clearAllChatThreads' });
    }
  };

  const handleExportThread = (threadId: string) => {
    if (vscodeApi) {
      vscodeApi.postMessage({ command: 'exportChatThread', threadId });
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
          if (message.workspaceRoot) {
            setWorkspaceRoot(message.workspaceRoot);
          }
          break;
        case 'imageAttachedFromDisk':
          if (message.dataUrl) {
            setAttachedImages(prev => {
              if (prev.length >= 3) return prev;
              return [...prev, message.dataUrl];
            });
            if (vscodeApi) {
              vscodeApi.postMessage({ command: 'log', text: `📸 Attached dropped image: ${message.filename}`, logType: 'info' });
            }
          }
          break;
        case 'settingsState': {
          const currentSelected = selectedModelRef.current;
          if (message.localLlmModelName !== undefined) {
            setActiveLocalModel(message.localLlmModelName || '');
          }
          if (message.activeDiffusionModel !== undefined) {
            setActiveDiffusionModel(message.activeDiffusionModel || '');
          }

          if (message.model) {
            setSelectedModel(message.model);
          } else if (currentSelected?.startsWith('diffusion:')) {
            if (message.activeDiffusionModel) {
              setSelectedModel(`diffusion:${message.activeDiffusionModel}`);
            } else if (message.localLlmModelName) {
              setSelectedModel(`local:${message.localLlmModelName}`);
            } else {
              setSelectedModel('');
            }
          } else if (currentSelected?.startsWith('local:')) {
            if (message.localLlmModelName) {
              setSelectedModel(`local:${message.localLlmModelName}`);
            } else if (message.activeDiffusionModel) {
              setSelectedModel(`diffusion:${message.activeDiffusionModel}`);
            } else {
              setSelectedModel('');
            }
          } else {
            if (message.activeDiffusionModel && !message.localLlmModelName) {
              setSelectedModel(`diffusion:${message.activeDiffusionModel}`);
            } else if (message.localLlmModelName) {
              setSelectedModel(`local:${message.localLlmModelName}`);
            }
          }
          if (message.availableLocalModels && Array.isArray(message.availableLocalModels)) {
            setAvailableLocalModels(message.availableLocalModels);
          }
          if (message.ctx_size) {
            setMaxContextTokens(message.ctx_size);
          }
          break;
        }

        case 'imageGeneratingStart':
          setIsAgentThinking(true);
          setMessages(prev => {
            const copy = [...prev];
            const targetIdx = message.messageId ? copy.findIndex(m => m.id === message.messageId) : copy.length - 1;
            if (targetIdx !== -1) {
              copy[targetIdx] = {
                ...copy[targetIdx],
                isGeneratingImage: true,
                generatedImagePrompt: message.prompt,
                startTime: Date.now()
              };
            }
            return copy;
          });
          break;

        case 'imageGeneratingComplete':
          setIsAgentThinking(false);
          setMessages(prev => {
            const copy = [...prev];
            const targetIdx = message.messageId ? copy.findIndex(m => m.id === message.messageId) : copy.length - 1;
            if (targetIdx !== -1) {
              copy[targetIdx] = {
                ...copy[targetIdx],
                isGeneratingImage: false,
                endTime: Date.now(),
                text: `![Generated Art](data:image/png;base64,${message.b64_json})\n\n*Saved to \`${message.savedPath}\`*`,
                generatedImageB64: message.b64_json
              };
            }
            return copy;
          });
          break;

        case 'imageGeneratingFailed':
          setIsAgentThinking(false);
          setMessages(prev => {
            const copy = [...prev];
            const targetIdx = message.messageId ? copy.findIndex(m => m.id === message.messageId) : copy.length - 1;
            if (targetIdx !== -1) {
              copy[targetIdx] = {
                ...copy[targetIdx],
                isGeneratingImage: false,
                endTime: Date.now(),
                text: `❌ Image generation failed: ${message.error || 'Diffusion Engine error'}`
              };
            }
            return copy;
          });
          break;

        case 'modelLoaded':
          if (message.modelId) {
            const baseName = message.modelId.split('/').pop() || message.modelId;
            setActiveLocalModel(baseName);
            setSelectedModel(`local:${baseName}`);
          }
          if (message.ctx_size) {
            setMaxContextTokens(message.ctx_size);
          }
          break;

        case 'modelUnloaded':
          setActiveLocalModel('');
          setSelectedModel('');
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
                message.text.includes('Connected directly') ||
                message.text.includes('connected directly') ||
                message.text.includes('checkpoint safety') ||
                message.text.includes('Response delivered') ||
                message.text.includes('permanent project memory') ||
                message.text.includes('Extracting permanent') ||
                message.text.includes('Task completed successfully') ||
                message.text.includes('Initializing isolated') ||
                message.text.includes('Copy-on-Write Shadow') ||
                message.text.includes('Starting Exovon AI Agent') ||
                message.text.includes('AI reasoning step') ||
                message.text.includes('Auto-Retrigger');

              // Only real errors, warnings, or explicit user milestones belong in the task progress stepper
              if (!isInternalVerboseLog && (message.logType === 'error' || message.logType === 'warning' || message.text.includes('Plan approved') || message.text.includes('Plan submitted'))) {
                timeline.push({
                  id: 'log-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
                  type: 'log',
                  status: message.logType === 'error' ? 'failed' : 'running',
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
              const currentMetrics = copy[targetIdx].metrics || {};
              const merged = {
                ...currentMetrics,
                ...message.metrics
              };
              if (!merged.total_tokens && merged.prompt_tokens && merged.completion_tokens) {
                merged.total_tokens = merged.prompt_tokens + merged.completion_tokens;
              }
              copy[targetIdx] = {
                ...copy[targetIdx],
                metrics: merged,
                promptTokens: merged.prompt_tokens || copy[targetIdx].promptTokens
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
          if (!message.messageId) break;
          setMessages(prev => {
            const copy = [...prev];
            const targetIdx = copy.findIndex(m => m.id === message.messageId);
            if (targetIdx !== -1) {
              const currentMetrics = copy[targetIdx].metrics || {};
              copy[targetIdx] = {
                ...copy[targetIdx],
                metrics: {
                  ...currentMetrics,
                  total_tokens: message.totalTokens || currentMetrics.total_tokens
                }
              };
            }
            return copy;
          });
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

        case 'agentCancelled':
          setIsAgentThinking(false);
          setStopClicks(0);
          setMessages(prev => {
            const copy = [...prev];
            for (let i = copy.length - 1; i >= 0; i--) {
              if (copy[i].sender === 'agent') {
                const msgCopy = { ...copy[i], isCancelled: true, endTime: Date.now() };
                if (msgCopy.toolCalls) {
                  msgCopy.toolCalls = msgCopy.toolCalls.map(t => {
                    if (t.status === 'running') return { ...t, status: 'stopped' };
                    return t;
                  });
                }
                if (msgCopy.planSteps) {
                  msgCopy.planSteps = msgCopy.planSteps.map(p => {
                    if (p.status === 'running') return { ...p, status: 'stopped' };
                    return p;
                  });
                }
                if (msgCopy.timeline) {
                  msgCopy.timeline = msgCopy.timeline.map(e => {
                    if (e.status === 'running') return { ...e, status: 'stopped' };
                    return e;
                  });
                }
                copy[i] = msgCopy;
                break;
              }
            }
            return copy;
          });
          setTimeout(() => {
            if (activeThreadIdRef.current) {
              flushSaveMessages(activeThreadIdRef.current, messagesRef.current);
            }
          }, 40);
          break;

        case 'agentComplete':
          setIsAgentThinking(false);
          setStopClicks(0);
          setMessages(prev => {
            const copy = [...prev];
            // Sweep ALL messages to force any stuck 'running' states to clean final states
            let updated = false;
            for (let i = 0; i < copy.length; i++) {
              if (copy[i].sender === 'agent') {
                const msgCopy = { ...copy[i] };
                const wasCancelled = Boolean(msgCopy.isCancelled);
                if (msgCopy.toolCalls) {
                  msgCopy.toolCalls = msgCopy.toolCalls.map(t => {
                    if (t.status === 'running') {
                      updated = true;
                      return { ...t, status: wasCancelled ? 'stopped' : 'failed' };
                    }
                    return t;
                  });
                }
                if (msgCopy.planSteps) {
                  msgCopy.planSteps = msgCopy.planSteps.map(p => {
                    if (p.status === 'running') {
                      updated = true;
                      return { ...p, status: wasCancelled ? 'stopped' : 'success' };
                    }
                    return p;
                  });
                }
                if (msgCopy.timeline) {
                  msgCopy.timeline = msgCopy.timeline.map(e => {
                    if (e.status === 'running') {
                      updated = true;
                      return { ...e, status: wasCancelled ? 'stopped' : (e.type === 'think' ? 'success' : 'failed') };
                    }
                    return e;
                  });
                }
                if (updated) copy[i] = msgCopy;
              }
            }
            return copy;
          });
          setTimeout(() => {
            if (activeThreadIdRef.current) {
              flushSaveMessages(activeThreadIdRef.current, messagesRef.current);
            }
          }, 40);
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
                    text: message.approved ? 'Plan approved and executed.' : 'Implementation Plan was rejected.'
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
              
              let parsedArgs: Record<string, any> = {};
              try { parsedArgs = JSON.parse(message.toolArgs); } catch { /* ignore */ }

              const filePath = parsedArgs.relativePath || parsedArgs.TargetFile || parsedArgs.AbsolutePath || parsedArgs.DirectoryPath || parsedArgs.SearchPath || parsedArgs.path || '';
              const baseFileName = filePath ? filePath.split('/').pop() : '';

              // Extract line numbers from input arguments
              let lineInfo = '';
              const startLine = parsedArgs.startLine ?? parsedArgs.StartLine;
              const endLine = parsedArgs.endLine ?? parsedArgs.EndLine;
              if (startLine !== undefined && endLine !== undefined) {
                lineInfo = `${startLine}-${endLine}`;
              } else if (startLine !== undefined) {
                lineInfo = `line ${startLine}`;
              }

              let actionVerb = 'Run';
              let targetDisplay = '';

              if (message.toolName === 'viewFile' || message.toolName === 'readFile') {
                actionVerb = 'Read';
                targetDisplay = baseFileName || filePath || 'file';
              } else if (message.toolName === 'listDir') {
                actionVerb = 'List';
                targetDisplay = parsedArgs.relativePath || '.';
              } else if (message.toolName === 'multiReplaceFileContent' || message.toolName === 'replaceFileContent' || message.toolName === 'applyPatch' || message.toolName === 'write_to_file') {
                actionVerb = 'Edit';
                targetDisplay = baseFileName || filePath || 'file';
              } else if (message.toolName === 'createFile') {
                actionVerb = 'Create';
                targetDisplay = baseFileName || filePath || 'file';
              } else if (message.toolName === 'deleteFile') {
                actionVerb = 'Delete';
                targetDisplay = baseFileName || filePath || 'file';
              } else if (message.toolName === 'runCommand' || message.toolName === 'run_command') {
                actionVerb = 'Run';
                const cmd = parsedArgs.CommandLine || parsedArgs.command || '';
                targetDisplay = cmd.length > 35 ? cmd.substring(0, 32) + '...' : cmd;
              } else if (message.toolName === 'grepSearch' || message.toolName === 'grep_search') {
                actionVerb = 'Search';
                const q = parsedArgs.query || parsedArgs.Query || '';
                targetDisplay = q ? `"${q}"` : '';
              } else if (message.toolName === 'semanticSearch') {
                actionVerb = 'Search';
                const q = parsedArgs.query || '';
                targetDisplay = q ? `"${q}"` : '';
              } else if (message.toolName === 'searchWeb' || message.toolName === 'search_web') {
                actionVerb = 'Web';
                const q = parsedArgs.query || parsedArgs.Query || '';
                targetDisplay = q ? `"${q}"` : '';
              } else if (message.toolName === 'generateImage') {
                actionVerb = 'Generate Image';
                targetDisplay = parsedArgs.prompt ? `"${parsedArgs.prompt.substring(0, 25)}..."` : '';
              } else {
                actionVerb = message.toolName.replace(/([A-Z])/g, ' $1').trim();
                targetDisplay = baseFileName || '';
              }

              const toolTitle = `${actionVerb} ${targetDisplay}`.trim();

              timeline.push({
                id: message.toolId,
                type: 'tool',
                status: 'running',
                title: toolTitle,
                actionVerb,
                targetDisplay,
                lineInfo,
                filePath,
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
                  let detectedLineInfo = timeline[toolIdx].lineInfo;
                  if (!detectedLineInfo && message.toolOutput) {
                    const rangeMatch = message.toolOutput.match(/Showing lines (\d+) to (\d+)/i);
                    const lineMatch = message.toolOutput.match(/\((\d+)\s*lines total\)/i);
                    if (rangeMatch) {
                      detectedLineInfo = `${rangeMatch[1]}-${rangeMatch[2]}`;
                    } else if (lineMatch) {
                      detectedLineInfo = `1-${lineMatch[1]}`;
                    }
                  }

                  timeline[toolIdx] = {
                    ...timeline[toolIdx],
                    status: message.toolStatus as 'running' | 'success' | 'failed',
                    lineInfo: detectedLineInfo || timeline[toolIdx].lineInfo,
                    output: message.toolOutput || timeline[toolIdx].output
                  };
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

        case 'checkpointCreated':
          if (message.checkpoint) {
            setMessages(prev => {
              const copy = [...prev];
              const targetIdx = message.messageId ? copy.findIndex(m => m.id === message.messageId) : copy.length - 1;
              if (targetIdx !== -1) {
                copy[targetIdx] = {
                  ...copy[targetIdx],
                  checkpointId: message.checkpoint.id,
                  checkpoint: message.checkpoint
                };
              }
              return copy;
            });
          }
          break;

        case 'checkpointRollbackComplete':
          if (message.checkpoint) {
            setMessages(prev => {
              const targetIdx = prev.findIndex(m => m.checkpointId === message.checkpoint.id);
              if (targetIdx !== -1) {
                return prev.slice(0, targetIdx + 1);
              }
              return prev;
            });
          }
          break;

        case 'commandApprovalRequested':
          setMessages(prev => [
            ...prev,
            {
              id: message.id,
              sender: 'agent',
              text: `Host terminal command requires your review and explicit approval:`,
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
              text: `Workspace file action requires your review and explicit approval:`,
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
          }
          if (message.workspaceRoot) {
            setWorkspaceRoot(message.workspaceRoot);
          }
          break;
        case 'newThreadCreated':
          setIsLoadingThread(false);
          if (message.threadId) {
            setActiveThreadId(message.threadId);
            activeThreadIdRef.current = message.threadId;
            lastSavedStateRef.current = {};
            setMessages([{
              id: 'welcome',
              sender: 'agent',
              text: 'I am Astrolabe, your autonomous AI assistant. I can help you research topics, answer questions, analyze documentation, and build or modify your code. How can I assist you today?',
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              isHistory: true
            }]);
          }
          break;
        case 'chatHistoryLoaded':
          setIsLoadingThread(false);
          if (message.threadId) {
            setActiveThreadId(message.threadId);
            activeThreadIdRef.current = message.threadId;
          }
          lastSavedStateRef.current = {};
          if (message.messages && message.messages.length > 0) {
            message.messages.forEach((m: any) => {
              if (m && m.id) {
                lastSavedStateRef.current[m.id] = JSON.stringify(m);
              }
            });
            setMessages(message.messages.map((m: unknown) => ({ ...(m as object), isHistory: true })));
          } else {
             setMessages([{
              id: 'welcome',
              sender: 'agent',
              text: 'I am Astrolabe, your autonomous AI assistant. I can help you research topics, answer questions, analyze documentation, and build or modify your code. How can I assist you today?',
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
      }
    };

    window.addEventListener('message', handleMessage);
    
    if (vscodeApi) {
      vscodeApi.postMessage({ command: 'getWorkspaceInfo' });
      vscodeApi.postMessage({ command: 'getSettingsState' });
      vscodeApi.postMessage({ command: 'getChatThreads' });
      // Start in a fresh new chat session for this workspace on launch
      vscodeApi.postMessage({ command: 'createNewThread' });
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

    // Ensure active thread ID exists synchronously so no messages are dropped
    let currentThreadId = activeThreadId;
    if (!currentThreadId) {
      currentThreadId = `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setActiveThreadId(currentThreadId);
      activeThreadIdRef.current = currentThreadId;
    }

    const userMsgId = generateMessageId('user');
    const agentId = generateMessageId('agent');

    // Capture images synchronously for the message payload
    const imagesToSubmit = [...attachedImages];

    const userMsg: Message = {
      id: userMsgId,
      sender: 'user',
      text: promptText,
      images: imagesToSubmit,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    // Use flushSync to guarantee state and DOM are fully committed before triggering backend.
    // This fixes the React batching race condition where rapid backend stream replies would
    // mistakenly fetch the previous state's last agent message.
    flushSync(() => {
      setInputValue('');
      setAttachedImages([]);
      setIsAgentThinking(true);

      // Append initial agent response structure WITHOUT hardcoded plans
      const effectiveModel = selectedModel || (activeDiffusionModel && !activeLocalModel ? `diffusion:${activeDiffusionModel}` : (activeLocalModel ? `local:${activeLocalModel}` : ''));
      const isDiff = effectiveModel?.startsWith('diffusion:');
      const agentPlaceholderMsg: Message = {
        id: agentId,
        sender: 'agent',
        text: '',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        startTime: Date.now(),
        isGeneratingImage: isDiff,
        generatedImagePrompt: isDiff ? promptText : undefined
      };
      
      setMessages(prev => [...prev, userMsg, agentPlaceholderMsg]);
    });

    // Immediate save of user prompt to persistent store
    flushSaveMessages(currentThreadId, [...messagesRef.current]);

    // Call Backend Extension
    if (vscodeApi) {
      const effectiveModel = selectedModel || (activeDiffusionModel && !activeLocalModel ? `diffusion:${activeDiffusionModel}` : (activeLocalModel ? `local:${activeLocalModel}` : ''));
      const isDiff = effectiveModel?.startsWith('diffusion:');
      vscodeApi.postMessage({
        command: 'initiateAgent',
        mode: 'architect',
        model: effectiveModel || undefined,
        isDiffusion: isDiff,
        prompt: promptText,
        contextFiles: selectedContextFiles.map(f => f.name),
        images: imagesToSubmit,
        messageId: agentId,
        threadId: currentThreadId,
        messages: messages.map(m => ({ id: m.id, sender: m.sender, text: m.text, timestamp: m.timestamp }))
      });
    }
  };

  // Global capture for clipboard shortcuts (Ctrl+C, Ctrl+V, Ctrl+X, Ctrl+A) to guarantee native execution in inputs
  useEffect(() => {
    const handleCaptureKeyDown = (e: KeyboardEvent) => {
      const isCtrl = e.ctrlKey || e.metaKey;
      if (isCtrl && e.key) {
        const k = e.key.toLowerCase();
        if (['c', 'v', 'x', 'a', 'z', 'y'].includes(k)) {
          const target = e.target as HTMLElement;
          const isInput = target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable);
          if (isInput) {
            e.stopPropagation();
            if (k === 'a' && (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement)) {
              target.select();
            }
          }
        }
      }
    };
    window.addEventListener('keydown', handleCaptureKeyDown, true);
    return () => window.removeEventListener('keydown', handleCaptureKeyDown, true);
  }, []);

  return (
    <div className="h-screen overflow-hidden bg-transparent flex flex-col px-3 py-2.5 relative font-sans">

      {/* NATIVE NAVIGATION TABS */}
      <nav role="tablist" aria-label="Main Navigation" className="flex items-center justify-between bg-[#141416] p-1 rounded-xl mb-2.5 text-xs select-none border border-white/10 shadow-sm">
        <div className="flex-1 flex items-center gap-0.5 min-w-0">
          <button
            role="tab"
            aria-selected={activeTab === 'agent'}
            aria-controls="tabpanel-agent"
            onClick={() => setActiveTab('agent')}
            className={`flex-1 py-1.5 font-semibold transition-all duration-150 rounded-lg text-center truncate px-1 ${
              activeTab === 'agent'
                ? 'bg-[#26262a] text-white font-bold shadow-sm border border-white/10'
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
                ? 'bg-[#26262a] text-white font-bold shadow-sm border border-white/10'
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
                ? 'bg-[#26262a] text-white font-bold shadow-sm border border-white/10'
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
                ? 'bg-[#26262a] text-white font-bold shadow-sm border border-white/10'
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
            className="flex items-center gap-1 px-2 py-1 bg-white/5 hover:bg-white/10 text-zinc-300 hover:text-white border border-white/10 rounded-lg text-[10px] font-mono font-medium transition-all shadow-sm shrink-0"
            title="Start New Chat"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4"/>
            </svg>
            <span className="hidden xs:inline">New</span>
          </button>

          <button
            onClick={() => setIsThreadsSidebarOpen(true)}
            className="p-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-zinc-400 hover:text-zinc-200 transition-colors shrink-0"
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
            planLevel={planLevel}
            setPlanLevel={setPlanLevel}
            vscodeApi={vscodeApi}
            chatEndRef={chatEndRef}
            workspaceRoot={workspaceRoot}
            activeEditorFile={activeEditorFile}
            isPreempting={isPreempting}
            selectedModel={selectedModel}
            inspectorActive={inspectorActive}
            attachedImages={attachedImages}
            setAttachedImages={setAttachedImages}
            quotaInfo={quotaInfo}
            activeLocalModel={activeLocalModel}
            activeDiffusionModel={activeDiffusionModel}
            availableLocalModels={availableLocalModels}
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
        <div className="absolute inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => setIsGovernorModalOpen(false)}>
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

      {/* CHAT HISTORY DRAWER */}
      <ChatHistoryDrawer
        isOpen={isThreadsSidebarOpen}
        onClose={() => setIsThreadsSidebarOpen(false)}
        chatThreads={chatThreads}
        activeThreadId={activeThreadId}
        onSelectThread={handleSelectThread}
        onNewChat={handleClearChat}
        onDeleteThread={handleDeleteThread}
        onRenameThread={handleRenameThread}
        onClearAllThreads={handleClearAllThreads}
        onExportThread={handleExportThread}
      />

    </div>
  );
}
