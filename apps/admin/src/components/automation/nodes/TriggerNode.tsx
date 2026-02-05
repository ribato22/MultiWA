'use client';

import React, { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';

interface TriggerNodeData {
  label: string;
  triggerType: string;
  filters?: Record<string, unknown>;
}

const triggerTypeLabels: Record<string, string> = {
  'all': '📩 All Messages',
  'keyword': '🔤 Keyword Match',
  'regex': '🔣 Pattern Match',
  'new_contact': '👤 New Contact',
  // Legacy values for backward compatibility
  'message.received': '📩 Message Received',
  'message.keyword': '🔤 Keyword Match',
  'contact.created': '👤 New Contact',
  'all_messages': '📩 All Messages',
};

export const TriggerNode = memo(({ data, selected }: NodeProps<TriggerNodeData>) => {
  return (
    <div
      style={{
        padding: '16px 20px',
        borderRadius: '14px',
        background: selected 
          ? 'linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%)'
          : 'linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%)',
        border: `2px solid ${selected ? '#22c55e' : '#86efac'}`,
        minWidth: '180px',
        boxShadow: selected 
          ? '0 8px 24px rgba(34, 197, 94, 0.25)' 
          : '0 2px 12px rgba(0,0,0,0.08)',
        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginBottom: '6px',
      }}>
        <div style={{
          width: '24px', height: '24px', borderRadius: '6px',
          backgroundColor: '#22c55e15', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '12px',
        }}>
          ▶️
        </div>
        <span style={{ 
          fontSize: '10px', 
          textTransform: 'uppercase', 
          color: '#16a34a',
          fontWeight: 700,
          letterSpacing: '0.05em',
        }}>
          Trigger
        </span>
      </div>
      <div style={{ 
        fontSize: '13px', 
        fontWeight: 600,
        color: '#15803d',
      }}>
        {triggerTypeLabels[data.triggerType] || data.label}
      </div>
      
      <Handle
        type="source"
        position={Position.Bottom}
        style={{
          background: 'linear-gradient(135deg, #22c55e, #16a34a)',
          width: '12px',
          height: '12px',
          border: '2px solid white',
          boxShadow: '0 2px 6px rgba(34, 197, 94, 0.4)',
        }}
      />
    </div>
  );
});

TriggerNode.displayName = 'TriggerNode';
