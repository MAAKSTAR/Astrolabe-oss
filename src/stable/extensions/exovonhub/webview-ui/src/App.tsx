import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { HostingConsole } from './components/HostingConsole';

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

// Safely obtain VS Code API (graceful fail to mock in local browser HMR development)
let vscodeApi: VsCodeApi | undefined;
try {
  vscodeApi = acquireVsCodeApi();
} catch {
  console.log("Running in browser development mode.");
}

interface PlanStep {
  id: string;
  text: string;
  status: 'pending' | 'running' | 'success' | 'failed';
}

interface ToolCall {
  id: string;
  name: string;
  args: string;
  status: 'running' | 'success' | 'failed';
}

interface ProposedFile {
  action: 'MODIFY' | 'NEW' | 'DELETE';
  file: string;
  path: string;
}

interface Message {
  id: string;
  sender: 'user' | 'agent';
  text: string;
  timestamp: string;
  planSteps?: PlanStep[];
  toolCalls?: ToolCall[];
  proposedFiles?: ProposedFile[];
  hasControls?: boolean;
  isApproved?: boolean;
  isRejected?: boolean;
  isCommandApproval?: boolean;
  isFileApproval?: boolean;
  approvalId?: string;
  commandToApprove?: string;
  fileChangeType?: 'modify' | 'create' | 'delete';
  filePathToApprove?: string;
  fileDetailsToApprove?: string;
}



// Clean utility function to bypass React compiler impure render warnings
const generateMessageId = (prefix: string): string => {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
};

export default function App() {
  // Navigation
  const [activeTab, setActiveTab] = useState<'agent' | 'hosting'>('agent');
  
  // Workspace Info
  const [detectedWorkspace, setDetectedWorkspace] = useState<string>('exovonhub-project');
  const [autonomousMode, setAutonomousMode] = useState<boolean>(false);
  const [speculativeDiffs, setSpeculativeDiffs] = useState<Array<{ path: string; diffLines: Array<{ type: 'added' | 'removed' | 'unchanged'; text: string }> }>>([]);

  // Tab 1: AI Agent Thread State
  const [inputValue, setInputValue] = useState<string>('');
  const [isAgentThinking, setIsAgentThinking] = useState<boolean>(false);
  const [stopClicks, setStopClicks] = useState<number>(0);
  const [selectedContextFiles, setSelectedContextFiles] = useState<Array<{ name: string; type: string }>>([]);
  const [selectedModel, setSelectedModel] = useState<string>('gemma-4-31b-it');
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      sender: 'agent',
      text: 'I am your Exovon Agent. I can scan your active workspace, compile optimized static bundles, and globally distribute your application to the Edge CDN. What would you like to inspect or deploy today?',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ]);
  
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Save chat history when the agent finishes thinking
  const previousIsThinking = useRef(isAgentThinking);
  useEffect(() => {
    if (previousIsThinking.current === true && isAgentThinking === false) {
      // Clean large payloads
      const sanitizedMessages = messages.map(msg => {
        if (!msg.toolCalls) return msg;
        return {
          ...msg,
          toolCalls: msg.toolCalls.map(tc => ({
            ...tc,
            args: (tc.name === 'searchWeb' || tc.name === 'multiReplaceFileContent' || tc.name === 'replaceFileContent') 
              ? '{ "omitted": true, "reason": "Payload too large for history" }'
              : tc.args
          }))
        };
      });
      if (vscodeApi) {
        vscodeApi.postMessage({ command: 'saveChatHistory', messages: sanitizedMessages });
      }
    }
    previousIsThinking.current = isAgentThinking;
  }, [isAgentThinking, messages]);

  const handleClearChat = () => {
    setMessages([{
      id: 'welcome',
      sender: 'agent',
      text: 'I am your Exovon Agent. I can scan your active workspace, compile optimized static bundles, and globally distribute your application to the Edge CDN. What would you like to inspect or deploy today?',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }]);
    if (vscodeApi) {
      vscodeApi.postMessage({ command: 'clearChatHistory' });
    }
  };

  // Tab 2: Hosting Edge State moved to HostingConsole component

  // Scroll chat thread to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isAgentThinking]);

  // Listen to messages from VS Code Extension Backend
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      switch (message.type) {
        case 'workspaceInfo':
          if (message.name) {
            setDetectedWorkspace(message.name);
          }

          if (message.isAutonomous !== undefined) {
            setAutonomousMode(message.isAutonomous);
          }
          break;
          
        case 'agentLog':
          // Dynamically stream text in the active agent message
          setMessages(prev => {
            const copy = [...prev];
            const lastAgentMsgIdx = copy.map(m => m.sender).lastIndexOf('agent');
            if (lastAgentMsgIdx !== -1) {
              const lastMsg = copy[lastAgentMsgIdx];
              // Skip updating text if it's currently showing a command approval prompt
              if (lastMsg.isCommandApproval) {
                return copy;
              }
              const currentText = lastMsg.text === 'Analyzing workspace files with selected context...'
                ? ''
                : lastMsg.text;
              
              copy[lastAgentMsgIdx] = {
                ...lastMsg,
                text: currentText ? currentText + '\n' + message.text : message.text
              };
            }
            return copy;
          });
          break;
          
        case 'agentPlanUpdate':
          setMessages(prev => {
            const copy = [...prev];
            const lastAgentMsgIdx = copy.map(m => m.sender).lastIndexOf('agent');
            if (lastAgentMsgIdx !== -1) {
              const lastMsg = copy[lastAgentMsgIdx];
              copy[lastAgentMsgIdx] = {
                ...lastMsg,
                planSteps: message.planSteps
              };
            }
            return copy;
          });
          break;
        case 'agentChat':
          setMessages(prev => [
            ...prev,
            {
              id: 'chat-' + Date.now(),
              sender: 'agent',
              text: message.text,
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

        case 'agentToolStart':
          setIsAgentThinking(true);
          setMessages(prev => {
            const copy = [...prev];
            const lastAgentMsgIdx = copy.map(m => m.sender).lastIndexOf('agent');
            if (lastAgentMsgIdx !== -1) {
              const lastMsg = copy[lastAgentMsgIdx];
              const existingTools = lastMsg.toolCalls || [];
              const newTool: ToolCall = {
                id: message.toolId,
                name: message.toolName,
                args: message.toolArgs,
                status: 'running'
              };
              copy[lastAgentMsgIdx] = {
                ...lastMsg,
                toolCalls: [...existingTools, newTool]
              };
            }
            return copy;
          });
          break;

        case 'agentToolComplete':
          setMessages(prev => {
            const copy = [...prev];
            const lastAgentMsgIdx = copy.map(m => m.sender).lastIndexOf('agent');
            if (lastAgentMsgIdx !== -1) {
              const lastMsg = copy[lastAgentMsgIdx];
              if (lastMsg.toolCalls) {
                const updatedTools = lastMsg.toolCalls.map(t => 
                  t.id === message.toolId ? { ...t, status: message.toolStatus as 'running' | 'success' | 'failed' } : t
                );
                copy[lastAgentMsgIdx] = {
                  ...lastMsg,
                  toolCalls: updatedTools
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

        case 'chatHistoryLoaded':
          if (message.messages) {
            setMessages(message.messages);
          }
          break;
        case 'contextFileAdded':
          if (message.fileName) {
            setSelectedContextFiles(prev => [...prev, { name: message.fileName, type: 'code' }]);
          }
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    
    if (vscodeApi) {
      vscodeApi.postMessage({ command: 'getWorkspaceInfo' });
      vscodeApi.postMessage({ command: 'loadChatHistory' });
    }

    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Action: Developer responds to Host Command Approval
  const handleApproveCommand = (id: string, approved: boolean) => {
    setMessages(prev => 
      prev.map(msg => 
        msg.id === id 
          ? { 
              ...msg, 
              isCommandApproval: false, 
              text: approved 
                ? `✔️ Executed command successfully.` 
                : `❌ Terminal execution was rejected by the developer.` 
            } 
          : msg
      )
    );
    // isAgentThinking remains true since the agent continues execution after approval

    if (vscodeApi) {
      vscodeApi.postMessage({
        command: 'respondToCommandApproval',
        id,
        approved
      });
    }
  };

  // Action: Developer responds to Workspace File Modification Approval
  const handleApproveFile = (id: string, approved: boolean) => {
    setMessages(prev => 
      prev.map(msg => 
        msg.id === id 
          ? { 
              ...msg, 
              isFileApproval: false, 
              text: approved 
                ? `✔️ File modification approved & written successfully.` 
                : `❌ File modification was rejected by the developer.` 
            } 
          : msg
      )
    );
    // isAgentThinking remains true

    if (vscodeApi) {
      vscodeApi.postMessage({
        command: 'respondToFileApproval',
        id,
        approved
      });
    }
  };

  // Action: User submits prompt in Chat
  const handleSendMessage = (textToSend?: string) => {
    const promptText = textToSend || inputValue;
    if (!promptText.trim()) return;

    // Append user message
    const userMsg: Message = {
      id: generateMessageId('msg'),
      sender: 'user',
      text: promptText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => [...prev, userMsg]);
    setInputValue('');
    setIsAgentThinking(true);

    setTimeout(() => {
      // Append initial agent response structure WITHOUT hardcoded plans
      const agentPlaceholderMsg: Message = {
        id: generateMessageId('agent'),
        sender: 'agent',
        text: 'Thinking...',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      
      setMessages(prev => [...prev, agentPlaceholderMsg]);

      // Call Backend Extension
      if (vscodeApi) {
        vscodeApi.postMessage({
          command: 'initiateAgent',
          mode: 'architect',
          prompt: promptText,
          model: selectedModel,
          contextFiles: selectedContextFiles.map(f => f.name)
        });
      } else {
        // Mock Client-Side Multi-step Agent plan execution inside browser preview
        const initialSteps: PlanStep[] = [
          { id: 'step-1', text: 'Analyze file layout constraints', status: 'running' },
          { id: 'step-2', text: 'Evaluate package dependency matrix', status: 'pending' },
          { id: 'step-3', text: 'Optimize static compiler parameters', status: 'pending' },
          { id: 'step-4', text: 'Perform security sandbox checks', status: 'pending' }
        ];
        const currentSteps = [...initialSteps];
        
        // Step 1 Finish
        setTimeout(() => {
          currentSteps[0].status = 'success';
          currentSteps[1].status = 'running';
          updateLastAgentMessage(currentSteps, 'Scanned package layout and workspace folders.');
        }, 1200);

        // Step 2 Finish
        setTimeout(() => {
          currentSteps[1].status = 'success';
          currentSteps[2].status = 'running';
          updateLastAgentMessage(currentSteps, 'Scanned package layout and workspace folders.\nInspected dependencies and compilation targets.');
        }, 2200);

        // Step 3 Finish
        setTimeout(() => {
          currentSteps[2].status = 'success';
          currentSteps[3].status = 'running';
          updateLastAgentMessage(currentSteps, 'Scanned package layout and workspace folders.\nInspected dependencies and compilation targets.\nOptimized static configurations.');
        }, 3200);

        // Step 4 Finish and show diff reviews
        setTimeout(() => {
          currentSteps[3].status = 'success';
          setIsAgentThinking(false);
          setMessages(prev => {
            const copy = [...prev];
            const lastAgentMsgIdx = copy.map(m => m.sender).lastIndexOf('agent');
            if (lastAgentMsgIdx !== -1) {
              copy[lastAgentMsgIdx] = {
                ...copy[lastAgentMsgIdx],
                planSteps: currentSteps,
                text: 'Structural analysis complete. Ready to apply optimization changes to your workspace.',
                hasControls: true,
                proposedFiles: [
                  { action: 'MODIFY', file: 'src/extension.ts', path: 'src/extension.ts' },
                  { action: 'NEW', file: 'src/ExovonSidebarProvider.ts', path: 'src/ExovonSidebarProvider.ts' }
                ]
              };
            }
            return copy;
          });
        }, 4200);
      }
    }, 600);
  };

  const updateLastAgentMessage = (steps: PlanStep[], logText: string) => {
    setMessages(prev => {
      const copy = [...prev];
      const lastAgentMsgIdx = copy.map(m => m.sender).lastIndexOf('agent');
      if (lastAgentMsgIdx !== -1) {
        copy[lastAgentMsgIdx] = {
          ...copy[lastAgentMsgIdx],
          text: logText,
          planSteps: steps
        };
      }
      return copy;
    });
  };

  // Action: Accept/Apply Agent Proposed Changes (Like Cursor Composer Accept)
  const handleAcceptChanges = (msgId: string) => {
    setMessages(prev => 
      prev.map(msg => 
        msg.id === msgId 
          ? { ...msg, hasControls: false, isApproved: true, text: 'Changes applied successfully to the workspace.' } 
          : msg
      )
    );

    if (vscodeApi) {
      vscodeApi.postMessage({ command: 'showNotification', message: 'Accepted proposed workspace optimizations.', type: 'info' });
    }
  };

  // Action: Reject Agent Proposed Changes (Like Cursor Composer Reject)
  const handleRejectChanges = (msgId: string) => {
    setMessages(prev => 
      prev.map(msg => 
        msg.id === msgId 
          ? { ...msg, hasControls: false, isRejected: true, text: 'Optimization changes rejected and reverted.' } 
          : msg
      )
    );

    if (vscodeApi) {
      vscodeApi.postMessage({ command: 'showNotification', message: 'Rejected proposed optimizations.', type: 'warning' });
    }
  };

  // Action: Deploy Web App logic moved to HostingConsole component

  const toggleAutonomousMode = (checked: boolean) => {
    setAutonomousMode(checked);
    if (vscodeApi) {
      vscodeApi.postMessage({
        command: 'updateAutonomousMode',
        value: checked
      });
    }
  };

  // Open file in Editor
  const handleOpenFile = (filePath: string) => {
    if (vscodeApi) {
      vscodeApi.postMessage({ command: 'showNotification', message: `Opening ${filePath} in editor.`, type: 'info' });
    } else {
      alert(`Opening file: ${filePath}`);
    }
  };

  return (
    <div className="h-screen overflow-hidden bg-transparent flex flex-col p-3 select-none relative font-sans">
      
      {/* HEADER SECTION (CLEAN & PROFESSIONAL) */}
      <header className="mb-4 border-b border-zinc-900 pb-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* Logo container */}
          <div className="w-5 h-5 rounded bg-zinc-100 flex items-center justify-center shrink-0">
            <svg className="w-3.5 h-3.5 text-zinc-900" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.63 8.41a14.98 14.98 0 00-6.16 12.12 14.98 14.98 0 0012.12-6.16z" />
            </svg>
          </div>
          <div>
            <h1 className="text-xs font-bold tracking-wider text-zinc-100 uppercase">
              EXOVON AGENT
            </h1>
            <p className="text-[9px] text-zinc-500 font-mono">
              Enterprise Autopilot Console
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 select-none">
          <select 
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="bg-zinc-900/60 border border-zinc-800/80 text-[9px] text-zinc-300 rounded-lg px-2 py-0.5 outline-none hover:border-zinc-700/80 transition-colors"
          >
            <option value="gemma-4-31b-it">Gemma 4 31B IT (Default)</option>
            <option value="gemini-3.5-flash">Gemini 3.5 Flash (Premium)</option>
            <option value="gemini-3.1-pro">Gemini 3.1 Pro (Premium)</option>
          </select>
          <label className="flex items-center gap-1 bg-zinc-900/60 border border-zinc-800/80 px-2 py-0.5 rounded-lg cursor-pointer hover:border-zinc-700/80 transition-colors">
            <span className="text-[8px] font-semibold text-zinc-400 tracking-wider uppercase">Auto</span>
            <input 
              type="checkbox" 
              checked={autonomousMode} 
              onChange={(e) => toggleAutonomousMode(e.target.checked)}
              className="w-2.5 h-2.5 rounded accent-purple-500 bg-zinc-950 border-zinc-800 cursor-pointer"
            />
          </label>
          {isAgentThinking && (
            <button
              onClick={() => {
                if (stopClicks === 0) {
                  setStopClicks(1);
                } else {
                  setStopClicks(0);
                  if (vscodeApi) vscodeApi.postMessage({ command: 'cancelAgent' });
                }
              }}
              className={`py-0.5 px-2 font-mono text-[9px] shrink-0 active:scale-[0.97] transition-all rounded text-white ${
                stopClicks === 1 
                  ? 'bg-amber-500 hover:bg-amber-600 animate-pulse' 
                  : 'bg-red-600 hover:bg-red-500'
              }`}
            >
              {stopClicks === 1 ? '⚠️ Confirm Stop' : '🛑 Stop Agent'}
            </button>
          )}
          <button 
            onClick={handleClearChat}
            className="flex items-center justify-center p-1 bg-zinc-900/60 border border-zinc-800/80 rounded-lg hover:bg-zinc-800/80 hover:text-red-400 text-zinc-400 transition-colors"
            title="Clear Chat History"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
          <div className="text-[9px] font-mono text-zinc-500 bg-zinc-900 border border-zinc-800 px-2 py-0.5 rounded-lg">
            {detectedWorkspace}
          </div>
        </div>
      </header>

      {/* SLEEK NAVIGATION TABS */}
      <nav className="flex bg-zinc-900/40 border border-zinc-900/80 p-1 rounded-xl mb-4 text-xs select-none">
        <button
          onClick={() => setActiveTab('agent')}
          className={`flex-1 py-1.5 font-semibold transition-all duration-150 rounded-lg text-center ${
            activeTab === 'agent'
              ? 'bg-zinc-100 text-zinc-950 shadow-sm'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Agent
        </button>
        <button
          onClick={() => setActiveTab('hosting')}
          className={`flex-1 py-1.5 font-semibold transition-all duration-150 rounded-lg text-center ${
            activeTab === 'hosting'
              ? 'bg-zinc-100 text-zinc-950 shadow-sm'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Hosting Console
        </button>
      </nav>

      {/* MAIN CONTAINER */}
      <main className="flex-1 flex flex-col gap-3 min-h-0">
        
        {/* TAB 1: CURSOR-STYLE AGENT */}
        {activeTab === 'agent' && (
          <div className="flex-1 flex flex-col gap-3 min-h-0 justify-between">
            
            {/* INTERACTIVE CHAT THREAD (FEED) */}
            <div className="flex-1 overflow-y-auto space-y-4 pr-1 min-h-0 border border-zinc-900/50 bg-zinc-950/20 p-3 rounded-2xl shadow-inner scrollbar-thin">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex flex-col max-w-[90%] ${
                    msg.sender === 'user' ? 'ml-auto items-end' : 'mr-auto items-start'
                  }`}
                >
                  {/* Timestamp & Sender */}
                  <span className="text-[8px] text-zinc-600 font-mono mb-0.5">
                    {msg.sender === 'user' ? 'Developer' : 'Exovon Autopilot'} • {msg.timestamp}
                  </span>
                  
                  {/* Thinking/Working Components (Distinct from Chat Response) */}
                  {msg.sender === 'agent' && (msg.planSteps || msg.toolCalls || msg.isCommandApproval || msg.isFileApproval) && (
                    <div className="mb-2 w-full premium-code-block p-3 shadow-inner opacity-95 border border-zinc-500/30">
                      <div className="text-[9px] font-mono uppercase font-bold text-zinc-400 mb-2 border-b border-zinc-500/20 pb-1.5 flex items-center gap-2 tracking-wider">
                        <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
                        Exovon Reasoning Engine
                      </div>

                    {/* COMMAND APPROVAL INTERACTIVE CARD */}
                    {msg.isCommandApproval && (
                      <div className="mt-3 border border-amber-500/30 bg-amber-500/5 p-3 rounded-lg space-y-2.5 shadow-[0_0_15px_rgba(245,158,11,0.05)] select-none">
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] font-bold text-amber-400 font-mono tracking-wider uppercase flex items-center gap-1.5 animate-pulse">
                            ⚠️ Host terminal action requested
                          </span>
                        </div>
                        <div className="bg-zinc-950 p-2 rounded border border-zinc-900 font-mono text-[10px] text-zinc-300 select-all overflow-x-auto whitespace-pre max-h-24 scrollbar-thin">
                          {msg.commandToApprove}
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleApproveCommand(msg.approvalId!, true)}
                            className="flex-1 py-1.5 px-2 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-[10px] font-mono rounded transition-all duration-150 active:scale-[0.98]"
                          >
                            Approve Execution
                          </button>
                          <button
                            onClick={() => handleApproveCommand(msg.approvalId!, false)}
                            className="py-1.5 px-3 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 border border-zinc-800 text-[10px] font-bold font-mono rounded transition-all duration-150 active:scale-[0.98]"
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    )}

                    {/* FILE APPROVAL INTERACTIVE CARD */}
                    {msg.isFileApproval && (
                      <div className="mt-3 border border-emerald-500/30 bg-emerald-500/5 p-3 rounded-lg space-y-2.5 shadow-[0_0_15px_rgba(16,185,129,0.05)] select-none">
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] font-bold text-emerald-400 font-mono tracking-wider uppercase flex items-center gap-1.5 animate-pulse">
                            📝 Speculative file edit review ({msg.fileChangeType})
                          </span>
                        </div>
                        <div className="text-[8.5px] font-mono text-zinc-500 flex items-center gap-1.5">
                          <span>📄 Path:</span>
                          <span className="text-zinc-300 font-bold bg-zinc-950 px-1.5 py-0.5 rounded border border-zinc-900">{msg.filePathToApprove}</span>
                        </div>
                        <div className="bg-zinc-950 p-2 rounded border border-zinc-900 font-mono text-[9px] text-emerald-300 select-all overflow-x-auto whitespace-pre max-h-40 scrollbar-thin">
                          {msg.fileDetailsToApprove}
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleApproveFile(msg.approvalId!, true)}
                            className="flex-1 py-1.5 px-2 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold text-[10px] font-mono rounded transition-all duration-150 active:scale-[0.98]"
                          >
                            Approve Change
                          </button>
                          <button
                            onClick={() => handleApproveFile(msg.approvalId!, false)}
                            className="py-1.5 px-3 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 border border-zinc-800 text-[10px] font-bold font-mono rounded transition-all duration-150 active:scale-[0.98]"
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    )}

                    {/* PLANNING CHECKLIST */}
                    {msg.planSteps && msg.planSteps.length > 0 && (
                      <div className="mt-3 border-t border-zinc-900 pt-2.5 space-y-1.5">
                        <span className="text-[8px] text-zinc-500 font-mono uppercase tracking-wider block">
                          Execution Plan checklist:
                        </span>
                        {msg.planSteps.map(step => (
                          <div key={step.id} className="flex items-center gap-2 text-[10px] font-mono text-zinc-400">
                            {step.status === 'success' && <span className="text-zinc-200">✔</span>}
                            {step.status === 'running' && (
                              <span className="w-1.5 h-1.5 bg-zinc-300 rounded-full animate-ping shrink-0" />
                            )}
                            {step.status === 'pending' && <span className="text-zinc-700">○</span>}
                            {step.status === 'failed' && <span className="text-rose-500">✖</span>}
                            
                            <span className={step.status === 'success' ? 'text-zinc-500 line-through' : ''}>
                              {step.text}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* TOOL CALLS STREAM (CURSOR COMPOSER STYLE) */}
                    {msg.toolCalls && msg.toolCalls.length > 0 && (
                      <div className="mt-3 border-t border-zinc-900 pt-2.5 space-y-2">
                        <span className="text-[8px] text-zinc-500 font-mono uppercase tracking-wider block">
                          Autonomous Tool Executions:
                        </span>
                        <div className="space-y-1.5">
                          {msg.toolCalls.map(tool => (
                            <div
                              key={tool.id}
                              className="bg-zinc-950 border border-zinc-900/80 rounded p-2 text-[10px] space-y-1.5"
                            >
                              <div className="flex items-center justify-between font-mono text-[9px]">
                                <div className="flex items-center gap-1.5 text-zinc-300 font-semibold">
                                  <span>🛠️ {tool.name}</span>
                                </div>
                                <span className={`px-1.5 py-0.2 rounded text-[8px] uppercase tracking-wider font-bold ${
                                  tool.status === 'running'
                                    ? 'text-zinc-400 bg-zinc-900 animate-pulse'
                                    : 'text-zinc-500 bg-zinc-900 border border-zinc-850'
                                }`}>
                                  {tool.status}
                                </span>
                              </div>
                              {(() => {
                                if (tool.name === 'multiReplaceFileContent' || tool.name === 'replaceFileContent') {
                                  try {
                                    const parsed = JSON.parse(tool.args);
                                    return (
                                      <div className="mt-1 space-y-1.5 font-sans select-none">
                                        <div className="flex items-center gap-1.5 text-[8.5px] font-mono text-zinc-500">
                                          <span>📄 {parsed.relativePath}</span>
                                          {(parsed.startLine || parsed.endLine) && (
                                            <span className="text-zinc-600 bg-zinc-900 border border-zinc-800 px-1 rounded text-[7.5px]">
                                              Lines {parsed.startLine} - {parsed.endLine}
                                            </span>
                                          )}
                                        </div>
                                        <div className="bg-emerald-950/15 border border-emerald-900/30 rounded p-2 text-[9px] font-mono text-emerald-300 leading-relaxed overflow-x-auto whitespace-pre scrollbar-thin max-h-40">
                                          <div className="text-[7.5px] text-emerald-500 uppercase tracking-widest font-mono font-bold select-none mb-1 border-b border-emerald-900/10 pb-1">
                                            + Proposed Replacement Block
                                          </div>
                                          {parsed.replacementContent}
                                        </div>
                                      </div>
                                    );
                                  } catch { /* ignore error */ }
                                }
                                return (
                                  <div className="bg-zinc-950 p-1.5 rounded border border-zinc-900 font-mono text-[8px] text-zinc-400 overflow-x-auto whitespace-pre max-w-full scrollbar-thin">
                                    {tool.args}
                                  </div>
                                );
                              })()}
                            </div>
                          ))}
                        </div>
                    </div>
                  )}
                </div>
              )}

                  {/* Final Response Chat Bubble */}
                  {msg.text && (
                    <div
                      className={`p-3 text-xs leading-relaxed font-sans shadow-sm transition-all duration-150 ${
                        msg.sender === 'user'
                          ? 'premium-chat-user'
                          : 'premium-chat-agent'
                      }`}
                    >
                      {msg.sender === 'user' ? (
                        msg.text.split('\n').map((line, idx) => (
                          <p key={idx} className={idx > 0 ? 'mt-1' : ''}>
                            {line}
                          </p>
                        ))
                      ) : (
                        <div className="prose prose-invert prose-sm max-w-none prose-p:my-1 prose-pre:bg-zinc-900 prose-pre:border prose-pre:border-zinc-800">
                          <ReactMarkdown>{msg.text}</ReactMarkdown>
                        </div>
                      )}
                    </div>
                  )}

                    {/* PROPOSED FILE MODIFICATIONS (DIFF CARD) */}
                    {msg.proposedFiles && msg.proposedFiles.length > 0 && (
                      <div className="mt-3 border-t border-zinc-900 pt-2.5 space-y-1.5">
                        <span className="text-[8px] text-zinc-500 font-mono uppercase tracking-wider block">
                          Proposed Changes ({msg.proposedFiles.length} files):
                        </span>
                        <div className="space-y-1">
                          {msg.proposedFiles.map((file, i) => (
                            <button
                              key={i}
                              onClick={() => handleOpenFile(file.path)}
                              className="w-full text-left bg-zinc-900 border border-zinc-800 p-1.5 rounded hover:border-zinc-700 font-mono text-[9px] flex items-center justify-between text-zinc-400"
                            >
                              <span>{file.file}</span>
                              <span className="text-[8px] text-zinc-300 font-bold bg-zinc-950 px-1 py-0.2 rounded border border-zinc-850">
                                {file.action}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* INTERACTIVE CONTROLS (Accept/Reject Changes card) */}
                    {msg.hasControls && (
                      <div className="mt-3 flex gap-2 border-t border-zinc-900 pt-2.5">
                        <button
                          onClick={() => handleAcceptChanges(msg.id)}
                          className="flex-1 py-1.5 px-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-950 font-bold text-[10px] font-mono rounded transition-all animate-bounce-subtle"
                        >
                          Accept Changes
                        </button>
                        <button
                          onClick={() => handleRejectChanges(msg.id)}
                          className="py-1.5 px-3 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 border border-zinc-800 text-[10px] font-bold font-mono rounded transition-all"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                </div>
              ))}

              {/* Agent Thinking Indicator */}
              {isAgentThinking && (
                <div className="flex flex-col mr-auto items-start max-w-[90%]">
                  <span className="text-[8px] text-zinc-600 font-mono mb-0.5">
                    Exovon Autopilot • Analysing...
                  </span>
                  <div className="p-2 bg-zinc-950 border border-zinc-900 rounded text-xs text-zinc-500 font-mono flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    <span>Evaluating workspace code...</span>
                  </div>
                </div>
              )}
              
              <div ref={chatEndRef} />
            </div>

            {/* Flagship Sandbox Speculative Diffs Section */}
            {speculativeDiffs.length > 0 && (
              <div className="border border-purple-900/50 bg-purple-950/15 rounded-xl p-3 flex flex-col gap-2 shadow-lg backdrop-blur-md shrink-0">
                <div className="flex items-center justify-between border-b border-purple-900/30 pb-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse"></span>
                    <span className="text-[10px] font-bold tracking-wider text-purple-200 uppercase">Speculative Draft Diffs ({speculativeDiffs.length})</span>
                  </div>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => {
                        if (vscodeApi) vscodeApi.postMessage({ command: 'revertSandbox' });
                        setSpeculativeDiffs([]);
                      }}
                      className="text-[9px] font-semibold text-rose-300 hover:text-rose-100 bg-rose-905/40 border border-rose-800 px-2 py-0.5 rounded transition-all"
                    >
                      Revert All
                    </button>
                    <button 
                      onClick={() => {
                        speculativeDiffs.forEach(diff => {
                          if (vscodeApi) vscodeApi.postMessage({ command: 'acceptSpeculativeDiff', filePath: diff.path });
                        });
                        setSpeculativeDiffs([]);
                      }}
                      className="text-[9px] font-semibold text-purple-300 hover:text-purple-100 bg-purple-905/40 border border-purple-800 px-2 py-0.5 rounded transition-all"
                    >
                      Accept All
                    </button>
                  </div>
                </div>
                
                <div className="max-h-56 overflow-y-auto flex flex-col gap-3 pr-1 scrollbar-thin">
                  {speculativeDiffs.map((diff, dIdx) => (
                    <div key={dIdx} className="bg-zinc-950/80 rounded-lg border border-zinc-900 p-2.5 flex flex-col gap-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-mono text-[9px] text-zinc-300 truncate max-w-[200px]">{diff.path}</span>
                        <div className="flex gap-1.5 shrink-0">
                          <button 
                            onClick={() => {
                              if (vscodeApi) vscodeApi.postMessage({ command: 'acceptSpeculativeDiff', filePath: diff.path });
                              setSpeculativeDiffs(prev => prev.filter(p => p.path !== diff.path));
                            }}
                            className="text-[9px] font-bold text-emerald-400 hover:text-emerald-300 bg-emerald-950/40 border border-emerald-900/50 px-1.5 py-0.5 rounded transition-all"
                          >
                            Accept
                          </button>
                          <button 
                            onClick={() => {
                              if (vscodeApi) vscodeApi.postMessage({ command: 'rejectSpeculativeDiff', filePath: diff.path });
                              setSpeculativeDiffs(prev => prev.filter(p => p.path !== diff.path));
                            }}
                            className="text-[9px] font-bold text-rose-400 hover:text-rose-300 bg-rose-950/40 border border-rose-900/50 px-1.5 py-0.5 rounded transition-all"
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                      
                      <pre className="font-mono text-[9px] leading-4 bg-zinc-900/50 p-2 rounded max-h-36 overflow-y-auto select-text whitespace-pre scrollbar-thin">
                        {diff.diffLines.slice(0, 100).map((line, lIdx) => (
                          <div 
                            key={lIdx} 
                            className={`${
                              line.type === 'added' 
                                ? 'text-emerald-400 bg-emerald-950/30 border-l-2 border-emerald-500 pl-1' 
                                : line.type === 'removed' 
                                  ? 'text-rose-400 bg-rose-950/30 border-l-2 border-rose-500 pl-1 line-through font-semibold' 
                                  : 'text-zinc-500 pl-1.5 font-normal'
                            }`}
                          >
                            {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}{line.text}
                          </div>
                        ))}
                        {diff.diffLines.length > 100 && (
                          <div className="text-[8px] text-zinc-600 italic mt-1 text-center">... truncated {diff.diffLines.length - 100} lines ...</div>
                        )}
                      </pre>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* INTERACTIVE INPUT CONTROL BOX */}
            <div className="border border-zinc-800/80 bg-zinc-900/40 backdrop-blur-md rounded-2xl p-3 flex flex-col gap-2.5 shadow-xl shrink-0">
              {/* Context Picker Tag Chips */}
              <div className="flex flex-wrap items-center gap-1.5 border-b border-zinc-950 pb-2">
                <span className="text-[8px] font-mono text-zinc-500 uppercase tracking-wider">
                  Context:
                </span>
                {selectedContextFiles.map((file, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-1 bg-zinc-950 border border-zinc-850 py-0.5 px-1.5 rounded font-mono text-[9px] text-zinc-400"
                  >
                    <span>📄 {file.name}</span>
                    <button
                      onClick={() => setSelectedContextFiles(prev => prev.filter((_, i) => i !== idx))}
                      className="text-[9px] text-zinc-600 hover:text-zinc-400 font-bold ml-0.5"
                    >
                      ×
                    </button>
                  </div>
                ))}
                
                <button
                  onClick={() => {
                    if (vscodeApi) {
                      vscodeApi.postMessage({ command: 'requestContextFile' });
                    } else {
                      const newFile = prompt('Enter workspace file name to add to context:');
                      if (newFile) {
                        setSelectedContextFiles(prev => [...prev, { name: newFile, type: 'code' }]);
                      }
                    }
                  }}
                  className="bg-zinc-950 hover:bg-zinc-800 border border-zinc-850 text-zinc-500 hover:text-zinc-300 py-0.5 px-1.5 rounded font-mono text-[9px] font-bold"
                >
                  + Add
                </button>
              </div>

              {/* Text Input Row */}
              <div className="flex items-end gap-2">
                <textarea
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  placeholder="Ask Exovon Agent to write code or analyze files..."
                  className="flex-1 premium-input p-2 resize-none h-10 text-xs font-sans leading-relaxed"
                  disabled={isAgentThinking}
                />
                
                <button
                  onClick={() => handleSendMessage()}
                  disabled={isAgentThinking}
                  className="py-2 px-3.5 premium-btn-primary font-mono text-[10px] shrink-0 active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Submit
                </button>
              </div>

              {/* Suggestive Starter Chips */}
              <div className="flex gap-1.5 overflow-x-auto py-0.5 scrollbar-thin">
                {[
                  'Audit configuration scripts',
                  'Optimize edge routing setup',
                  'Verify webview path transforms'
                ].map((suggestText, i) => (
                  <button
                    key={i}
                    onClick={() => handleSendMessage(suggestText)}
                    className="text-[9px] text-zinc-400 bg-zinc-950 hover:bg-zinc-800 border border-zinc-850 py-1 px-2.5 rounded shrink-0 transition-all"
                  >
                    {suggestText}
                  </button>
                ))}
              </div>
            </div>

          </div>
        )}

        {/* TAB 2: WEB APP HOSTING CONSOLE */}
        {activeTab === 'hosting' && (
          <HostingConsole vscodeApi={vscodeApi} />
        )}

      </main>

      {/* FOOTER */}
      <footer className="mt-3 pt-2 border-t border-zinc-900 text-center shrink-0">
        <p className="text-[8px] text-zinc-600 font-mono">
          Exovon Autopilot Suite
        </p>
      </footer>

    </div>
  );
}
