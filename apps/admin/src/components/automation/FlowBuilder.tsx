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
import {
  PlayCircle,
  Zap,
  Settings as SettingsIcon,
  Timer,
  Puzzle,
  Lightbulb,
  Trash2,
  RotateCcw,
  Save,
  X,
  Bot,
  MapPin,
  Pencil,
  type LucideIcon,
} from 'lucide-react';

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
type PaletteItem = {
  type: string;
  label: string;
  Icon: LucideIcon;
  color: string;
  tone: string;
  desc: string;
};
const paletteItems: PaletteItem[] = [
  { type: 'trigger',   label: 'Trigger',   Icon: PlayCircle,   color: '#22c55e', tone: 'text-primary',          desc: 'Start automation' },
  { type: 'condition', label: 'Condition', Icon: Zap,          color: '#f59e0b', tone: 'text-amber-300',        desc: 'Branch logic' },
  { type: 'action',    label: 'Action',    Icon: SettingsIcon, color: '#818cf8', tone: 'text-indigo-300',       desc: 'Perform task' },
  { type: 'delay',     label: 'Delay',     Icon: Timer,        color: '#64748b', tone: 'text-muted-foreground', desc: 'Wait timer' },
];

// Shared styles for the Node Editor Panel — use theme HSL via CSS custom props.
// We keep inline style here because ReactFlow nodes/panels sometimes need direct
// values; HSL hooks into the same vars as Tailwind utility classes.
const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '11px',
  fontWeight: 600,
  color: 'hsl(var(--muted-foreground))',
  marginBottom: '4px',
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  fontSize: '13px',
  border: '1px solid hsl(var(--border))',
  borderRadius: '8px',
  backgroundColor: 'hsl(var(--secondary) / 0.4)',
  color: 'hsl(var(--foreground))',
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
      style: { stroke: '#818cf8', strokeWidth: 2 },
      markerEnd: { type: 'arrowclosed' as any, color: '#818cf8' },
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
    <div className="absolute inset-0 flex">
      {/* Left Sidebar — Node Palette */}
      {!readOnly && (
        <div className="w-[220px] bg-card border-r border-border flex flex-col overflow-hidden">
          {/* Palette Header */}
          <div className="p-4 pb-3 border-b border-border">
            <div className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              <Puzzle className="w-3 h-3" aria-hidden="true" />
              Components
            </div>
            <div className="text-[11px] text-muted-foreground/70 mt-0.5">
              Drag to canvas to add
            </div>
          </div>

          {/* Palette Items */}
          <div className="flex-1 p-3 flex flex-col gap-2 overflow-y-auto">
            {paletteItems.map((item) => {
              const Icon = item.Icon;
              return (
                <div
                  key={item.type}
                  draggable
                  onDragStart={(e) => onDragStart(e, item.type)}
                  role="button"
                  tabIndex={0}
                  aria-label={`Drag ${item.label} node to canvas`}
                  className="group p-3.5 bg-secondary/30 hover:bg-secondary/60 rounded-xl border border-border hover:border-primary/40 cursor-grab active:cursor-grabbing transition-all focus:outline-none focus:ring-2 focus:ring-primary/40 shadow-sm"
                >
                  <div className="flex items-center gap-2.5">
                    <span className={`flex h-9 w-9 items-center justify-center rounded-xl bg-card border border-border/60 ${item.tone}`}>
                      <Icon className="w-4 h-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <div className={`text-[13px] font-semibold ${item.tone}`}>
                        {item.label}
                      </div>
                      <div className="text-[10px] text-muted-foreground/80 mt-px">
                        {item.desc}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Palette Footer */}
          <div className="p-3 border-t border-border">
            <div className="p-2.5 bg-sky-500/10 border border-sky-500/30 rounded-xl text-[11px] text-sky-300 leading-snug">
              <div className="inline-flex items-center gap-1 font-semibold mb-1">
                <Lightbulb className="w-3 h-3" aria-hidden="true" />
                Tips
              </div>
              <p className="text-sky-200/90">
                Connect nodes by dragging from output to input handles. Use the controls panel to zoom and fit view.
              </p>
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
            style: { stroke: '#818cf8', strokeWidth: 2 },
          }}
        >
          <Controls
            style={{
              borderRadius: '12px',
              overflow: 'hidden',
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
              border: '1px solid hsl(var(--border))',
              background: 'hsl(var(--card))',
            }}
          />
          <MiniMap
            nodeColor={(n) => {
              if (n.type === 'trigger') return '#22c55e';
              if (n.type === 'condition') return '#f59e0b';
              if (n.type === 'action') return '#818cf8';
              if (n.type === 'delay') return '#64748b';
              return '#94a3b8';
            }}
            style={{
              borderRadius: '12px',
              overflow: 'hidden',
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
              border: '1px solid hsl(var(--border))',
              background: 'hsl(var(--card))',
            }}
            maskColor="rgba(0, 0, 0, 0.4)"
          />
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1}
            color="hsl(var(--border))"
          />

          {/* Top-right action buttons */}
          {!readOnly && (
            <Panel position="top-right">
              <div className="flex gap-2">
                {selectedNode && (
                  <button
                    type="button"
                    onClick={handleDeleteSelected}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-destructive/10 text-destructive border border-destructive/30 rounded-xl text-xs font-semibold hover:bg-destructive/20 cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-destructive/40"
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    Delete
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleClearAll}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-amber-500/10 text-amber-300 border border-amber-500/30 rounded-xl text-xs font-semibold hover:bg-amber-500/20 cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500/40"
                >
                  <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                  Clear
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-xs font-semibold hover:bg-primary/90 shadow-lg shadow-primary/25 cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2 focus:ring-offset-background"
                >
                  <Save className="w-3.5 h-3.5" aria-hidden="true" />
                  Save Flow
                </button>
              </div>
            </Panel>
          )}

          {/* Node count indicator */}
          <Panel position="bottom-right">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-card/80 backdrop-blur-md border border-border rounded-lg text-[11px] text-muted-foreground tabular-nums">
              <span className="inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-primary" aria-hidden="true" />
                {nodes.length} nodes
              </span>
              <span className="text-muted-foreground/50" aria-hidden="true">|</span>
              <span className="inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" aria-hidden="true" />
                {edges.length} connections
              </span>
            </div>
          </Panel>
        </ReactFlow>
        </div>
      </div>

      {/* Right Sidebar — Node Editor Panel */}
      {!readOnly && selectedNode && (() => {
        const typeIconMap: Record<string, { Icon: LucideIcon; tone: string; toneBg: string }> = {
          trigger:   { Icon: PlayCircle,   tone: 'text-primary',          toneBg: 'bg-primary/15' },
          condition: { Icon: Zap,          tone: 'text-amber-300',        toneBg: 'bg-amber-500/15' },
          action:    { Icon: SettingsIcon, tone: 'text-indigo-300',       toneBg: 'bg-indigo-500/15' },
          delay:     { Icon: Timer,        tone: 'text-muted-foreground', toneBg: 'bg-secondary/60' },
        };
        const meta = typeIconMap[selectedNode.type] ?? typeIconMap.action;
        const HeaderIcon = meta.Icon;
        return (
        <div className="w-[280px] bg-card border-l border-border flex flex-col overflow-hidden">
          {/* Editor Header */}
          <div className="px-4 py-3.5 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${meta.toneBg} ${meta.tone}`}>
                <HeaderIcon className="w-3.5 h-3.5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <div className="text-xs font-bold text-foreground capitalize">
                  {selectedNode.type} Editor
                </div>
                <div className="text-[10px] text-muted-foreground/80 font-mono truncate">
                  ID: {selectedNode.id.substring(0, 12)}...
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSelectedNode(null)}
              aria-label="Close editor panel"
              className="w-6 h-6 inline-flex items-center justify-center rounded-md border border-border bg-secondary/40 text-muted-foreground hover:bg-secondary/60 hover:text-foreground cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <X className="w-3 h-3" aria-hidden="true" />
            </button>
          </div>

          {/* Editor Form */}
          <div className="flex-1 p-4 overflow-y-auto flex flex-col gap-3.5">
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
                    <option value="all">All Messages</option>
                    <option value="keyword">Keyword Match</option>
                    <option value="regex">Pattern Match (Regex)</option>
                    <option value="new_contact">New Contact</option>
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
                      <div className="text-[11px] text-muted-foreground mt-1">i = case-insensitive, g = global, m = multiline</div>
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
                        <option value="text">Text</option>
                        <option value="image">Image</option>
                        <option value="video">Video</option>
                        <option value="audio">Audio</option>
                        <option value="document">Document</option>
                        <option value="sticker">Sticker</option>
                        <option value="location">Location</option>
                        <option value="contact">Contact</option>
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
                        <option value="user">Private Chat</option>
                        <option value="group">Group Chat</option>
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
                    <option value="send_text">Send Text</option>
                    <option value="send_image">Send Image</option>
                    <option value="send_video">Send Video</option>
                    <option value="send_audio">Send Audio</option>
                    <option value="send_document">Send Document</option>
                    <option value="send_poll">Send Poll</option>
                    <option value="send_location">Send Location</option>
                    <option value="send_contact">Send Contact</option>
                    <option value="add_tag">Add Tag</option>
                    <option value="remove_tag">Remove Tag</option>
                    <option value="assign_agent">Assign Agent</option>
                    <option value="ai_reply">AI Reply</option>
                    <option value="webhook">Call Webhook</option>
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
                    <div className="text-[10px] text-muted-foreground/80 mt-1">
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
                    <label style={{ ...labelStyle, marginTop: '10px' }} className="text-muted-foreground">Caption</label>
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
                    <label style={{ ...labelStyle, marginTop: '10px' }} className="text-muted-foreground">Filename</label>
                    <input
                      type="text"
                      value={(selectedNode.data.config as any)?.filename || ''}
                      onChange={(e) => updateNodeData(selectedNode.id, 'config', { ...(selectedNode.data.config || {}), filename: e.target.value })}
                      style={inputStyle}
                      placeholder="document.pdf"
                    />
                    <label style={{ ...labelStyle, marginTop: '10px' }} className="text-muted-foreground">Caption (optional)</label>
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
                    <label style={{ ...labelStyle, marginTop: '10px' }} className="text-muted-foreground">Options (comma-separated)</label>
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
                    <div className="text-[10px] text-muted-foreground/80 mt-1">
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
                    <label style={{ ...labelStyle, marginTop: '10px' }} className="text-muted-foreground">Caption (optional)</label>
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
                      <span className="text-xs text-foreground">Send as voice note (PTT)</span>
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
                      className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-primary hover:text-primary/80 cursor-pointer bg-transparent border-0 px-0 py-1"
                    >
                      <MapPin className="w-3 h-3" aria-hidden="true" />
                      Use current location
                    </button>
                    <label style={{ ...labelStyle, marginTop: '10px' }} className="text-muted-foreground">Name (optional)</label>
                    <input
                      type="text"
                      value={(selectedNode.data.config as any)?.name || ''}
                      onChange={(e) => updateNodeData(selectedNode.id, 'config', { ...(selectedNode.data.config || {}), name: e.target.value })}
                      style={inputStyle}
                      placeholder="Location name"
                    />
                    <label style={{ ...labelStyle, marginTop: '10px' }} className="text-muted-foreground">Address (optional)</label>
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
                    <label style={{ ...labelStyle, marginTop: '10px' }} className="text-muted-foreground">Phone Number</label>
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
                    <div className="text-[10px] text-muted-foreground/80 mt-1">
                      Enter the team member user ID. Use the standard modal for a dropdown.
                    </div>
                  </div>
                )}
                {selectedNode.data.actionType === 'ai_reply' && (
                  <div>
                    <div className="px-2.5 py-2 bg-sky-500/10 border border-sky-500/30 rounded-md mb-2.5">
                      <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-300">
                        <Bot className="w-3 h-3" aria-hidden="true" />
                        AI-Powered Reply
                      </div>
                      <div className="text-[10px] text-sky-200/80 mt-0.5">
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
                    <label style={{ ...labelStyle, marginTop: '10px' }} className="text-muted-foreground">Method</label>
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
                  <div className="mt-3 p-2.5 bg-indigo-500/10 border border-indigo-500/30 rounded-lg">
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={(selectedNode.data.config as any)?.simulateTyping || false}
                        onChange={(e) => updateNodeData(selectedNode.id, 'config', { ...(selectedNode.data.config || {}), simulateTyping: e.target.checked })}
                        style={{ width: '16px', height: '16px', accentColor: '#6366f1' }}
                      />
                      <div>
                        <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground"><Pencil className="w-3 h-3" aria-hidden="true" />Simulate Typing</div>
                        <div className="text-[10px] text-muted-foreground/80 mt-0.5">Shows &quot;typing...&quot; indicator before sending</div>
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
          <div className="px-4 py-3 border-t border-border">
            <button
              onClick={() => {
                if (selectedNode) {
                  setNodes((nds) => nds.filter((n) => n.id !== selectedNode.id));
                  setEdges((eds) => eds.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id));
                  setSelectedNode(null);
                }
              }}
              className="w-full px-3.5 py-2 bg-destructive/10 text-destructive border border-destructive/30 rounded-lg text-xs font-semibold hover:bg-destructive/20 cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-destructive/40"
            >
              <span className="inline-flex items-center justify-center gap-1.5">
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                Delete This Node
              </span>
            </button>
          </div>
        </div>
        );
      })()}
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
