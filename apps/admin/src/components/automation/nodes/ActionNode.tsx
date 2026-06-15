'use client';

import React, { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import {
  Settings as SettingsIcon,
  MessageSquare,
  Image as ImageIcon,
  FileText,
  BarChart3,
  Tag,
  Tags,
  UserCog,
  Bot,
  Webhook as WebhookIcon,
  Timer,
  type LucideIcon,
} from 'lucide-react';

interface ActionNodeData {
  label: string;
  actionType: string;
  config?: Record<string, unknown>;
}

type ActionInfo = { Icon: LucideIcon; label: string };

const actionInfo: Record<string, ActionInfo> = {
  send_text:     { Icon: MessageSquare, label: 'Send Text' },
  send_image:    { Icon: ImageIcon,     label: 'Send Image' },
  send_document: { Icon: FileText,      label: 'Send Document' },
  send_poll:     { Icon: BarChart3,     label: 'Send Poll' },
  add_tag:       { Icon: Tag,           label: 'Add Tag' },
  remove_tag:    { Icon: Tags,          label: 'Remove Tag' },
  assign_agent:  { Icon: UserCog,       label: 'Assign Agent' },
  ai_reply:      { Icon: Bot,           label: 'AI Reply' },
  webhook:       { Icon: WebhookIcon,   label: 'Call Webhook' },
  delay:         { Icon: Timer,         label: 'Delay' },
};

export const ActionNode = memo(({ data, selected }: NodeProps<ActionNodeData>) => {
  const info = actionInfo[data.actionType] ?? { Icon: SettingsIcon, label: data.label };
  const LabelIcon = info.Icon;

  return (
    <div
      className={`
        px-5 py-4 rounded-2xl min-w-[180px]
        bg-indigo-500/10 border-2
        transition-all duration-200
        ${selected
          ? 'border-indigo-400 shadow-lg shadow-indigo-500/25'
          : 'border-indigo-500/40 shadow-md shadow-black/20'}
      `}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{
          background: '#818cf8',
          width: '12px',
          height: '12px',
          border: '2px solid hsl(217 33% 17%)',
          boxShadow: '0 2px 6px rgba(129, 140, 248, 0.4)',
        }}
      />

      <div className="flex items-center gap-2 mb-1.5">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-500/20 text-indigo-300">
          <SettingsIcon className="w-3.5 h-3.5" aria-hidden="true" />
        </span>
        <span className="text-[10px] uppercase font-bold tracking-wider text-indigo-300">
          Action
        </span>
      </div>
      <div className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <LabelIcon className="w-3.5 h-3.5 text-indigo-300 flex-shrink-0" aria-hidden="true" />
        <span className="truncate">{info.label}</span>
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        style={{
          background: '#818cf8',
          width: '12px',
          height: '12px',
          border: '2px solid hsl(217 33% 17%)',
          boxShadow: '0 2px 6px rgba(129, 140, 248, 0.4)',
        }}
      />
    </div>
  );
});

ActionNode.displayName = 'ActionNode';
