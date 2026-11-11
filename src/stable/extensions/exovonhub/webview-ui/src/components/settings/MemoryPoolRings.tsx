import React from 'react';

export interface MemoryPoolRingsProps {
  gpuProjectedGb: number;
  gpuTotalGb?: number;
  gpuFreeGb?: number;
  cpuProjectedGb: number;
  cpuTotalGb?: number;
  cpuAvailableGb?: number;
  hasHardwareInfo?: boolean;
  isUnifiedMemory?: boolean;
  gpuDetail?: string;
  cpuDetail?: string;
  className?: string;
}

interface PoolRingProps {
  label: string;
  projectedGb: number;
  totalGb?: number;
  freeGb?: number;
  emptyCapacityLabel: string;
  accentColor: string;
  accentTextClass: string;
  detail?: string;
}

const RADIUS = 21;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const SinglePoolRing: React.FC<PoolRingProps> = ({
  label,
  projectedGb,
  totalGb,
  freeGb,
  emptyCapacityLabel,
  accentColor,
  accentTextClass,
  detail
}) => {
  const hasCapacity = typeof totalGb === 'number' && totalGb > 0;
  const pctRaw = hasCapacity ? (projectedGb / totalGb) * 100 : 0;
  const clampedPct = Math.max(0, Math.min(100, pctRaw));
  const strokeDashoffset = CIRCUMFERENCE * (1 - clampedPct / 100);

  const headroom = typeof freeGb === 'number' && freeGb > 0 ? freeGb : totalGb;
  const isOverflow = hasCapacity && typeof headroom === 'number' && headroom > 0 && projectedGb > headroom;
  const isTight = !isOverflow && hasCapacity && typeof headroom === 'number' && headroom > 0 && projectedGb > headroom * 0.85;

  const ringStroke = !hasCapacity
    ? '#52525b'
    : isOverflow
      ? '#fb7185'
      : isTight
        ? '#fbbf24'
        : accentColor;

  const readoutTextClass = !hasCapacity
    ? 'text-zinc-400'
    : isOverflow
      ? 'text-rose-400'
      : isTight
        ? 'text-amber-300'
        : accentTextClass;

  const centerText = hasCapacity
    ? `${pctRaw > 999 ? '>999' : Math.round(pctRaw)}%`
    : '--';

  return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-zinc-950/60 border border-white/10 min-w-0">
      <div className="relative w-14 h-14 shrink-0 flex items-center justify-center">
        <svg viewBox="0 0 54 54" className="w-14 h-14 -rotate-90" aria-label={label} role="img">
          <circle
            cx="27"
            cy="27"
            r={RADIUS}
            fill="none"
            stroke="rgba(255,255,255,0.08)"
            strokeWidth="4.5"
          />
          {hasCapacity && (
            <circle
              cx="27"
              cy="27"
              r={RADIUS}
              fill="none"
              stroke={ringStroke}
              strokeWidth="4.5"
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={strokeDashoffset}
              className="transition-all duration-300 ease-out"
            />
          )}
        </svg>
        <span className={`absolute text-[10px] font-mono font-bold tabular-nums ${readoutTextClass}`}>
          {centerText}
        </span>
      </div>

      <div className="flex flex-col min-w-0 flex-1 gap-0.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 truncate">
            {label}
          </span>
          {hasCapacity && typeof freeGb === 'number' && (
            <span className="text-[10px] font-mono text-zinc-500 shrink-0 tabular-nums">
              {freeGb.toFixed(1)} GB free
            </span>
          )}
        </div>

        <div className="flex items-baseline gap-1 font-mono text-xs tabular-nums">
          <span className={`font-bold ${readoutTextClass}`}>
            {projectedGb.toFixed(1)} GB
          </span>
          <span className="text-zinc-500">
            / {hasCapacity ? `${totalGb.toFixed(1)} GB` : emptyCapacityLabel}
          </span>
        </div>

        {isOverflow && typeof headroom === 'number' ? (
          <span className="text-[10px] text-rose-400/90 font-medium truncate">
            Exceeds free capacity by {(projectedGb - headroom).toFixed(1)} GB
          </span>
        ) : detail ? (
          <span className="text-[10px] text-zinc-500 truncate" title={detail}>
            {detail}
          </span>
        ) : null}
      </div>
    </div>
  );
};

export const MemoryPoolRings: React.FC<MemoryPoolRingsProps> = ({
  gpuProjectedGb,
  gpuTotalGb,
  gpuFreeGb,
  cpuProjectedGb,
  cpuTotalGb,
  cpuAvailableGb,
  hasHardwareInfo = false,
  isUnifiedMemory = false,
  gpuDetail,
  cpuDetail,
  className = ''
}) => {
  const gpuEmptyLabel = hasHardwareInfo ? 'CPU-Only' : '--';

  return (
    <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 ${className}`}>
      <SinglePoolRing
        label={isUnifiedMemory ? 'GPU Pool (Unified)' : 'GPU Pool'}
        projectedGb={gpuProjectedGb}
        totalGb={gpuTotalGb}
        freeGb={gpuFreeGb}
        emptyCapacityLabel={gpuEmptyLabel}
        accentColor="#34d399"
        accentTextClass="text-emerald-300"
        detail={gpuDetail}
      />
      <SinglePoolRing
        label="CPU Pool"
        projectedGb={cpuProjectedGb}
        totalGb={cpuTotalGb}
        freeGb={cpuAvailableGb}
        emptyCapacityLabel="--"
        accentColor="#38bdf8"
        accentTextClass="text-sky-300"
        detail={cpuDetail}
      />
    </div>
  );
};

export default MemoryPoolRings;
