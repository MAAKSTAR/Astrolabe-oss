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
    <path d="m15 12-8.373 8.373a1 1 0 1 1-3-3L12 9" />
    <path d="m18 15 4-4" />
    <path d="m21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172V7l-2.26-2.26a6 6 0 0 0-4.202-1.756L9 2.96l.92.82A6.18 6.18 0 0 1 12 8.4V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5" />
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
    <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
    <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
    <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
    <path d="M17.599 6.5a3 3 0 0 0 .399-1.375" />
    <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" />
    <path d="M3.477 10.896a4 4 0 0 1 .585-.396" />
    <path d="M19.938 10.5a4 4 0 0 1 .585.396" />
    <path d="M6 18a4 4 0 0 1-1.967-.516" />
    <path d="M19.967 17.484A4 4 0 0 1 18 18" />
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

/**
 * 🎬 Video Icon - Video Synthesis & DiT Flow
 */
export const VideoIcon: React.FC<ModelCapabilityProps> = ({
  className = 'w-3.5 h-3.5',
  title = 'Video Generation'
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
    <polygon points="23 7 16 12 23 17 23 7" />
    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
  </svg>
);

/**
 * 🎵 Music Icon - Audio & Music Synthesis
 */
export const MusicIcon: React.FC<ModelCapabilityProps> = ({
  className = 'w-3.5 h-3.5',
  title = 'Music & Audio Generation'
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
    <path d="M9 18V5l12-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="16" r="3" />
  </svg>
);

export interface ModelCapabilities {
  isVision?: boolean;
  isToolUse?: boolean;
  isReasoning?: boolean;
  isImageGen?: boolean;
  isVideo?: boolean;
  isMusic?: boolean;
  isAudio?: boolean;
  isComponent?: boolean;
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
  const { isVision, isToolUse, isReasoning, isImageGen, isVideo, isMusic, isAudio, isComponent } = capabilities;
  const hasSpecial = isVision || isToolUse || isReasoning || isImageGen || isVideo || isMusic || isAudio || isComponent;

  return (
    <div className={`flex items-center gap-1 shrink-0 ${className}`}>
      {/* 1. Vision Multimodal */}
      {isVision && (
        <span
          className="p-1 rounded-md bg-zinc-800/80 hover:bg-zinc-700/80 text-zinc-300 hover:text-white border border-white/10 transition-colors flex items-center justify-center shrink-0 cursor-help"
          title="Vision Multimodal (Image Understanding)"
        >
          <EyeIcon className="w-3.5 h-3.5" title="Vision Multimodal (Image Understanding)" />
        </span>
      )}

      {/* 2. Reasoning / Thinking */}
      {isReasoning && (
        <span
          className="p-1 rounded-md bg-zinc-800/80 hover:bg-zinc-700/80 text-zinc-300 hover:text-white border border-white/10 transition-colors flex items-center justify-center shrink-0 cursor-help"
          title="Deep Reasoning & Chain-of-Thought"
        >
          <BrainIcon className="w-3.5 h-3.5" title="Deep Reasoning & Chain-of-Thought" />
        </span>
      )}

      {/* 3. Tool Calling / Agents */}
      {isToolUse && (
        <span
          className="p-1 rounded-md bg-zinc-800/80 hover:bg-zinc-700/80 text-zinc-300 hover:text-white border border-white/10 transition-colors flex items-center justify-center shrink-0 cursor-help"
          title="Tool Calling & Agent Functions"
        >
          <HammerIcon className="w-3.5 h-3.5" title="Tool Calling & Agent Functions" />
        </span>
      )}

      {/* 4. Image Generation / Diffusion */}
      {isImageGen && !isVideo && (
        <span
          className="p-1 rounded-md bg-zinc-800/80 hover:bg-zinc-700/80 text-zinc-300 hover:text-white border border-white/10 transition-colors flex items-center justify-center shrink-0 cursor-help"
          title="Diffusion & Image Synthesis"
        >
          <ImageIcon className="w-3.5 h-3.5" title="Diffusion & Image Synthesis" />
        </span>
      )}

      {/* 5. Video Generation */}
      {isVideo && (
        <span
          className="p-1 rounded-md bg-zinc-800/80 hover:bg-zinc-700/80 text-zinc-300 hover:text-white border border-white/10 transition-colors flex items-center justify-center shrink-0 cursor-help"
          title="Video Synthesis"
        >
          <VideoIcon className="w-3.5 h-3.5" title="Video Synthesis" />
        </span>
      )}

      {/* 6. Music / Audio Generation */}
      {isMusic && (
        <span
          className="p-1 rounded-md bg-zinc-800/80 hover:bg-zinc-700/80 text-zinc-300 hover:text-white border border-white/10 transition-colors flex items-center justify-center shrink-0 cursor-help"
          title="Music & Audio Synthesis"
        >
          <MusicIcon className="w-3.5 h-3.5" title="Music & Audio Synthesis" />
        </span>
      )}

      {/* 7. Voice / Audio / TTS */}
      {isAudio && (
        <span
          className="p-1 rounded-md bg-zinc-800/80 hover:bg-zinc-700/80 text-zinc-300 hover:text-white border border-white/10 transition-colors flex items-center justify-center shrink-0 cursor-help"
          title="Voice, Speech & TTS"
        >
          <MicrophoneIcon className="w-3.5 h-3.5" title="Voice, Speech & TTS" />
        </span>
      )}

      {/* 8. Pipeline Component */}
      {isComponent && (
        <span
          className="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-zinc-800/80 text-zinc-400 border border-white/5"
          title="Pipeline Component"
        >
          COMP
        </span>
      )}

      {/* 9. Standard LLM (only when no special modalities) */}
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
