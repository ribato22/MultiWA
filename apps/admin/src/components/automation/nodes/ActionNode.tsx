'use client';

import React, { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';

interface ActionNodeData {
  label: string;
  actionType: string;
  config?: Record<string, unknown>;
}

const actionTypeLabels: Record<string, string> = {
  'send_text': '💬 Send Text',
  'send_image': '🖼️ Send Image',
  'send_document': '📄 Send Document',
  'send_poll': '📊 Send Poll',
  'add_tag': '🏷️ Add Tag',
  'remove_tag': '🏷️ Remove Tag',
  'assign_agent': '👤 Assign Agent',
  'ai_reply': '🤖 AI Reply',
  'webhook': '🔗 Call Webhook',
  'delay': '⏳ Delay',
};

export const ActionNode = memo(({ data, selected }: NodeProps<ActionNodeData>) => {
  return (
    <div
      style={{
        padding: '16px 20px',
        borderRadius: '14px',
        background: selected 
          ? 'linear-gradient(135deg, #e0e7ff 0%, #c7d2fe 100%)'
          : 'linear-gradient(135deg, #eef2ff 0%, #f0f0ff 100%)',
        border: `2px solid ${selected ? '#6366f1' : '#a5b4fc'}`,
        minWidth: '180px',
        boxShadow: selected 
          ? '0 8px 24px rgba(99, 102, 241, 0.25)' 
          : '0 2px 12px rgba(0,0,0,0.08)',
        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{
          background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
          width: '12px',
          height: '12px',
          border: '2px solid white',
          boxShadow: '0 2px 6px rgba(99, 102, 241, 0.4)',
        }}
      />
      
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginBottom: '6px',
      }}>
        <div style={{
          width: '24px', height: '24px', borderRadius: '6px',
          backgroundColor: '#6366f115', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '12px',
        }}>
          ⚙️
        </div>
        <span style={{ 
          fontSize: '10px', 
          textTransform: 'uppercase', 
          color: '#4338ca',
          fontWeight: 700,
          letterSpacing: '0.05em',
        }}>
          Action
        </span>
      </div>
      <div style={{ 
        fontSize: '13px', 
        fontWeight: 600,
        color: '#3730a3',
      }}>
        {actionTypeLabels[data.actionType] || data.label}
      </div>
      
      <Handle
        type="source"
        position={Position.Bottom}
        style={{
          background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
          width: '12px',
          height: '12px',
          border: '2px solid white',
          boxShadow: '0 2px 6px rgba(99, 102, 241, 0.4)',
        }}
      />
    </div>
  );
});

ActionNode.displayName = 'ActionNode';
