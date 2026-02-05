// MultiWA Admin - Template Picker Component
// apps/admin/src/components/templates/TemplatePicker.tsx

'use client';

import { useState, useEffect } from 'react';

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
      date: now.toLocaleDateString('id-ID'),
      time: now.toLocaleTimeString('id-ID'),
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
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden border border-gray-200 dark:border-gray-700">
        {/* Header */}
        <div className="p-5 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              📋 Use Template
            </h3>
            <button
              onClick={onClose}
              className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
            >
              <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Search */}
          <input
            type="text"
            placeholder="Search templates..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
          />

          {/* Category Filter */}
          {categories.length > 2 && (
            <div className="flex gap-2 mt-3 flex-wrap">
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                    selectedCategory === cat
                      ? 'bg-emerald-500 text-white'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                  }`}
                >
                  {cat === 'all' ? 'All' : cat.charAt(0).toUpperCase() + cat.slice(1)}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Template List */}
        <div className="flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <p className="text-3xl mb-2">📝</p>
              <p className="font-medium">No templates found</p>
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
                    onClick={() => onSelect(template, preview)}
                    className="w-full text-left p-4 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-emerald-500/50 hover:bg-emerald-50/50 dark:hover:bg-emerald-900/10 transition-all group"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 dark:text-white group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                          {template.name}
                        </p>
                        {template.category && (
                          <span className="inline-block px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-xs text-gray-500 mt-1">
                            {template.category}
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-gray-400 whitespace-nowrap ml-2">
                        Used {template.usageCount}×
                      </span>
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 line-clamp-2">
                      {preview}
                    </p>
                    {template.variables && template.variables.length > 0 && (
                      <div className="flex gap-1 mt-2 flex-wrap">
                        {template.variables.map(v => (
                          <span key={v} className="px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-xs font-mono">
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
        <div className="p-4 border-t border-gray-200 dark:border-gray-700 text-center">
          <a
            href="/dashboard/templates"
            className="text-sm text-emerald-600 hover:text-emerald-500 font-medium"
          >
            Manage Templates →
          </a>
        </div>
      </div>
    </div>
  );
}
