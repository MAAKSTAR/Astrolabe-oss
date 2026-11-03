import React from 'react';

export interface ModelCapabilityProps {
  className?: string;
  title?: string;
}

/**
 * 👁️ Eye Icon - Multimodal Vision (Understands Images)
 */
export const EyeIcon: React.FC<ModelCapabilityProps> = ({
  className = 'w-3.5 h-3.5',
  title = 'Vision Multimodal (Image Understanding)'
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-label={title}
    role="img"
  >
    {title && <title>{title}</title>}
    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

/**
 * 🔨 Hammer Icon - Tool Calling / Agent Functions
 */
export const HammerIcon: React.FC<ModelCapabilityProps> = ({
  className = 'w-3.5 h-3.5',
  title = 'Tool Calling & Agent Functions'
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-label={title}
    role="img"
  >
    {title && <title>{title}</title>}
    <path d="M15 12l-8.5 8.5a2.121 2.121 0 01-3-3L12 9" />
    <path d="M17.64 4.36a3 3 0 00-4.24 0L12 5.76l4.24 4.24 1.4-1.4a3 3 0 000-4.24z" />
    <path d="M7 14l3 3" />
  </svg>
);

/**
 * 🧠 Brain Icon - Deep Reasoning / Chain-of-Thought
 */
export const BrainIcon: React.FC<ModelCapabilityProps> = ({
  className = 'w-3.5 h-3.5',
  title = 'Deep Reasoning & Chain-of-Thought'
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-label={title}
    role="img"
  >
    {title && <title>{title}</title>}
    <path d="M9.5 2A2.5 2.5 0 007 4.5v.08A3.5 3.5 0 004 8c0 1.15.55 2.16 1.4 2.8A3 3 0 005 13a3.5 3.5 0 002.5 3.36V17a3 3 0 003 3h1.5" />
    <path d="M14.5 2A2.5 2.5 0 0117 4.5v.08A3.5 3.5 0 0120 8c0 1.15-.55 2.16-1.4 2.8A3 3 0 0119 13a3.5 3.5 0 01-2.5 3.36V17a3 3 0 01-3 3H12" />
    <path d="M12 2v18" />
    <path d="M7 9a2 2 0 012-2h1" />
    <path d="M17 9a2 2 0 00-2-2h-1" />
    <path d="M8 15a2 2 0 002 2" />
    <path d="M16 15a2 2 0 01-2 2" />
  </svg>
);

/**
 * 🖼️ Image Frame Icon - Diffusion & Image Synthesis
 */
export const ImageIcon: React.FC<ModelCapabilityProps> = ({
  className = 'w-3.5 h-3.5',
  title = 'Diffusion & Image Synthesis'
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-label={title}
    role="img"
  >
    {title && <title>{title}</title>}
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <path d="M21 15l-5-5L5 21" />
  </svg>
);

/**
 * 🎙️ Microphone Icon - Voice & Speech / TTS
 */
export const MicrophoneIcon: React.FC<ModelCapabilityProps> = ({
  className = 'w-3.5 h-3.5',
  title = 'Voice, Speech & TTS'
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-label={title}
    role="img"
  >
    {title && <title>{title}</title>}
    <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
    <path d="M19 10v2a7 7 0 01-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="23" />
    <line x1="8" y1="23" x2="16" y2="23" />
  </svg>
);

export interface ModelCapabilities {
  isVision?: boolean;
  isToolUse?: boolean;
  isReasoning?: boolean;
  isImageGen?: boolean;
  isAudio?: boolean;
}

export interface ModelCapabilityBadgesProps {
  capabilities: ModelCapabilities;
  className?: string;
  showLlmFallback?: boolean;
}

/**
 * ModelCapabilityBadges - Render clean SVG-only capability icons
 */
export const ModelCapabilityBadges: React.FC<ModelCapabilityBadgesProps> = ({
  capabilities,
  className = '',
  showLlmFallback = true
}) => {
  const { isVision, isToolUse, isReasoning, isImageGen, isAudio } = capabilities;
  const hasSpecial = isVision || isToolUse || isReasoning || isImageGen || isAudio;

  return (
    <div className={`flex items-center gap-1 shrink-0 ${className}`}>
      {/* 1. Vision Multimodal */}
      {isVision && (
        <span
          className="p-1 rounded-md bg-zinc-800/90 hover:bg-zinc-700/90 text-amber-300 hover:text-amber-200 border border-amber-500/20 transition-colors flex items-center justify-center shrink-0 cursor-help"
          title="Vision Multimodal (Image Understanding)"
        >
          <EyeIcon className="w-3.5 h-3.5" title="Vision Multimodal (Image Understanding)" />
        </span>
      )}

      {/* 2. Reasoning / Thinking */}
      {isReasoning && (
        <span
          className="p-1 rounded-md bg-zinc-800/90 hover:bg-zinc-700/90 text-purple-300 hover:text-purple-200 border border-purple-500/20 transition-colors flex items-center justify-center shrink-0 cursor-help"
          title="Deep Reasoning & Chain-of-Thought"
        >
          <BrainIcon className="w-3.5 h-3.5" title="Deep Reasoning & Chain-of-Thought" />
        </span>
      )}

      {/* 3. Tool Calling / Agents */}
      {isToolUse && (
        <span
          className="p-1 rounded-md bg-zinc-800/90 hover:bg-zinc-700/90 text-sky-300 hover:text-sky-200 border border-sky-500/20 transition-colors flex items-center justify-center shrink-0 cursor-help"
          title="Tool Calling & Agent Functions"
        >
          <HammerIcon className="w-3.5 h-3.5" title="Tool Calling & Agent Functions" />
        </span>
      )}

      {/* 4. Image Generation / Diffusion */}
      {isImageGen && (
        <span
          className="p-1 rounded-md bg-zinc-800/90 hover:bg-zinc-700/90 text-emerald-300 hover:text-emerald-200 border border-emerald-500/20 transition-colors flex items-center justify-center shrink-0 cursor-help"
          title="Diffusion & Image Synthesis"
        >
          <ImageIcon className="w-3.5 h-3.5" title="Diffusion & Image Synthesis" />
        </span>
      )}

      {/* 5. Voice / Audio / TTS */}
      {isAudio && (
        <span
          className="p-1 rounded-md bg-zinc-800/90 hover:bg-zinc-700/90 text-rose-300 hover:text-rose-200 border border-rose-500/20 transition-colors flex items-center justify-center shrink-0 cursor-help"
          title="Voice, Speech & TTS"
        >
          <MicrophoneIcon className="w-3.5 h-3.5" title="Voice, Speech & TTS" />
        </span>
      )}

      {/* 6. Standard LLM (only when no special modalities) */}
      {!hasSpecial && showLlmFallback && (
        <span
          className="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-zinc-800/80 text-zinc-400 border border-white/5"
          title="Standard Language Model"
        >
          LLM
        </span>
      )}
    </div>
  );
};

export default ModelCapabilityBadges;
