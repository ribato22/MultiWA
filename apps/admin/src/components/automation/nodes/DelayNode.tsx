'use client';

import React, { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';

interface DelayNodeData {
  label: string;
  duration: number;
  unit: 'seconds' | 'minutes' | 'hours' | 'days';
}

export const DelayNode = memo(({ data, selected }: NodeProps<DelayNodeData>) => {
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

  return (
    <div
      style={{
        padding: '16px 20px',
        borderRadius: '14px',
        background: selected 
          ? 'linear-gradient(135deg, #e2e8f0 0%, #cbd5e1 100%)'
          : 'linear-gradient(135deg, #f1f5f9 0%, #f8fafc 100%)',
        border: `2px solid ${selected ? '#64748b' : '#94a3b8'}`,
        minWidth: '140px',
        boxShadow: selected 
          ? '0 8px 24px rgba(100, 116, 139, 0.25)' 
          : '0 2px 12px rgba(0,0,0,0.08)',
        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        textAlign: 'center',
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{
          background: 'linear-gradient(135deg, #64748b, #475569)',
          width: '12px',
          height: '12px',
          border: '2px solid white',
          boxShadow: '0 2px 6px rgba(100, 116, 139, 0.4)',
        }}
      />
      
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        marginBottom: '8px',
      }}>
        <div style={{
          width: '24px', height: '24px', borderRadius: '6px',
          backgroundColor: '#64748b15', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '12px',
        }}>
          ⏱️
        </div>
        <span style={{ 
          fontSize: '10px', 
          textTransform: 'uppercase', 
          color: '#475569',
          fontWeight: 700,
          letterSpacing: '0.05em',
        }}>
          Delay
        </span>
      </div>
      <div style={{ 
        fontSize: '22px', 
        fontWeight: 700,
        color: '#334155',
        lineHeight: 1,
      }}>
        {data.duration}
        <span style={{ fontSize: '13px', fontWeight: 500, color: '#64748b', marginLeft: '2px' }}>
          {unitLabels[data.unit]}
        </span>
      </div>
      <div style={{
        fontSize: '10px',
        color: '#94a3b8',
        marginTop: '4px',
      }}>
        Wait {data.duration} {unitFull[data.unit]}
      </div>
      
      <Handle
        type="source"
        position={Position.Bottom}
        style={{
          background: 'linear-gradient(135deg, #64748b, #475569)',
          width: '12px',
          height: '12px',
          border: '2px solid white',
          boxShadow: '0 2px 6px rgba(100, 116, 139, 0.4)',
        }}
      />
    </div>
  );
});

DelayNode.displayName = 'DelayNode';
