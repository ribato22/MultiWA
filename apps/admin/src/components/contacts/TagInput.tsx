'use client';

import { useCallback, useMemo, useState, type KeyboardEvent } from 'react';

import { Input } from '@/components/ui/input';
import { TagChip } from '@/components/contacts/TagChip';
import { useI18n } from '@/lib/i18n/provider';
import { cn } from '@/lib/utils';

export interface TagInputProps {
  tags: string[];
  tagColors?: Record<string, string>;
  suggestions?: string[];
  onChange: (tags: string[], tagColors: Record<string, string>) => void;
  className?: string;
}

export function TagInput({
  tags,
  tagColors = {},
  suggestions = [],
  onChange,
  className,
}: TagInputProps) {
  const { t } = useI18n();
  const [input, setInput] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);

  const filteredSuggestions = useMemo(() => {
    const q = input.trim().toLowerCase();
    if (!q) return [];
    return suggestions
      .filter(s => s.toLowerCase().includes(q) && !tags.includes(s))
      .slice(0, 8);
  }, [input, suggestions, tags]);

  const addTag = useCallback(
    (raw: string) => {
      const value = raw.trim().replace(/^#/, '');
      if (!value || tags.includes(value)) return;

      const colon = value.indexOf(':');
      const nextColors = { ...tagColors };
      let tagName = value;

      if (colon > 0) {
        const name = value.slice(0, colon).trim();
        const color = value.slice(colon + 1).trim();
        if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color)) {
          tagName = name;
          nextColors[name] = color;
        }
      }

      if (!tagName || tags.includes(tagName)) return;
      onChange([...tags, tagName], nextColors);
      setInput('');
      setShowSuggestions(false);
    },
    [onChange, tagColors, tags],
  );

  const removeTag = useCallback(
    (tag: string) => {
      const nextColors = { ...tagColors };
      delete nextColors[tag];
      onChange(
        tags.filter(t => t !== tag),
        nextColors,
      );
    },
    [onChange, tagColors, tags],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(input);
    } else if (e.key === 'Backspace' && !input && tags.length > 0) {
      removeTag(tags[tags.length - 1]);
    }
  };

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex flex-wrap gap-1.5">
        {tags.map(tag => (
          <TagChip
            key={tag}
            tag={tag}
            color={tagColors[tag]}
            onRemove={removeTag}
          />
        ))}
      </div>
      <div className="relative">
        <Input
          data-testid="tag-input"
          value={input}
          onChange={e => {
            setInput(e.target.value);
            setShowSuggestions(true);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
          onFocus={() => setShowSuggestions(true)}
          placeholder={t('contacts.tagInput.placeholder')}
          aria-label={t('contacts.tags')}
        />
        {showSuggestions && filteredSuggestions.length > 0 && (
          <ul
            className="absolute z-10 mt-1 w-full rounded-lg border border-border bg-card shadow-astryx-md py-1"
            role="listbox"
          >
            {filteredSuggestions.map(s => (
              <li key={s}>
                <button
                  type="button"
                  className="w-full px-3 py-1.5 text-start text-sm hover:bg-secondary/60"
                  onMouseDown={e => {
                    e.preventDefault();
                    addTag(s);
                  }}
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        )}
        {showSuggestions && input && filteredSuggestions.length === 0 && (
          <p className="absolute z-10 mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground shadow-astryx-sm">
            {t('contacts.tagInput.noSuggestions')}
          </p>
        )}
      </div>
    </div>
  );
}
