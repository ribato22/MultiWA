// MultiWA Admin - Template Picker Component
// apps/admin/src/components/templates/TemplatePicker.tsx

'use client';

import { useState, useEffect } from 'react';
import {
  FileText,
  X,
  Loader2,
  Search,
  ArrowRight,
} from 'lucide-react';
import { formatDate, formatTime } from '@/lib/datetime';

interface Template {
  id: string;
  profileId: string;
  name: string;
  category?: string;
  messageType: string;
  content: any;
  variables?: string[];
  usageCount: number;
  createdAt: string;
}

interface TemplatePickerProps {
  profileId: string;
  onSelect: (template: Template, processedContent: string) => void;
  onClose: () => void;
  variables?: Record<string, string>; // e.g., { name: 'John', phone: '6281234' }
}

export default function TemplatePicker({ profileId, onSelect, onClose, variables }: TemplatePickerProps) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  useEffect(() => {
    fetchTemplates();
  }, [profileId]);

  const fetchTemplates = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('accessToken');
      const res = await fetch(`/api/v1/templates?profileId=${profileId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data.templates || data.data || []);
        setTemplates(list);
      }
    } catch (error) {
      console.error('Failed to fetch templates:', error);
    } finally {
      setLoading(false);
    }
  };

  // Process template variables
  const processTemplate = (template: Template): string => {
    let text = template.content?.text || template.content?.body || template.name;

    // Build complete variables map with system defaults
    const now = new Date();
    const allVariables: Record<string, string> = {
      date: formatDate(now),
      time: formatTime(now),
      ...variables, // User-provided variables (name, phone, etc.) override defaults
    };

    // Replace ALL {{variable}} patterns with known values
    text = text.replace(/\{\{(\w+)\}\}/g, (match: string, varName: string) => {
      return allVariables[varName] ?? match;
    });

    return text;
  };

  // Get unique categories
  const categories = ['all', ...new Set(templates.map(t => t.category || 'uncategorized'))];

  // Filter templates
  const filtered = templates.filter(t => {
    const matchesSearch = t.name.toLowerCase().includes(search.toLowerCase()) ||
      (t.content?.text || '').toLowerCase().includes(search.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || (t.category || 'uncategorized') === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4"
      role="dialog"
      aria-label="Template picker"
      aria-modal="true"
    >
      <div className="bg-card rounded-2xl shadow-2xl shadow-black/50 w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden border border-border">
        {/* Header */}
        <div className="p-5 border-b border-border">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-semibold text-foreground inline-flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary" aria-hidden="true" />
              Use Template
            </h3>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close template picker"
              className="p-1 hover:bg-secondary/60 text-muted-foreground hover:text-foreground rounded-lg transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>

          {/* Search */}
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              type="text"
              placeholder="Search templates..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-border bg-secondary/40 text-foreground placeholder:text-muted-foreground/60 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/60"
              aria-label="Search templates"
            />
          </div>

          {/* Category Filter */}
          {categories.length > 2 && (
            <div className="flex gap-2 mt-3 flex-wrap" role="group" aria-label="Filter by category">
              {categories.map(cat => {
                const active = selectedCategory === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedCategory(cat)}
                    aria-pressed={active}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/40 ${
                      active
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-secondary/60 text-muted-foreground hover:bg-secondary/80 hover:text-foreground'
                    }`}
                  >
                    {cat === 'all' ? 'All' : cat.charAt(0).toUpperCase() + cat.slice(1)}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Template List */}
        <div className="flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
              <Loader2 className="w-5 h-5 mw-spin text-primary" aria-hidden="true" />
              <span className="text-sm">Loading templates...</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary/60">
                <FileText className="w-6 h-6 opacity-60" aria-hidden="true" />
              </div>
              <p className="font-medium text-foreground">No templates found</p>
              <p className="text-sm mt-1">
                {templates.length === 0
                  ? 'Create templates in the Templates page first'
                  : 'Try a different search term'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map(template => {
                const preview = processTemplate(template);
                return (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => onSelect(template, preview)}
                    className="w-full text-left p-4 rounded-xl border border-border bg-secondary/30 hover:border-primary/40 hover:bg-primary/5 transition-all group cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/40"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-foreground group-hover:text-primary transition-colors truncate">
                          {template.name}
                        </p>
                        {template.category && (
                          <span className="inline-block px-2 py-0.5 rounded-full bg-secondary/60 border border-border/60 text-xs text-muted-foreground mt-1">
                            {template.category}
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap ml-2 tabular-nums">
                        Used {template.usageCount}×
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
                      {preview}
                    </p>
                    {template.variables && template.variables.length > 0 && (
                      <div className="flex gap-1 mt-2 flex-wrap">
                        {template.variables.map(v => (
                          <span
                            key={v}
                            className="px-2 py-0.5 rounded bg-sky-500/15 text-sky-300 text-xs font-mono border border-sky-500/30"
                          >
                            {`{{${v}}}`}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border text-center">
          <a
            href="/dashboard/templates"
            className="inline-flex items-center gap-1 text-sm text-primary hover:text-primary/80 font-medium"
          >
            Manage Templates
            <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </a>
        </div>
      </div>
    </div>
  );
}
