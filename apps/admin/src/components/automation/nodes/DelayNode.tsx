'use client';

import React, { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { Timer } from 'lucide-react';

interface DelayNodeData {
  label: string;
  duration: number;
  unit: 'seconds' | 'minutes' | 'hours' | 'days';
}

const unitLabels: Record<string, string> = {
  seconds: 's',
  minutes: 'm',
  hours: 'h',
  days: 'd',
};

const unitFull: Record<string, string> = {
  seconds: 'seconds',
  minutes: 'minutes',
  hours: 'hours',
  days: 'days',
};

export const DelayNode = memo(({ data, selected }: NodeProps<DelayNodeData>) => {
  return (
    <div
      className={`
        px-5 py-4 rounded-2xl min-w-[140px] text-center
        bg-secondary/40 border-2
        transition-all duration-200
        ${selected
          ? 'border-slate-400 shadow-lg shadow-slate-500/20'
          : 'border-slate-500/40 shadow-md shadow-black/20'}
      `}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{
          background: '#64748b',
          width: '12px',
          height: '12px',
          border: '2px solid hsl(217 33% 17%)',
          boxShadow: '0 2px 6px rgba(100, 116, 139, 0.4)',
        }}
      />

      <div className="flex items-center justify-center gap-2 mb-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-500/20 text-slate-300">
          <Timer className="w-3.5 h-3.5" aria-hidden="true" />
        </span>
        <span className="text-[10px] uppercase font-bold tracking-wider text-slate-300">
          Delay
        </span>
      </div>
      <div className="text-[22px] font-bold text-foreground leading-none tabular-nums">
        {data.duration}
        <span className="text-[13px] font-medium text-muted-foreground ml-0.5">
          {unitLabels[data.unit]}
        </span>
      </div>
      <div className="text-[10px] text-muted-foreground mt-1">
        Wait {data.duration} {unitFull[data.unit]}
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        style={{
          background: '#64748b',
          width: '12px',
          height: '12px',
          border: '2px solid hsl(217 33% 17%)',
          boxShadow: '0 2px 6px rgba(100, 116, 139, 0.4)',
        }}
      />
    </div>
  );
});

DelayNode.displayName = 'DelayNode';
