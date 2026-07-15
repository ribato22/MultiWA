'use client';

import { Palette } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n/provider';
import { cn } from '@/lib/utils';

export interface ColorFilterProps {
  colors: string[];
  value: string | null;
  onChange: (color: string | null) => void;
  className?: string;
}

export function ColorFilter({ colors, value, onChange, className }: ColorFilterProps) {
  const { t } = useI18n();

  if (colors.length === 0) return null;

  return (
    <div
      className={cn('flex gap-2 flex-wrap items-center', className)}
      data-testid="color-filter"
      role="group"
      aria-label={t('contacts.colorFilter.label')}
    >
      <span className="text-muted-foreground text-xs flex items-center gap-1 px-1">
        <Palette className="w-3 h-3" aria-hidden />
        {t('contacts.colorFilterLabel')}
      </span>
      <Button
        variant={value === null ? 'default' : 'outline'}
        size="sm"
        onClick={() => onChange(null)}
      >
        {t('contacts.colorFilterAny')}
      </Button>
      {colors.map(color => (
        <Button
          key={color}
          variant={value === color ? 'default' : 'outline'}
          size="sm"
          className="gap-2"
          onClick={() => onChange(value === color ? null : color)}
          aria-label={`${t('contacts.colorFilter.label')} ${color}`}
        >
          <span
            className="w-3 h-3 rounded-full border border-border"
            style={{ backgroundColor: color }}
            aria-hidden
          />
        </Button>
      ))}
    </div>
  );
}
