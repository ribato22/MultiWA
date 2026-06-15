'use client';

import React, { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { Zap, Check, X } from 'lucide-react';

interface ConditionNodeData {
  label: string;
  field: string;
  operator: string;
  value: string;
}

const operatorLabels: Record<string, string> = {
  equals: '=',
  not_equals: '≠',
  contains: '∋',
  starts_with: 'starts',
  ends_with: 'ends',
  regex: '/./',
  greater_than: '>',
  less_than: '<',
};

export const ConditionNode = memo(({ data, selected }: NodeProps<ConditionNodeData>) => {
  return (
    <div
      className={`
        px-5 py-4 rounded-2xl min-w-[200px]
        bg-amber-500/10 border-2
        transition-all duration-200
        ${selected
          ? 'border-amber-500 shadow-lg shadow-amber-500/25'
          : 'border-amber-500/40 shadow-md shadow-black/20'}
      `}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{
          background: '#f59e0b',
          width: '12px',
          height: '12px',
          border: '2px solid hsl(217 33% 17%)',
          boxShadow: '0 2px 6px rgba(245, 158, 11, 0.4)',
        }}
      />

      <div className="flex items-center gap-2 mb-1.5">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-amber-500/20 text-amber-300">
          <Zap className="w-3.5 h-3.5" aria-hidden="true" />
        </span>
        <span className="text-[10px] uppercase font-bold tracking-wider text-amber-300">
          Condition
        </span>
      </div>
      <div className="text-sm font-semibold text-foreground">
        {data.label || 'If...'}
      </div>
      <div className="text-[11px] font-mono text-amber-200 mt-1 bg-amber-500/15 border border-amber-500/30 px-2 py-1 rounded-md">
        {data.field} {operatorLabels[data.operator]} &quot;{data.value}&quot;
      </div>

      {/* True/False branch labels */}
      <div className="flex justify-between text-[10px] mt-2.5 font-semibold">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-primary/15 text-primary border border-primary/30">
          <Check className="w-2.5 h-2.5" aria-hidden="true" />
          Yes
        </span>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-destructive/15 text-destructive border border-destructive/30">
          <X className="w-2.5 h-2.5" aria-hidden="true" />
          No
        </span>
      </div>

      {/* True branch */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="true"
        style={{
          left: '30%',
          background: '#22c55e',
          width: '12px',
          height: '12px',
          border: '2px solid hsl(217 33% 17%)',
          boxShadow: '0 2px 6px rgba(34, 197, 94, 0.4)',
        }}
      />
      {/* False branch */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="false"
        style={{
          left: '70%',
          background: '#ef4444',
          width: '12px',
          height: '12px',
          border: '2px solid hsl(217 33% 17%)',
          boxShadow: '0 2px 6px rgba(239, 68, 68, 0.4)',
        }}
      />
    </div>
  );
});

ConditionNode.displayName = 'ConditionNode';
