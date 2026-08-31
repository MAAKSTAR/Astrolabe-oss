export interface ToolIconProps {
  status?: 'running' | 'success' | 'failed' | 'pending' | string;
  className?: string;
}

/**
 * Astrolabe Think / Reasoning Icon: Bold concentric orbital rings & pulsing central core
 */
export function ThinkIcon({ status = 'running', className = 'w-4 h-4' }: ToolIconProps) {
  const isRunning = status === 'running' || status === 'pending';
  return (
    <svg className={`${className} text-zinc-100`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      {/* Outer Astrolabe Orbiting Ring */}
      <circle
        cx="12"
        cy="12"
        r="9"
        className={isRunning ? 'animate-[spin_7s_linear_infinite] origin-center' : 'opacity-80'}
        strokeDasharray="5 3"
        strokeLinecap="round"
      />
      {/* Inner Counter-Rotating Orbit */}
      <circle
        cx="12"
        cy="12"
        r="5"
        className={isRunning ? 'animate-[spin_3.5s_linear_infinite_reverse] origin-center' : 'opacity-80'}
        strokeDasharray="6 3"
        strokeLinecap="round"
      />
      {/* Center Neural Node */}
      <circle
        cx="12"
        cy="12"
        r="2.2"
        fill="currentColor"
        className={isRunning ? 'animate-pulse text-white' : 'text-zinc-200'}
      />
    </svg>
  );
}

/**
 * File Inspection Icon: Bold document geometry with high-contrast laser scan beam
 */
export function ReadFileIcon({ status = 'running', className = 'w-4 h-4' }: ToolIconProps) {
  const isRunning = status === 'running' || status === 'pending';
  return (
    <svg className={`${className} text-zinc-100`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      {/* Solid Document Sheet */}
      <path
        d="M6 3h8l5 5v13a1 1 0 01-1 1H6a1 1 0 01-1-1V4a1 1 0 011-1z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M14 3v5h5" strokeLinecap="round" strokeLinejoin="round" />
      {/* Internal Text Lines */}
      <line x1="8" y1="12" x2="16" y2="12" strokeLinecap="round" className="opacity-60" />
      <line x1="8" y1="16" x2="13" y2="16" strokeLinecap="round" className="opacity-60" />
      {/* Animated Scan Beam */}
      {isRunning && (
        <line
          x1="5"
          y1="8"
          x2="19"
          y2="8"
          strokeWidth="2.5"
          strokeLinecap="round"
          className="text-white animate-[scanBeam_1.3s_ease-in-out_infinite]"
        />
      )}
    </svg>
  );
}

/**
 * Terminal Command Execution Icon: Bold terminal window with active prompt cursor
 */
export function TerminalCommandIcon({ status = 'running', className = 'w-4 h-4' }: ToolIconProps) {
  const isRunning = status === 'running' || status === 'pending';
  return (
    <svg className={`${className} text-zinc-100`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      {/* Terminal Window Box */}
      <rect x="3" y="4" width="18" height="16" rx="2" strokeLinecap="round" strokeLinejoin="round" />
      {/* Chevron Execution Prompt */}
      <path
        d="M7 9l3.5 3-3.5 3"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={isRunning ? 'text-white' : 'text-zinc-200'}
      />
      {/* Active Blinking Cursor */}
      <line
        x1="13"
        y1="15"
        x2="16.5"
        y2="15"
        strokeLinecap="round"
        strokeWidth="2.5"
        className={isRunning ? 'text-white animate-[cursorBlink_0.75s_steps(2,start)_infinite]' : 'opacity-60'}
      />
    </svg>
  );
}

/**
 * Code Edit / Create / Patch Icon: Bold brackets with active edit nib
 */
export function CodeEditIcon({ status = 'running', className = 'w-4 h-4' }: ToolIconProps) {
  const isRunning = status === 'running' || status === 'pending';
  return (
    <svg className={`${className} text-zinc-100`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      {/* Code Opening & Closing Brackets */}
      <path d="M7 8l-4 4 4 4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17 8l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
      {/* Edit Slash Stroke */}
      <path
        d="M14 5l-4 14"
        strokeLinecap="round"
        className={isRunning ? 'text-white animate-[editStroke_1.2s_ease-in-out_infinite]' : 'text-zinc-300'}
      />
    </svg>
  );
}

/**
 * Search / Grep / Discovery Icon: Bold magnifying lens with rotating radar
 */
export function CodeSearchIcon({ status = 'running', className = 'w-4 h-4' }: ToolIconProps) {
  const isRunning = status === 'running' || status === 'pending';
  return (
    <svg className={`${className} text-zinc-100`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" strokeLinecap="round" />
      <path d="M16.5 16.5L21 21" strokeLinecap="round" strokeWidth="2.5" />
      {isRunning && (
        <circle
          cx="11"
          cy="11"
          r="4"
          strokeDasharray="6 4"
          strokeLinecap="round"
          className="text-white animate-[spin_2s_linear_infinite] origin-[11px_11px]"
        />
      )}
    </svg>
  );
}

/**
 * Plan / Blueprint Icon: Bold checklist & check indicator
 */
export function PlanIcon({ status = 'running', className = 'w-4 h-4' }: ToolIconProps) {
  const isRunning = status === 'running' || status === 'pending';
  return (
    <svg className={`${className} text-zinc-100`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2" strokeLinecap="round" />
      <rect x="8" y="2" width="8" height="4" rx="1" strokeLinecap="round" />
      <path
        d="M9 12l2 2 4-4"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={isRunning ? 'text-white animate-pulse' : 'text-zinc-200'}
      />
    </svg>
  );
}

/**
 * Log & Trace Icon: High-contrast signal waveform
 */
export function LogIcon({ status = 'running', className = 'w-4 h-4' }: ToolIconProps) {
  const isRunning = status === 'running' || status === 'pending';
  return (
    <svg className={`${className} text-zinc-100`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 6h16M4 12h11M4 18h14" strokeLinecap="round" />
      {isRunning && (
        <circle cx="18.5" cy="12" r="2.2" fill="currentColor" className="text-white animate-ping" />
      )}
    </svg>
  );
}

/**
 * Animated Vector Checkmark drawn on step completion
 */
export function StepStatusBadge({ status }: { status: 'running' | 'success' | 'failed' | 'pending' | string }) {
  if (status === 'running') {
    return (
      <span className="relative flex h-2.5 w-2.5">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-70" />
        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)]" />
      </span>
    );
  }

  if (status === 'success' || status === 'done') {
    return (
      <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path
          d="M3 8.5L6 11.5L13 4.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="animate-[drawCheck_0.35s_cubic-bezier(0.16,1,0.3,1)_forwards]"
          style={{ strokeDasharray: 20, strokeDashoffset: 0 }}
        />
      </svg>
    );
  }

  if (status === 'failed' || status === 'error') {
    return (
      <svg className="w-3.5 h-3.5 text-zinc-300" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path d="M4 4l8 8m0-8l-8 8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  return <span className="w-2 h-2 rounded-full bg-zinc-500" />;
}
