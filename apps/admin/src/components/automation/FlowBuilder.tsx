'use client';

import React, { useCallback, useMemo, useState, useRef } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  NodeTypes,
  BackgroundVariant,
  ReactFlowProvider,
  useReactFlow,
  Panel,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { TriggerNode } from './nodes/TriggerNode';
import { ConditionNode } from './nodes/ConditionNode';
import { ActionNode } from './nodes/ActionNode';
import { DelayNode } from './nodes/DelayNode';

export interface FlowBuilderProps {
  initialNodes?: Node[];
  initialEdges?: Edge[];
  onSave?: (nodes: Node[], edges: Edge[]) => void;
  readOnly?: boolean;
}

const initialNodesDefault: Node[] = [
  {
    id: 'trigger-1',
    type: 'trigger',
    position: { x: 250, y: 50 },
    data: { 
      label: 'All Messages',
      triggerType: 'all',
      filters: {},
    },
  },
];

const initialEdgesDefault: Edge[] = [];

// Node palette items
const paletteItems = [
  { type: 'trigger', label: 'Trigger', icon: '▶️', color: '#22c55e', desc: 'Start automation' },
  { type: 'condition', label: 'Condition', icon: '⚡', color: '#f59e0b', desc: 'Branch logic' },
  { type: 'action', label: 'Action', icon: '⚙️', color: '#6366f1', desc: 'Perform task' },
  { type: 'delay', label: 'Delay', icon: '⏱️', color: '#64748b', desc: 'Wait timer' },
];

// Shared styles for the Node Editor Panel
const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '11px',
  fontWeight: 600,
  color: '#475569',
  marginBottom: '4px',
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  fontSize: '13px',
  border: '1px solid #e2e8f0',
  borderRadius: '8px',
  backgroundColor: 'white',
  color: '#1e293b',
  outline: 'none',
  transition: 'border-color 0.15s',
  boxSizing: 'border-box',
};

function FlowCanvas({
  initialNodes = initialNodesDefault,
  initialEdges = initialEdgesDefault,
  onSave,
  readOnly = false,
}: FlowBuilderProps) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const { project, fitView } = useReactFlow();

  const nodeTypes: NodeTypes = useMemo(() => ({
    trigger: TriggerNode,
    condition: ConditionNode,
    action: ActionNode,
    delay: DelayNode,
  }), []);

  const onConnect = useCallback((params: Connection) => {
    setEdges((eds) => addEdge({
      ...params,
      animated: true,
      style: { stroke: '#6366f1', strokeWidth: 2 },
      markerEnd: { type: 'arrowclosed' as any, color: '#6366f1' },
    }, eds));
  }, [setEdges]);

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();

    const type = event.dataTransfer.getData('application/reactflow');
    if (!type) return;

    // Use reactflow project to convert screen coordinates to flow coordinates
    const bounds = reactFlowWrapper.current?.getBoundingClientRect();
    const position = project({
      x: event.clientX - (bounds?.left || 0),
      y: event.clientY - (bounds?.top || 0),
    });

    const newNode: Node = {
      id: `${type}-${Date.now()}`,
      type,
      position,
      data: getDefaultNodeData(type),
    };

    setNodes((nds) => nds.concat(newNode));
  }, [setNodes, project]);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
    // Auto-fit canvas so all nodes remain visible
    setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 50);
  }, [fitView]);

  const handlePaneClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  // Update node data in real-time from the editor panel
  const updateNodeData = useCallback((nodeId: string, key: string, value: unknown) => {
    setNodes((nds) =>
      nds.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, [key]: value } } : n
      )
    );
    // Also update selectedNode so the editor panel reflects changes
    setSelectedNode((prev) =>
      prev && prev.id === nodeId ? { ...prev, data: { ...prev.data, [key]: value } } : prev
    );
  }, [setNodes]);

  const handleSave = useCallback(() => {
    onSave?.(nodes, edges);
  }, [nodes, edges, onSave]);

  const handleDeleteSelected = useCallback(() => {
    if (selectedNode) {
      setNodes((nds) => nds.filter((n) => n.id !== selectedNode.id));
      setEdges((eds) => eds.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id));
      setSelectedNode(null);
    }
  }, [selectedNode, setNodes, setEdges]);

  const handleClearAll = useCallback(() => {
    setNodes([]);
    setEdges([]);
    setSelectedNode(null);
  }, [setNodes, setEdges]);

  const onDragStart = (event: React.DragEvent, nodeType: string) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
      {/* Left Sidebar — Node Palette */}
      {!readOnly && (
        <div style={{
          width: '220px',
          background: 'linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)',
          borderRight: '1px solid #e2e8f0',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
          {/* Palette Header */}
          <div style={{
            padding: '16px 16px 12px',
            borderBottom: '1px solid #e2e8f0',
          }}>
            <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748b' }}>
              🧩 Components
            </div>
            <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
              Drag to canvas to add
            </div>
          </div>

          {/* Palette Items */}
          <div style={{ flex: 1, padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto' }}>
            {paletteItems.map((item) => (
              <div
                key={item.type}
                draggable
                onDragStart={(e) => onDragStart(e, item.type)}
                style={{
                  padding: '14px',
                  backgroundColor: 'white',
                  borderRadius: '12px',
                  border: `2px solid ${item.color}15`,
                  cursor: 'grab',
                  transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = item.color;
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = `0 4px 12px ${item.color}25`;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = `${item.color}15`;
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.06)';
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{
                    width: '36px', height: '36px', borderRadius: '10px',
                    background: `${item.color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '16px',
                  }}>
                    {item.icon}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '13px', color: '#1e293b' }}>
                      {item.label}
                    </div>
                    <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '1px' }}>
                      {item.desc}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Palette Footer */}
          <div style={{
            padding: '12px',
            borderTop: '1px solid #e2e8f0',
          }}>
            <div style={{
              padding: '10px 12px',
              background: 'linear-gradient(135deg, #dbeafe 0%, #e0e7ff 100%)',
              borderRadius: '10px',
              fontSize: '11px',
              color: '#3b82f6',
              lineHeight: 1.4,
            }}>
              💡 <strong>Tips:</strong> Connect nodes by dragging from output to input handles. Use the controls panel to zoom and fit view.
            </div>
          </div>
        </div>
      )}

      {/* Canvas Area */}
      <div ref={reactFlowWrapper} style={{ flex: 1, position: 'relative' }}>
        <div style={{ position: 'absolute', inset: 0 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onNodeClick={handleNodeClick}
          onPaneClick={handlePaneClick}
          nodeTypes={nodeTypes}
          fitView
          snapToGrid
          snapGrid={[15, 15]}
          nodesDraggable={!readOnly}
          nodesConnectable={!readOnly}
          elementsSelectable={!readOnly}
          proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={{
            animated: true,
            style: { stroke: '#6366f1', strokeWidth: 2 },
          }}
        >
          <Controls 
            style={{ 
              borderRadius: '12px', 
              overflow: 'hidden', 
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              border: '1px solid #e2e8f0',
            }}
          />
          <MiniMap 
            nodeColor={(n) => {
              if (n.type === 'trigger') return '#22c55e';
              if (n.type === 'condition') return '#f59e0b';
              if (n.type === 'action') return '#6366f1';
              if (n.type === 'delay') return '#64748b';
              return '#999';
            }}
            style={{
              borderRadius: '12px',
              overflow: 'hidden',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              border: '1px solid #e2e8f0',
            }}
            maskColor="rgba(0, 0, 0, 0.08)"
          />
          <Background 
            variant={BackgroundVariant.Dots} 
            gap={20} 
            size={1} 
            color="#e2e8f0"
          />

          {/* Top-right action buttons */}
          {!readOnly && (
            <Panel position="top-right">
              <div style={{ display: 'flex', gap: '8px' }}>
                {selectedNode && (
                  <button
                    onClick={handleDeleteSelected}
                    style={{
                      padding: '8px 14px',
                      backgroundColor: '#fee2e2',
                      color: '#dc2626',
                      border: '1px solid #fecaca',
                      borderRadius: '10px',
                      cursor: 'pointer',
                      fontSize: '12px',
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      transition: 'all 0.15s',
                    }}
                  >
                    🗑️ Delete
                  </button>
                )}
                <button
                  onClick={handleClearAll}
                  style={{
                    padding: '8px 14px',
                    backgroundColor: '#fff7ed',
                    color: '#ea580c',
                    border: '1px solid #fed7aa',
                    borderRadius: '10px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    transition: 'all 0.15s',
                  }}
                >
                  🔄 Clear
                </button>
                <button
                  onClick={handleSave}
                  style={{
                    padding: '8px 16px',
                    background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '10px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    boxShadow: '0 4px 12px rgba(99, 102, 241, 0.35)',
                    transition: 'all 0.15s',
                  }}
                >
                  💾 Save Flow
                </button>
              </div>
            </Panel>
          )}

          {/* Node count indicator */}
          <Panel position="bottom-right">
            <div style={{
              padding: '6px 12px',
              backgroundColor: 'rgba(255,255,255,0.9)',
              backdropFilter: 'blur(8px)',
              borderRadius: '8px',
              border: '1px solid #e2e8f0',
              fontSize: '11px',
              color: '#64748b',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#22c55e' }} />
                {nodes.length} nodes
              </span>
              <span style={{ color: '#cbd5e1' }}>|</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#6366f1' }} />
                {edges.length} connections
              </span>
            </div>
          </Panel>
        </ReactFlow>
        </div>
      </div>

      {/* Right Sidebar — Node Editor Panel */}
      {!readOnly && selectedNode && (
        <div style={{
          width: '280px',
          background: 'linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)',
          borderLeft: '1px solid #e2e8f0',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
          {/* Editor Header */}
          <div style={{
            padding: '14px 16px',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{
                width: '28px', height: '28px', borderRadius: '8px',
                background: selectedNode.type === 'trigger' ? '#22c55e15' :
                  selectedNode.type === 'condition' ? '#f59e0b15' :
                  selectedNode.type === 'action' ? '#6366f115' : '#64748b15',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '14px',
              }}>
                {selectedNode.type === 'trigger' ? '▶️' :
                 selectedNode.type === 'condition' ? '⚡' :
                 selectedNode.type === 'action' ? '⚙️' : '⏱️'}
              </div>
              <div>
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#1e293b', textTransform: 'capitalize' }}>
                  {selectedNode.type} Editor
                </div>
                <div style={{ fontSize: '10px', color: '#94a3b8' }}>
                  ID: {selectedNode.id.substring(0, 12)}...
                </div>
              </div>
            </div>
            <button
              onClick={() => setSelectedNode(null)}
              style={{
                width: '24px', height: '24px', borderRadius: '6px',
                border: '1px solid #e2e8f0', background: 'white',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '12px', color: '#64748b',
              }}
            >
              ✕
            </button>
          </div>

          {/* Editor Form */}
          <div style={{ flex: 1, padding: '16px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Label (common to all) */}
            <div>
              <label style={labelStyle}>Label</label>
              <input
                type="text"
                value={selectedNode.data.label || ''}
                onChange={(e) => updateNodeData(selectedNode.id, 'label', e.target.value)}
                style={inputStyle}
                placeholder="Node label..."
              />
            </div>

            {/* === TRIGGER EDITOR === */}
            {selectedNode.type === 'trigger' && (
              <>
                <div>
                  <label style={labelStyle}>Trigger Type</label>
                  <select
                    value={selectedNode.data.triggerType || 'all'}
                    onChange={(e) => updateNodeData(selectedNode.id, 'triggerType', e.target.value)}
                    style={inputStyle}
                  >
                    <option value="all">📩 All Messages</option>
                    <option value="keyword">🔤 Keyword Match</option>
                    <option value="regex">🔣 Pattern Match (Regex)</option>
                    <option value="new_contact">👤 New Contact</option>
                  </select>
                </div>
                {selectedNode.data.triggerType === 'keyword' && (
                  <div>
                    <label style={labelStyle}>Keyword</label>
                    <input
                      type="text"
                      value={(selectedNode.data.filters as any)?.keyword || ''}
                      onChange={(e) => updateNodeData(selectedNode.id, 'filters', { ...(selectedNode.data.filters || {}), keyword: e.target.value })}
                      style={inputStyle}
                      placeholder="e.g. hello, help, order"
                    />
                  </div>
                )}
                {selectedNode.data.triggerType === 'regex' && (
                  <>
                    <div>
                      <label style={labelStyle}>Pattern (Regex)</label>
                      <input
                        type="text"
                        value={selectedNode.data.pattern || ''}
                        onChange={(e) => updateNodeData(selectedNode.id, 'pattern', e.target.value)}
                        style={inputStyle}
                        placeholder="e.g. ^(hello|hi|hey)$"
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Flags</label>
                      <input
                        type="text"
                        value={selectedNode.data.flags || 'i'}
                        onChange={(e) => updateNodeData(selectedNode.id, 'flags', e.target.value)}
                        style={inputStyle}
                        placeholder="e.g. i, gi, m"
                      />
                      <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>i = case-insensitive, g = global, m = multiline</div>
                    </div>
                  </>
                )}
              </>
            )}

            {/* === CONDITION EDITOR === */}
            {selectedNode.type === 'condition' && (
              <>
                <div>
                  <label style={labelStyle}>Field</label>
                  <select
                    value={selectedNode.data.field || 'message.text'}
                    onChange={(e) => updateNodeData(selectedNode.id, 'field', e.target.value)}
                    style={inputStyle}
                  >
                    <option value="message.text">Message Text</option>
                    <option value="message.type">Message Type</option>
                    <option value="sender.name">Sender Name</option>
                    <option value="sender.phone">Sender Phone</option>
                    <option value="conversation.type">Chat Type (user/group)</option>
                  </select>
                </div>

                {/* Dynamic fields based on selected field type */}
                {(selectedNode.data.field === 'message.text' || selectedNode.data.field === 'sender.name' || selectedNode.data.field === 'sender.phone' || !selectedNode.data.field) && (
                  <>
                    <div>
                      <label style={labelStyle}>Operator</label>
                      <select
                        value={selectedNode.data.operator || 'contains'}
                        onChange={(e) => updateNodeData(selectedNode.id, 'operator', e.target.value)}
                        style={inputStyle}
                      >
                        <option value="contains">Contains</option>
                        <option value="equals">Equals</option>
                        <option value="not_equals">Not Equals</option>
                        <option value="starts_with">Starts With</option>
                        <option value="ends_with">Ends With</option>
                        <option value="regex">Regex</option>
                      </select>
                    </div>
                    <div>
                      <label style={labelStyle}>Value</label>
                      <input
                        type="text"
                        value={selectedNode.data.value || ''}
                        onChange={(e) => updateNodeData(selectedNode.id, 'value', e.target.value)}
                        style={inputStyle}
                        placeholder={selectedNode.data.field === 'sender.phone' ? 'e.g. 628123456789' : 'e.g. hello, order, help'}
                      />
                    </div>
                  </>
                )}

                {selectedNode.data.field === 'message.type' && (
                  <>
                    <div>
                      <label style={labelStyle}>Operator</label>
                      <select
                        value={selectedNode.data.operator || 'equals'}
                        onChange={(e) => updateNodeData(selectedNode.id, 'operator', e.target.value)}
                        style={inputStyle}
                      >
                        <option value="equals">Equals</option>
                        <option value="not_equals">Not Equals</option>
                      </select>
                    </div>
                    <div>
                      <label style={labelStyle}>Message Type</label>
                      <select
                        value={selectedNode.data.value || 'text'}
                        onChange={(e) => updateNodeData(selectedNode.id, 'value', e.target.value)}
                        style={inputStyle}
                      >
                        <option value="text">💬 Text</option>
                        <option value="image">🖼️ Image</option>
                        <option value="video">🎬 Video</option>
                        <option value="audio">🎵 Audio</option>
                        <option value="document">📄 Document</option>
                        <option value="sticker">😀 Sticker</option>
                        <option value="location">📍 Location</option>
                        <option value="contact">👤 Contact</option>
                      </select>
                    </div>
                  </>
                )}

                {selectedNode.data.field === 'conversation.type' && (
                  <>
                    <div>
                      <label style={labelStyle}>Operator</label>
                      <select
                        value={selectedNode.data.operator || 'equals'}
                        onChange={(e) => updateNodeData(selectedNode.id, 'operator', e.target.value)}
                        style={inputStyle}
                      >
                        <option value="equals">Equals</option>
                        <option value="not_equals">Not Equals</option>
                      </select>
                    </div>
                    <div>
                      <label style={labelStyle}>Chat Type</label>
                      <select
                        value={selectedNode.data.value || 'user'}
                        onChange={(e) => updateNodeData(selectedNode.id, 'value', e.target.value)}
                        style={inputStyle}
                      >
                        <option value="user">👤 Private Chat</option>
                        <option value="group">👥 Group Chat</option>
                      </select>
                    </div>
                  </>
                )}
              </>
            )}

            {/* === ACTION EDITOR === */}
            {selectedNode.type === 'action' && (
              <>
                <div>
                  <label style={labelStyle}>Action Type</label>
                  <select
                    value={selectedNode.data.actionType || 'send_text'}
                    onChange={(e) => updateNodeData(selectedNode.id, 'actionType', e.target.value)}
                    style={inputStyle}
                  >
                    <option value="send_text">💬 Send Text</option>
                    <option value="send_image">🖼️ Send Image</option>
                    <option value="send_video">🎬 Send Video</option>
                    <option value="send_audio">🎵 Send Audio</option>
                    <option value="send_document">📄 Send Document</option>
                    <option value="send_poll">📊 Send Poll</option>
                    <option value="send_location">📍 Send Location</option>
                    <option value="send_contact">👤 Send Contact</option>
                    <option value="add_tag">🏷️ Add Tag</option>
                    <option value="remove_tag">🏷️ Remove Tag</option>
                    <option value="assign_agent">👤 Assign Agent</option>
                    <option value="ai_reply">🤖 AI Reply</option>
                    <option value="webhook">🔗 Call Webhook</option>
                  </select>
                </div>
                {(selectedNode.data.actionType === 'send_text' || !selectedNode.data.actionType) && (
                  <div>
                    <label style={labelStyle}>Message Text</label>
                    <textarea
                      value={(selectedNode.data.config as any)?.text || ''}
                      onChange={(e) => updateNodeData(selectedNode.id, 'config', { ...(selectedNode.data.config || {}), text: e.target.value })}
                      style={{ ...inputStyle, minHeight: '80px', resize: 'vertical', fontFamily: 'inherit' }}
                      placeholder="Type your reply message here..."
                    />
                    <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '4px' }}>
                      Variables: {'{{name}}'}, {'{{phone}}'}, {'{{message}}'}
                    </div>
                  </div>
                )}
                {selectedNode.data.actionType === 'send_image' && (
                  <div>
                    <label style={labelStyle}>Image URL</label>
                    <input
                      type="text"
                      value={(selectedNode.data.config as any)?.url || ''}
                      onChange={(e) => updateNodeData(selectedNode.id, 'config', { ...(selectedNode.data.config || {}), url: e.target.value })}
                      style={inputStyle}
                      placeholder="https://example.com/image.jpg"
                    />
                    <label style={{ ...labelStyle, marginTop: '10px' }}>Caption</label>
                    <input
                      type="text"
                      value={(selectedNode.data.config as any)?.caption || ''}
                      onChange={(e) => updateNodeData(selectedNode.id, 'config', { ...(selectedNode.data.config || {}), caption: e.target.value })}
                      style={inputStyle}
                      placeholder="Image caption..."
                    />
                  </div>
                )}
                {selectedNode.data.actionType === 'send_document' && (
                  <div>
                    <label style={labelStyle}>Document URL</label>
                    <input
                      type="text"
                      value={(selectedNode.data.config as any)?.url || ''}
                      onChange={(e) => updateNodeData(selectedNode.id, 'config', { ...(selectedNode.data.config || {}), url: e.target.value })}
                      style={inputStyle}
                      placeholder="https://example.com/document.pdf"
                    />
                    <label style={{ ...labelStyle, marginTop: '10px' }}>Filename</label>
                    <input
                      type="text"
                      value={(selectedNode.data.config as any)?.filename || ''}
                      onChange={(e) => updateNodeData(selectedNode.id, 'config', { ...(selectedNode.data.config || {}), filename: e.target.value })}
                      style={inputStyle}
                      placeholder="document.pdf"
                    />
                    <label style={{ ...labelStyle, marginTop: '10px' }}>Caption (optional)</label>
                    <input
                      type="text"
                      value={(selectedNode.data.config as any)?.caption || ''}
                      onChange={(e) => updateNodeData(selectedNode.id, 'config', { ...(selectedNode.data.config || {}), caption: e.target.value })}
                      style={inputStyle}
                      placeholder="Document caption..."
                    />
                  </div>
                )}
                {selectedNode.data.actionType === 'send_poll' && (
                  <div>
                    <label style={labelStyle}>Question</label>
                    <input
                      type="text"
                      value={(selectedNode.data.config as any)?.question || ''}
                      onChange={(e) => updateNodeData(selectedNode.id, 'config', { ...(selectedNode.data.config || {}), question: e.target.value })}
                      style={inputStyle}
                      placeholder="What do you prefer?"
                    />
                    <label style={{ ...labelStyle, marginTop: '10px' }}>Options (comma-separated)</label>
                    <input
                      type="text"
                      value={((selectedNode.data.config as any)?.options || []).join(', ')}
                      onChange={(e) => {
                        const opts = e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean);
                        updateNodeData(selectedNode.id, 'config', { ...(selectedNode.data.config || {}), options: opts });
                      }}
                      style={inputStyle}
                      placeholder="Option A, Option B, Option C"
                    />
                    <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '4px' }}>
                      Enter 2-12 options separated by commas
                    </div>
                  </div>
                )}
                {selectedNode.data.actionType === 'send_video' && (
                  <div>
                    <label style={labelStyle}>Video URL</label>
                    <input
                      type="text"
                      value={(selectedNode.data.config as any)?.url || ''}
                      onChange={(e) => updateNodeData(selectedNode.id, 'config', { ...(selectedNode.data.config || {}), url: e.target.value })}
                      style={inputStyle}
                      placeholder="https://example.com/video.mp4"
                    />
                    <label style={{ ...labelStyle, marginTop: '10px' }}>Caption (optional)</label>
                    <input
                      type="text"
                      value={(selectedNode.data.config as any)?.caption || ''}
                      onChange={(e) => updateNodeData(selectedNode.id, 'config', { ...(selectedNode.data.config || {}), caption: e.target.value })}
                      style={inputStyle}
                      placeholder="Video caption..."
                    />
                  </div>
                )}
                {selectedNode.data.actionType === 'send_audio' && (
                  <div>
                    <label style={labelStyle}>Audio URL</label>
                    <input
                      type="text"
                      value={(selectedNode.data.config as any)?.url || ''}
                      onChange={(e) => updateNodeData(selectedNode.id, 'config', { ...(selectedNode.data.config || {}), url: e.target.value })}
                      style={inputStyle}
                      placeholder="https://example.com/audio.mp3"
                    />
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '10px' }}>
                      <input
                        type="checkbox"
                        checked={(selectedNode.data.config as any)?.ptt || false}
                        onChange={(e) => updateNodeData(selectedNode.id, 'config', { ...(selectedNode.data.config || {}), ptt: e.target.checked })}
                      />
                      <span style={{ fontSize: '12px', color: '#e2e8f0' }}>Send as voice note (PTT)</span>
                    </div>
                  </div>
                )}
                {selectedNode.data.actionType === 'send_location' && (
                  <div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                      <div>
                        <label style={labelStyle}>Latitude</label>
                        <input
                          type="number"
                          step="any"
                          value={(selectedNode.data.config as any)?.latitude || ''}
                          onChange={(e) => updateNodeData(selectedNode.id, 'config', { ...(selectedNode.data.config || {}), latitude: parseFloat(e.target.value) })}
                          style={inputStyle}
                          placeholder="-6.2088"
                        />
                      </div>
                      <div>
                        <label style={labelStyle}>Longitude</label>
                        <input
                          type="number"
                          step="any"
                          value={(selectedNode.data.config as any)?.longitude || ''}
                          onChange={(e) => updateNodeData(selectedNode.id, 'config', { ...(selectedNode.data.config || {}), longitude: parseFloat(e.target.value) })}
                          style={inputStyle}
                          placeholder="106.8456"
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (navigator.geolocation) {
                          navigator.geolocation.getCurrentPosition(
                            (pos) => {
                              updateNodeData(selectedNode.id, 'config', {
                                ...(selectedNode.data.config || {}),
                                latitude: pos.coords.latitude,
                                longitude: pos.coords.longitude,
                              });
                            },
                            (err) => {
                              alert('Unable to get location: ' + err.message);
                            }
                          );
                        } else {
                          alert('Geolocation is not supported by this browser.');
                        }
                      }}
                      style={{ marginTop: '6px', fontSize: '11px', color: '#10b981', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 0' }}
                    >
                      📱 Use current location
                    </button>
                    <label style={{ ...labelStyle, marginTop: '10px' }}>Name (optional)</label>
                    <input
                      type="text"
                      value={(selectedNode.data.config as any)?.name || ''}
                      onChange={(e) => updateNodeData(selectedNode.id, 'config', { ...(selectedNode.data.config || {}), name: e.target.value })}
                      style={inputStyle}
                      placeholder="Location name"
                    />
                    <label style={{ ...labelStyle, marginTop: '10px' }}>Address (optional)</label>
                    <input
                      type="text"
                      value={(selectedNode.data.config as any)?.address || ''}
                      onChange={(e) => updateNodeData(selectedNode.id, 'config', { ...(selectedNode.data.config || {}), address: e.target.value })}
                      style={inputStyle}
                      placeholder="Full address"
                    />
                  </div>
                )}
                {selectedNode.data.actionType === 'send_contact' && (
                  <div>
                    <label style={labelStyle}>Contact Name</label>
                    <input
                      type="text"
                      value={(selectedNode.data.config as any)?.contactName || ''}
                      onChange={(e) => updateNodeData(selectedNode.id, 'config', { ...(selectedNode.data.config || {}), contactName: e.target.value })}
                      style={inputStyle}
                      placeholder="John Doe"
                    />
                    <label style={{ ...labelStyle, marginTop: '10px' }}>Phone Number</label>
                    <input
                      type="text"
                      value={(selectedNode.data.config as any)?.contactPhone || ''}
                      onChange={(e) => updateNodeData(selectedNode.id, 'config', { ...(selectedNode.data.config || {}), contactPhone: e.target.value })}
                      style={inputStyle}
                      placeholder="628123456789"
                    />
                  </div>
                )}
                {selectedNode.data.actionType === 'assign_agent' && (
                  <div>
                    <label style={labelStyle}>Agent User ID</label>
                    <input
                      type="text"
                      value={(selectedNode.data.config as any)?.assignedUserId || ''}
                      onChange={(e) => updateNodeData(selectedNode.id, 'config', { ...(selectedNode.data.config || {}), assignedUserId: e.target.value })}
                      style={inputStyle}
                      placeholder="User ID to assign conversation to"
                    />
                    <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '4px' }}>
                      Enter the team member user ID. Use the standard modal for a dropdown.
                    </div>
                  </div>
                )}
                {selectedNode.data.actionType === 'ai_reply' && (
                  <div>
                    <div style={{ padding: '8px 10px', background: '#eff6ff', borderRadius: '6px', border: '1px solid #bfdbfe', marginBottom: '10px' }}>
                      <div style={{ fontSize: '11px', fontWeight: 600, color: '#2563eb' }}>🤖 AI-Powered Reply</div>
                      <div style={{ fontSize: '10px', color: '#3b82f6', marginTop: '2px' }}>
                        Uses OpenAI to generate contextual replies based on incoming message and conversation history.
                      </div>
                    </div>
                    <label style={labelStyle}>System Prompt (optional)</label>
                    <textarea
                      value={(selectedNode.data.config as any)?.systemPrompt || ''}
                      onChange={(e) => updateNodeData(selectedNode.id, 'config', { ...(selectedNode.data.config || {}), systemPrompt: e.target.value })}
                      style={{ ...inputStyle, minHeight: '80px', resize: 'vertical', fontFamily: 'inherit' }}
                      placeholder="You are a helpful customer service assistant..."
                    />
                  </div>
                )}
                {selectedNode.data.actionType === 'webhook' && (
                  <div>
                    <label style={labelStyle}>Webhook URL</label>
                    <input
                      type="text"
                      value={(selectedNode.data.config as any)?.url || ''}
                      onChange={(e) => updateNodeData(selectedNode.id, 'config', { ...(selectedNode.data.config || {}), url: e.target.value })}
                      style={inputStyle}
                      placeholder="https://api.example.com/webhook"
                    />
                    <label style={{ ...labelStyle, marginTop: '10px' }}>Method</label>
                    <select
                      value={(selectedNode.data.config as any)?.method || 'POST'}
                      onChange={(e) => updateNodeData(selectedNode.id, 'config', { ...(selectedNode.data.config || {}), method: e.target.value })}
                      style={inputStyle}
                    >
                      <option value="POST">POST</option>
                      <option value="GET">GET</option>
                      <option value="PUT">PUT</option>
                    </select>
                  </div>
                )}
                {(selectedNode.data.actionType === 'add_tag' || selectedNode.data.actionType === 'remove_tag') && (
                  <div>
                    <label style={labelStyle}>Tag Name</label>
                    <input
                      type="text"
                      value={(selectedNode.data.config as any)?.tag || ''}
                      onChange={(e) => updateNodeData(selectedNode.id, 'config', { ...(selectedNode.data.config || {}), tag: e.target.value })}
                      style={inputStyle}
                      placeholder="e.g. VIP, new-customer"
                    />
                  </div>
                )}

                {/* Simulate Typing — for all send actions */}
                {['send_text', 'reply', 'send_image', 'send_video', 'send_audio', 'send_document', 'send_location', 'send_contact', 'send_poll', 'ai_reply'].includes(selectedNode.data.actionType || '') && (
                  <div style={{ marginTop: '12px', padding: '10px', background: 'rgba(99, 102, 241, 0.06)', borderRadius: '8px', border: '1px solid rgba(99, 102, 241, 0.15)' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={(selectedNode.data.config as any)?.simulateTyping || false}
                        onChange={(e) => updateNodeData(selectedNode.id, 'config', { ...(selectedNode.data.config || {}), simulateTyping: e.target.checked })}
                        style={{ width: '16px', height: '16px', accentColor: '#6366f1' }}
                      />
                      <div>
                        <div style={{ fontSize: '12px', fontWeight: 600, color: '#e2e8f0' }}>⌨️ Simulate Typing</div>
                        <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '2px' }}>Shows "typing..." indicator before sending</div>
                      </div>
                    </label>
                    {(selectedNode.data.config as any)?.simulateTyping && (
                      <div style={{ marginTop: '8px' }}>
                        <label style={{ ...labelStyle, fontSize: '10px' }}>Typing Duration (seconds)</label>
                        <input
                          type="number"
                          min={1}
                          max={15}
                          value={(selectedNode.data.config as any)?.typingDuration || 3}
                          onChange={(e) => updateNodeData(selectedNode.id, 'config', { ...(selectedNode.data.config || {}), typingDuration: parseInt(e.target.value) || 3 })}
                          style={{ ...inputStyle, width: '80px' }}
                        />
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* === DELAY EDITOR === */}
            {selectedNode.type === 'delay' && (
              <>
                <div>
                  <label style={labelStyle}>Duration</label>
                  <input
                    type="number"
                    value={selectedNode.data.duration || 5}
                    onChange={(e) => updateNodeData(selectedNode.id, 'duration', parseInt(e.target.value) || 0)}
                    style={inputStyle}
                    min={0}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Unit</label>
                  <select
                    value={selectedNode.data.unit || 'seconds'}
                    onChange={(e) => updateNodeData(selectedNode.id, 'unit', e.target.value)}
                    style={inputStyle}
                  >
                    <option value="seconds">Seconds</option>
                    <option value="minutes">Minutes</option>
                    <option value="hours">Hours</option>
                    <option value="days">Days</option>
                  </select>
                </div>
              </>
            )}
          </div>

          {/* Editor Footer */}
          <div style={{
            padding: '12px 16px',
            borderTop: '1px solid #e2e8f0',
          }}>
            <button
              onClick={() => {
                if (selectedNode) {
                  setNodes((nds) => nds.filter((n) => n.id !== selectedNode.id));
                  setEdges((eds) => eds.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id));
                  setSelectedNode(null);
                }
              }}
              style={{
                width: '100%',
                padding: '8px 14px',
                backgroundColor: '#fee2e2',
                color: '#dc2626',
                border: '1px solid #fecaca',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: 600,
                textAlign: 'center',
              }}
            >
              🗑️ Delete This Node
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Wrapper with ReactFlowProvider for useReactFlow hook
const FlowBuilder: React.FC<FlowBuilderProps> = (props) => {
  return (
    <ReactFlowProvider>
      <FlowCanvas {...props} />
    </ReactFlowProvider>
  );
};

function getDefaultNodeData(type: string): Record<string, unknown> {
  switch (type) {
    case 'trigger':
      return { label: 'New Trigger', triggerType: 'all', filters: {} };
    case 'condition':
      return { label: 'New Condition', field: 'message.text', operator: 'contains', value: '' };
    case 'action':
      return { label: 'New Action', actionType: 'send_text', config: {} };
    case 'delay':
      return { label: 'Delay', duration: 5, unit: 'seconds' };
    default:
      return { label: 'Unknown' };
  }
}

export default FlowBuilder;
