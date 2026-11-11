import type { ToolIconProps } from './AnimatedToolIcons';

function activeState(status?: string): boolean {
  return status === 'running' || status === 'pending';
}

/**
 * Chat History Icon: Speech bubble with conversation lines
 */
export function ChatHistoryIcon({ status = 'running', className = 'w-4 h-4' }: ToolIconProps) {
  const isRunning = activeState(status);
  return (
    <svg className={`${className} text-zinc-100`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="8" y1="8.5" x2="16.5" y2="8.5" strokeLinecap="round" className={isRunning ? 'text-white animate-pulse' : 'opacity-75'} />
      <line x1="8" y1="12.5" x2="13.5" y2="12.5" strokeLinecap="round" className={isRunning ? 'text-white animate-pulse' : 'opacity-75'} />
    </svg>
  );
}

/**
 * Page Fetch & Browser Preview Icon: Web page frame with pointer cursor
 */
export function FetchPageIcon({ status = 'running', className = 'w-4 h-4' }: ToolIconProps) {
  const isRunning = activeState(status);
  return (
    <svg className={`${className} text-zinc-100`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M11 19H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v5.5" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="3" y1="7.5" x2="19" y2="7.5" strokeLinecap="round" className="opacity-65" />
      <line x1="6.5" y1="11.5" x2="12.5" y2="11.5" strokeLinecap="round" className="opacity-65" />
      <line x1="6.5" y1="15" x2="10" y2="15" strokeLinecap="round" className="opacity-65" />
      <path
        d="M13.5 12.5l1.8 8 2.2-2.5 3.5-1.5-7.5-4z"
        fill="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        className={isRunning ? 'text-sky-200 animate-pulse' : 'text-sky-300'}
      />
    </svg>
  );
}

/**
 * Directory Listing Icon: Workspace folder outline
 */
export function FolderListIcon({ status = 'running', className = 'w-4 h-4' }: ToolIconProps) {
  const isRunning = activeState(status);
  return (
    <svg className={`${className} text-zinc-100`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 7a2 2 0 0 1 2-2h4.2l2 2.2H19a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="8" y1="13" x2="16" y2="13" strokeLinecap="round" className={isRunning ? 'text-white animate-pulse' : 'opacity-65'} />
    </svg>
  );
}

/**
 * Document / Markdown Creation Icon: Structured sheet with heading banner
 */
export function DocCreateIcon({ status = 'running', className = 'w-4 h-4' }: ToolIconProps) {
  const isRunning = activeState(status);
  return (
    <svg className={`${className} text-zinc-100`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 3h8l5 5v12a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 20V4.5A1.5 1.5 0 0 1 6 3z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 3v5h5" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="8" y="10.5" width="8" height="2" rx="0.8" fill="currentColor" stroke="none" className={isRunning ? 'animate-pulse text-white' : 'opacity-85'} />
      <line x1="8" y1="15.5" x2="16" y2="15.5" strokeLinecap="round" className="opacity-65" />
      <line x1="8" y1="18.5" x2="13" y2="18.5" strokeLinecap="round" className="opacity-65" />
    </svg>
  );
}

/**
 * File Deletion Icon: Minimalist trash receptacle
 */
export function DeleteFileIcon({ status = 'running', className = 'w-4 h-4' }: ToolIconProps) {
  const isRunning = activeState(status);
  return (
    <svg className={`${className} ${isRunning ? 'text-rose-200 animate-pulse' : 'text-rose-300'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 7h16" strokeLinecap="round" />
      <path d="M9 7V4.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6.5 7l1 12.5a1.5 1.5 0 0 0 1.5 1.5h6a1.5 1.5 0 0 0 1.5-1.5L17.5 7" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="10" y1="11" x2="10" y2="17" strokeLinecap="round" className="opacity-75" />
      <line x1="14" y1="11" x2="14" y2="17" strokeLinecap="round" className="opacity-75" />
    </svg>
  );
}

/**
 * Memory / Knowledge Graph / Vector Search Icon: Connected constellation nodes
 */
export function MemoryGraphIcon({ status = 'running', className = 'w-4 h-4' }: ToolIconProps) {
  const isRunning = activeState(status);
  return (
    <svg className={`${className} text-zinc-100`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
      <line x1="6.5" y1="17.5" x2="12" y2="6" strokeLinecap="round" className="opacity-70" />
      <line x1="17.5" y1="17.5" x2="12" y2="6" strokeLinecap="round" className="opacity-70" />
      <line x1="6.5" y1="17.5" x2="17.5" y2="17.5" strokeLinecap="round" className="opacity-70" />
      <circle cx="12" cy="6" r="2.5" fill="currentColor" stroke="none" className={isRunning ? 'animate-pulse text-white' : ''} />
      <circle cx="6.5" cy="17.5" r="2.3" fill="currentColor" stroke="none" />
      <circle cx="17.5" cy="17.5" r="2.3" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * Image Generation Icon: Picture frame with horizon landscape
 */
export function ImageGenIcon({ status = 'running', className = 'w-4 h-4' }: ToolIconProps) {
  const isRunning = activeState(status);
  return (
    <svg className={`${className} text-zinc-100`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="16" rx="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="8.5" cy="9.5" r="1.5" fill="currentColor" stroke="none" className={isRunning ? 'animate-pulse text-white' : ''} />
      <path d="M21 15l-4.5-4.5a1.5 1.5 0 0 0-2.1 0L7 18" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Sub-Agent Delegation Icon: Autonomous bot unit with antenna signal
 */
export function SubAgentIcon({ status = 'running', className = 'w-4 h-4' }: ToolIconProps) {
  const isRunning = activeState(status);
  return (
    <svg className={`${className} text-zinc-100`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="12" y1="3" x2="12" y2="6" strokeLinecap="round" />
      <circle cx="12" cy="2.5" r="1.1" fill="currentColor" stroke="none" className={isRunning ? 'animate-ping' : ''} />
      <rect x="4" y="6" width="16" height="13" rx="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="9" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <line x1="9" y1="16" x2="15" y2="16" strokeLinecap="round" className="opacity-75" />
    </svg>
  );
}

/**
 * Cloud Deployment Icon: Cloud envelope with upward upload arrow
 */
export function CloudDeployIcon({ status = 'running', className = 'w-4 h-4' }: ToolIconProps) {
  const isRunning = activeState(status);
  return (
    <svg className={`${className} text-sky-300`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6.5 18.5h11a4 4 0 0 0 .8-7.9A5.5 5.5 0 0 0 7.7 9.2 3.8 3.8 0 0 0 6.5 18.5z" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M12 15.5V10.5m0 0l-2.2 2.2M12 10.5l2.2 2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={isRunning ? 'animate-pulse text-white' : ''}
      />
    </svg>
  );
}

/**
 * Toolbox / MCP Connector Icon: Universal plugin connector for MCP & tool introspection
 */
export function ToolboxIcon({ status = 'running', className = 'w-4 h-4' }: ToolIconProps) {
  const isRunning = activeState(status);
  return (
    <svg className={`${className} text-zinc-100`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 21v-4.5" strokeLinecap="round" />
      <path d="M9 8V4M15 8V4" strokeLinecap="round" />
      <path
        d="M7 8h10v3.5a5 5 0 0 1-10 0V8z"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={isRunning ? 'animate-pulse text-white' : ''}
      />
    </svg>
  );
}

/**
 * Context Compaction Icon: Converging compression arrows
 */
export function CompactIcon({ status = 'running', className = 'w-4 h-4' }: ToolIconProps) {
  const isRunning = activeState(status);
  return (
    <svg className={`${className} text-zinc-100`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="5" y1="12" x2="19" y2="12" strokeLinecap="round" className="opacity-70" />
      <path d="M12 3v5.5m0 0L9.5 6M12 8.5L14.5 6" strokeLinecap="round" strokeLinejoin="round" className={isRunning ? 'animate-pulse text-white' : ''} />
      <path d="M12 21v-5.5m0 0L9.5 18M12 15.5L14.5 18" strokeLinecap="round" strokeLinejoin="round" className={isRunning ? 'animate-pulse text-white' : ''} />
    </svg>
  );
}
