'use client';

import { useI18n } from '@/lib/i18n/provider';
import { cn } from '@/lib/utils';

export const PRESET_COLORS = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#64748b',
  '#f8fafc',
] as const;

export interface ColorPickerProps {
  value?: string | null;
  onChange: (color: string | null) => void;
  className?: string;
}

export function ColorPicker({ value, onChange, className }: ColorPickerProps) {
  const { t } = useI18n();

  return (
    <div className={cn('space-y-2', className)} data-testid="color-picker">
      <span className="text-sm font-medium">{t('contacts.colorPicker.label')}</span>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('contacts.colorPicker.label')}>
        <button
          type="button"
          role="radio"
          aria-checked={!value}
          onClick={() => onChange(null)}
          className={cn(
            'h-8 px-3 rounded-lg border text-xs transition-colors',
            !value ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-secondary/50',
          )}
        >
          {t('contacts.colorPicker.none')}
        </button>
        {PRESET_COLORS.map(color => (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={value === color}
            aria-label={color}
            onClick={() => onChange(color)}
            className={cn(
              'w-8 h-8 rounded-full border-2 transition-transform hover:scale-110',
              value === color ? 'border-primary ring-2 ring-primary/40' : 'border-border',
            )}
            style={{ backgroundColor: color }}
          />
        ))}
      </div>
    </div>
  );
}
