'use client';

import React, { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';

interface ConditionNodeData {
  label: string;
  field: string;
  operator: string;
  value: string;
}

const operatorLabels: Record<string, string> = {
  'equals': '=',
  'not_equals': '≠',
  'contains': '∋',
  'starts_with': 'starts',
  'ends_with': 'ends',
  'regex': '/./',
  'greater_than': '>',
  'less_than': '<',
};

export const ConditionNode = memo(({ data, selected }: NodeProps<ConditionNodeData>) => {
  return (
    <div
      style={{
        padding: '16px 20px',
        borderRadius: '14px',
        background: selected 
          ? 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)'
          : 'linear-gradient(135deg, #fffbeb 0%, #fef9c3 100%)',
        border: `2px solid ${selected ? '#f59e0b' : '#fcd34d'}`,
        minWidth: '200px',
        boxShadow: selected 
          ? '0 8px 24px rgba(245, 158, 11, 0.25)' 
          : '0 2px 12px rgba(0,0,0,0.08)',
        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{
          background: 'linear-gradient(135deg, #f59e0b, #d97706)',
          width: '12px',
          height: '12px',
          border: '2px solid white',
          boxShadow: '0 2px 6px rgba(245, 158, 11, 0.4)',
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
          backgroundColor: '#f59e0b15', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '12px',
        }}>
          ⚡
        </div>
        <span style={{ 
          fontSize: '10px', 
          textTransform: 'uppercase', 
          color: '#b45309',
          fontWeight: 700,
          letterSpacing: '0.05em',
        }}>
          Condition
        </span>
      </div>
      <div style={{ 
        fontSize: '13px', 
        fontWeight: 600,
        color: '#92400e',
      }}>
        {data.label || 'If...'}
      </div>
      <div style={{
        fontSize: '11px',
        color: '#a16207',
        marginTop: '4px',
        fontFamily: 'monospace',
        backgroundColor: 'rgba(245, 158, 11, 0.1)',
        padding: '4px 8px',
        borderRadius: '6px',
      }}>
        {data.field} {operatorLabels[data.operator]} &quot;{data.value}&quot;
      </div>
      
      {/* True/False branch labels */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: '10px',
        marginTop: '10px',
        fontWeight: 600,
      }}>
        <span style={{ 
          color: '#16a34a', 
          backgroundColor: '#dcfce7', 
          padding: '2px 8px', 
          borderRadius: '4px',
        }}>✓ Yes</span>
        <span style={{ 
          color: '#dc2626', 
          backgroundColor: '#fee2e2', 
          padding: '2px 8px', 
          borderRadius: '4px',
        }}>✗ No</span>
      </div>

      {/* True branch */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="true"
        style={{
          left: '30%',
          background: 'linear-gradient(135deg, #22c55e, #16a34a)',
          width: '12px',
          height: '12px',
          border: '2px solid white',
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
          background: 'linear-gradient(135deg, #ef4444, #dc2626)',
          width: '12px',
          height: '12px',
          border: '2px solid white',
          boxShadow: '0 2px 6px rgba(239, 68, 68, 0.4)',
        }}
      />
    </div>
  );
});

ConditionNode.displayName = 'ConditionNode';
