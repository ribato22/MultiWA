'use client';

import React from 'react';
import { PlayCircle, Zap, Settings as SettingsIcon, Timer, Lightbulb, type LucideIcon } from 'lucide-react';

type NodeItem = {
  type: string;
  label: string;
  Icon: LucideIcon;
  color: string;
  tone: string;
  description: string;
};

const nodeItems: NodeItem[] = [
  {
    type: 'trigger',
    label: 'Trigger',
    Icon: PlayCircle,
    color: '#22c55e',
    tone: 'text-primary',
    description: 'Start of automation flow',
  },
  {
    type: 'condition',
    label: 'Condition',
    Icon: Zap,
    color: '#f59e0b',
    tone: 'text-amber-300',
    description: 'Branch based on conditions',
  },
  {
    type: 'action',
    label: 'Action',
    Icon: SettingsIcon,
    color: '#818cf8',
    tone: 'text-indigo-300',
    description: 'Perform an action',
  },
  {
    type: 'delay',
    label: 'Delay',
    Icon: Timer,
    color: '#94a3b8',
    tone: 'text-muted-foreground',
    description: 'Wait before next step',
  },
];

export const NodePalette: React.FC = () => {
  const onDragStart = (event: React.DragEvent, nodeType: string) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="w-52 p-4 bg-card border-r border-border overflow-y-auto">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
        Node Types
      </h3>

      <div className="flex flex-col gap-2">
        {nodeItems.map((item) => {
          const Icon = item.Icon;
          return (
            <div
              key={item.type}
              draggable
              onDragStart={(e) => onDragStart(e, item.type)}
              role="button"
              aria-label={`Drag ${item.label} node onto canvas`}
              tabIndex={0}
              className="group p-3 bg-secondary/30 hover:bg-secondary/60 rounded-lg border border-border hover:border-primary/40 cursor-grab active:cursor-grabbing transition-all focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <div className="flex items-center gap-2.5">
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-lg bg-card border border-border/60 ${item.tone}`}
                >
                  <Icon className="w-4 h-4" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <div className={`text-sm font-semibold ${item.tone}`}>
                    {item.label}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {item.description}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-6 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-[11px] text-amber-300">
        <div className="inline-flex items-center gap-1.5 font-medium mb-1">
          <Lightbulb className="w-3 h-3" aria-hidden="true" />
          Tip
        </div>
        <p className="text-amber-200/90">
          Drag nodes onto the canvas to build your automation flow.
        </p>
      </div>
    </div>
  );
};
