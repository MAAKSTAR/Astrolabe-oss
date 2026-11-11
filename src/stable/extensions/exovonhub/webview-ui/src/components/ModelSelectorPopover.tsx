import React, { useEffect, useMemo, useRef, useState } from 'react';
import { formatModelDisplayName, getModelCategory } from './ChatScreen';
import type { VsCodeApi } from '../types';

export interface LocalModelEntry {
  id: string;
  name?: string;
  architecture?: string;
  modality?: string;
  relative_path?: string;
  component_role?: string | null;
  model_family?: string;
}

export interface ModelSelectorPopoverProps {
  open: boolean;
  onClose: () => void;
  availableLocalModels?: LocalModelEntry[];
  activeLocalModel?: string;
  activeDiffusionModel?: string;
  activeDiffusionModality?: string;
  isDiffusion?: boolean;
  isVideoMode?: boolean;
  handleModelChange?: (model: string) => void;
  vscodeApi?: VsCodeApi;
}

type TabFilter = 'llm' | 'diffusion' | 'video';

function stripToBasename(value?: string | null): string {
  if (!value) return '';
  const cleaned = String(value).replace(/^(local|diffusion|vision|video|music|audio):/i, '').trim();
  const normalized = cleaned.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  return idx >= 0 ? normalized.slice(idx + 1) : normalized;
}

export const ModelSelectorPopover: React.FC<ModelSelectorPopoverProps> = (props) => {
  if (!props.open) return null;
  return <ModelSelectorPopoverInner {...props} />;
};

const ModelSelectorPopoverInner: React.FC<ModelSelectorPopoverProps> = ({
  open,
  onClose,
  availableLocalModels = [],
  activeLocalModel = '',
  activeDiffusionModel = '',
  activeDiffusionModality = '',
  isDiffusion = false,
  isVideoMode = false,
  handleModelChange,
  vscodeApi,
}) => {
  const [tab, setTab] = useState<TabFilter>(() =>
    isVideoMode ? 'video' : isDiffusion ? 'diffusion' : 'llm',
  );
  const [searchQuery, setSearchQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-model-selector-trigger="true"]')) return;
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  const categorized = useMemo(
    () =>
      availableLocalModels
        .map((m) => ({ ...m, category: getModelCategory(m) }))
        .filter((m) => m.category !== 'projector'),
    [availableLocalModels],
  );

  const counts = useMemo(
    () => ({
      llm: categorized.filter((m) => m.category === 'llm').length,
      diffusion: categorized.filter((m) => m.category === 'diffusion').length,
      video: categorized.filter((m) => m.category === 'video').length,
    }),
    [categorized],
  );

  const visibleModels = useMemo(() => {
    const inTab = categorized.filter((m) => m.category === tab);
    const q = searchQuery.trim().toLowerCase();
    if (!q) return inTab;
    return inTab.filter((m) => {
      const display = formatModelDisplayName(m.name || m.id).toLowerCase();
      return display.includes(q) || m.id.toLowerCase().includes(q);
    });
  }, [categorized, tab, searchQuery]);

  if (!open) return null;

  const activeLlmBase = stripToBasename(activeLocalModel).toLowerCase();
  const activeDiffBase = stripToBasename(activeDiffusionModel).toLowerCase();

  const handleLoadModel = (
    m: LocalModelEntry & { category: 'video' | 'diffusion' | 'projector' | 'llm' },
    modelBaseName: string,
    isVisual: boolean,
  ) => {
    if (isVisual) {
      const targetModality = m.category === 'video' ? 'video' : 'image';
      handleModelChange?.(`diffusion:${modelBaseName}`);
      vscodeApi?.postMessage({
        command: 'loadLocalModel',
        modelId: m.id,
        target: 'diffusion',
        modality: targetModality,
      });
    } else {
      handleModelChange?.(`local:${modelBaseName}`);
      vscodeApi?.postMessage({
        command: 'loadLocalModel',
        modelId: m.id,
        target: 'primary',
        modality: 'llm',
      });
    }
    onClose();
  };

  return (
    <div
      ref={rootRef}
      className="absolute bottom-full left-0 right-0 mb-2 rounded-xl shadow-2xl z-50 overflow-hidden flex flex-col max-h-[min(340px,56vh)] border border-white/10 bg-[#18181b]/95 backdrop-blur-xl text-zinc-200 font-sans"
    >
      {/* Clean Header Strip */}
      <div className="px-2.5 min-[360px]:px-3 pt-2 pb-1.5 border-b border-white/[0.06] flex flex-wrap items-center justify-between gap-1.5 shrink-0">
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          <span className="text-xs font-medium text-zinc-400 shrink-0 hidden min-[360px]:inline">Model</span>
          <div className="flex items-center gap-1 flex-wrap">
            {(
              [
                ['llm', `LLMs (${counts.llm})`],
                ['diffusion', `Image (${counts.diffusion})`],
                ['video', `Video (${counts.video})`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`px-1.5 min-[360px]:px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  tab === key
                    ? 'bg-white/12 text-white'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.05]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {activeDiffusionModel && (
          <button
            type="button"
            title={`Unload ${formatModelDisplayName(activeDiffusionModel)}`}
            onClick={(e) => {
              e.stopPropagation();
              vscodeApi?.postMessage({ command: 'unloadLocalModel', target: 'diffusion' });
            }}
            className="text-[10px] font-medium text-zinc-300 hover:text-rose-300 px-1.5 py-0.5 rounded bg-white/[0.06] hover:bg-rose-500/15 border border-white/10 truncate max-w-[110px] cursor-pointer shrink-0"
          >
            Unload {activeDiffusionModality === 'video' ? 'Video' : 'Image'}
          </button>
        )}
      </div>

      {/* Subtle Filter Input when list has > 6 items */}
      {counts[tab] > 6 && (
        <div className="px-2.5 pt-2 shrink-0">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={`Search ${tab === 'llm' ? 'LLMs' : tab === 'diffusion' ? 'Image models' : 'Video models'}...`}
            className="w-full px-2.5 py-1 rounded-md bg-white/[0.04] focus:bg-white/[0.07] border border-white/[0.06] text-xs text-zinc-100 placeholder:text-zinc-500 outline-none"
          />
        </div>
      )}

      {/* Clean Flat Rows — Name on Left, Load / Unload Flush on Right Border */}
      <div className="p-1.5 overflow-y-auto space-y-0.5 flex-1">
        {visibleModels.length === 0 ? (
          <div className="py-5 px-3 text-center text-[11px] text-zinc-500">
            {categorized.length === 0
              ? 'No local models detected. Open Engine Settings to configure your directory.'
              : 'No matching models in this category.'}
          </div>
        ) : (
          visibleModels.map((m) => {
            const isVisual = m.category === 'diffusion' || m.category === 'video';
            const modelBaseName = stripToBasename(m.name || m.id);
            const modelBaseLower = modelBaseName.toLowerCase();
            const isActiveLlm =
              !isVisual && Boolean(activeLlmBase) && activeLlmBase === modelBaseLower;
            const isActiveDiff =
              isVisual && Boolean(activeDiffBase) && activeDiffBase === modelBaseLower;
            const isCurrentActive = isActiveLlm || isActiveDiff;

            return (
              <div
                key={m.id}
                className={`px-2.5 py-1.5 rounded-lg flex items-center justify-between gap-3 transition-colors ${
                  isCurrentActive ? 'bg-white/[0.06]' : 'hover:bg-white/[0.05]'
                }`}
              >
                <span
                  className={`text-[13px] truncate min-w-0 ${
                    isCurrentActive ? 'text-white font-medium' : 'text-zinc-200 font-normal'
                  }`}
                  title={formatModelDisplayName(modelBaseName)}
                >
                  {formatModelDisplayName(modelBaseName)}
                </span>

                <div className="ml-auto shrink-0 flex items-center gap-2">
                  {isCurrentActive ? (
                    <>
                      <svg
                        className="w-3.5 h-3.5 text-zinc-200"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        aria-label="Loaded"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          vscodeApi?.postMessage({
                            command: 'unloadLocalModel',
                            target: isVisual ? 'diffusion' : 'primary',
                          });
                        }}
                        className="px-2 py-0.5 rounded text-[11px] font-medium text-zinc-300 hover:text-rose-300 bg-white/[0.06] hover:bg-rose-500/15 border border-white/10 transition-colors cursor-pointer"
                      >
                        Unload
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleLoadModel(m, modelBaseName, isVisual);
                      }}
                      className="px-2.5 py-0.5 rounded text-[11px] font-medium text-zinc-200 hover:text-white bg-white/[0.07] hover:bg-white/[0.15] border border-white/10 transition-colors cursor-pointer"
                    >
                      Load
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Subtle Footer Action */}
      <button
        type="button"
        onClick={() => {
          onClose();
          vscodeApi?.postMessage({ command: 'openSettings' });
        }}
        className="w-full px-3 py-2 text-left text-[11px] font-medium text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04] border-t border-white/[0.06] transition-colors flex items-center justify-between shrink-0 cursor-pointer"
      >
        <span>Hardware & Engine Settings</span>
        <span className="text-zinc-500">→</span>
      </button>
    </div>
  );
};
