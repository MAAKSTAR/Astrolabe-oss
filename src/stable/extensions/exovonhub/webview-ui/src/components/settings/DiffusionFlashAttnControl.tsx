import React from 'react';

export type DiffusionFlashAttnMode = 'auto' | 'on' | 'off';

interface DiffusionFlashAttnControlProps {
  value: DiffusionFlashAttnMode;
  onChange: (mode: DiffusionFlashAttnMode) => void;
}

const FLASH_ATTN_OPTIONS: Array<{
  id: DiffusionFlashAttnMode;
  label: string;
  hint: string;
}> = [
  { id: 'auto', label: 'Auto', hint: 'Let sd-cli pick per backend' },
  { id: 'on', label: 'On', hint: 'Force --flash-attn on (lower VRAM)' },
  { id: 'off', label: 'Off', hint: 'Disable flash attention kernel' },
];

/**
 * Tri-state Flash Attention selector (`auto` / `on` / `off`) for diffusion and
 * video flow inference. Defaults to `auto` so no backend flag is forced unless
 * explicitly chosen by the user.
 */
export const DiffusionFlashAttnControl: React.FC<DiffusionFlashAttnControlProps> = ({
  value,
  onChange,
}) => {
  const activeHint = FLASH_ATTN_OPTIONS.find((opt) => opt.id === value)?.hint;

  return (
    <div className="bg-[#141416] border border-white/10 rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-zinc-100 block">
              Flash Attention
            </label>
            <span className="text-[10px] text-zinc-500 font-mono">--flash-attn</span>
          </div>
          <span className="text-[11px] text-zinc-400 mt-0.5 block">
            Controls attention kernel optimization during DiT / flow inference. {activeHint}
          </span>
        </div>
        <div className="inline-flex items-center gap-1 rounded-lg bg-zinc-900/90 p-1 border border-white/10 shrink-0">
          {FLASH_ATTN_OPTIONS.map((opt) => {
            const isActive = value === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => onChange(opt.id)}
                className={`px-2.5 py-1 rounded-md text-xs font-mono transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-white text-zinc-950 font-bold shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200 font-medium'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
