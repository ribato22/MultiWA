'use client';

import React from 'react';

const nodeItems = [
  {
    type: 'trigger',
    label: 'Trigger',
    icon: '▶️',
    color: '#22c55e',
    description: 'Start of automation flow',
  },
  {
    type: 'condition',
    label: 'Condition',
    icon: '⚡',
    color: '#f59e0b',
    description: 'Branch based on conditions',
  },
  {
    type: 'action',
    label: 'Action',
    icon: '⚙️',
    color: '#6366f1',
    description: 'Perform an action',
  },
  {
    type: 'delay',
    label: 'Delay',
    icon: '⏱️',
    color: '#64748b',
    description: 'Wait before next step',
  },
];

export const NodePalette: React.FC = () => {
  const onDragStart = (event: React.DragEvent, nodeType: string) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div
      style={{
        width: '200px',
        padding: '16px',
        backgroundColor: '#f9fafb',
        borderRight: '1px solid #e5e7eb',
        overflowY: 'auto',
      }}
    >
      <h3 style={{ 
        fontSize: '12px', 
        fontWeight: 600, 
        textTransform: 'uppercase',
        color: '#6b7280',
        marginBottom: '12px',
      }}>
        Node Types
      </h3>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {nodeItems.map((item) => (
          <div
            key={item.type}
            draggable
            onDragStart={(e) => onDragStart(e, item.type)}
            style={{
              padding: '12px',
              backgroundColor: 'white',
              borderRadius: '8px',
              border: `2px solid ${item.color}20`,
              cursor: 'grab',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = item.color;
              e.currentTarget.style.transform = 'scale(1.02)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = `${item.color}20`;
              e.currentTarget.style.transform = 'scale(1)';
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '18px' }}>{item.icon}</span>
              <div>
                <div style={{ 
                  fontWeight: 600, 
                  fontSize: '14px',
                  color: item.color,
                }}>
                  {item.label}
                </div>
                <div style={{ 
                  fontSize: '11px', 
                  color: '#9ca3af',
                }}>
                  {item.description}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
      
      <div style={{
        marginTop: '24px',
        padding: '12px',
        backgroundColor: '#fef3c7',
        borderRadius: '8px',
        fontSize: '11px',
        color: '#92400e',
      }}>
        💡 <strong>Tip:</strong> Drag nodes onto the canvas to build your automation flow.
      </div>
    </div>
  );
};
