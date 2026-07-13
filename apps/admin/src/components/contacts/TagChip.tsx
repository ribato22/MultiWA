'use client';

import { X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { getTagBadgeStyle } from '@/lib/contact-tags';
import { cn } from '@/lib/utils';

export interface TagChipProps {
  tag: string;
  color?: string;
  onRemove?: (tag: string) => void;
  className?: string;
}

export function TagChip({ tag, color, onRemove, className }: TagChipProps) {
  const colorMap = color ? { [tag]: color } : {};
  const style = getTagBadgeStyle(tag, colorMap);

  return (
    <Badge
      variant="secondary"
      className={cn('text-xs border gap-1 pe-1', className)}
      style={style}
    >
      <span>{tag}</span>
      {onRemove && (
        <button
          type="button"
          onClick={() => onRemove(tag)}
          className="rounded-sm hover:bg-black/10 p-0.5"
          aria-label={`Remove ${tag}`}
        >
          <X className="w-3 h-3" aria-hidden />
        </button>
      )}
    </Badge>
  );
}
