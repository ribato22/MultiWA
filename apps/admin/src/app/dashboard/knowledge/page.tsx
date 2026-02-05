// MultiWA Admin - AI Knowledge Base Page
// apps/admin/src/app/dashboard/knowledge/page.tsx

'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { api, Profile } from '@/lib/api';

interface KnowledgeDoc {
  id: string;
  name: string;
  type: string;
  size: number;
  chunkCount: number;
  createdAt: string;
}

interface SearchResult {
  documentName: string;
  content: string;
  score: number;
}

export default function KnowledgePage() {
  const { toast } = useToast();

  // State
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState('');
  const [documents, setDocuments] = useState<KnowledgeDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [docsLoading, setDocsLoading] = useState(false);

  // Add document
  const [showAdd, setShowAdd] = useState(false);
  const [docName, setDocName] = useState('');
  const [docContent, setDocContent] = useState('');
  const [addingDoc, setAddingDoc] = useState(false);

  // Search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  // Delete confirm
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    loadProfiles();
  }, []);

  useEffect(() => {
    if (selectedProfile) {
      loadDocuments();
    }
  }, [selectedProfile]);

  const loadProfiles = async () => {
    try {
      const { data } = await api.getProfiles();
      setProfiles(data || []);
      if (data?.length) setSelectedProfile(data[0].id);
    } catch {
      toast({ title: 'Error', description: 'Failed to load profiles', variant: 'destructive' });
    }
    setLoading(false);
  };

  const loadDocuments = async () => {
    setDocsLoading(true);
    try {
      const { data } = await api.listKnowledgeDocuments(selectedProfile);
      setDocuments(data || []);
    } catch {
      setDocuments([]);
    }
    setDocsLoading(false);
  };

  const handleAddDocument = async () => {
    if (!docName.trim() || !docContent.trim()) {
      toast({ title: 'Validation', description: 'Please provide a name and content', variant: 'destructive' });
      return;
    }
    setAddingDoc(true);
    try {
      const { data } = await api.addKnowledgeDocument(selectedProfile, docName.trim(), docContent.trim());
      toast({
        title: '✅ Document Added',
        description: `"${data?.name}" processed into ${data?.chunkCount} chunks`,
      });
      setDocName('');
      setDocContent('');
      setShowAdd(false);
      loadDocuments();
    } catch {
      toast({ title: 'Error', description: 'Failed to add document', variant: 'destructive' });
    }
    setAddingDoc(false);
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteKnowledgeDocument(id);
      toast({ title: '🗑️ Deleted', description: 'Document removed from knowledge base' });
      setDocuments(prev => prev.filter(d => d.id !== id));
      setDeletingId(null);
    } catch {
      toast({ title: 'Error', description: 'Failed to delete document', variant: 'destructive' });
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const { data } = await api.searchKnowledgeBase(selectedProfile, searchQuery.trim());
      setSearchResults(data || []);
      if (!data?.length) {
        toast({ title: 'No Results', description: 'No matching documents found for your query' });
      }
    } catch {
      toast({ title: 'Error', description: 'Search failed', variant: 'destructive' });
    }
    setSearching(false);
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (loading) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-secondary rounded-lg w-56" />
          <div className="h-4 bg-secondary rounded w-80" />
          <div className="h-12 bg-secondary rounded-xl w-64" />
          <div className="h-64 bg-secondary rounded-2xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
          <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white text-lg">🧠</span>
          AI Knowledge Base
        </h1>
        <p className="text-muted-foreground mt-1">
          Upload documents to train context-aware AI responses per profile
        </p>
      </div>

      {/* Profile Selector */}
      <div className="flex items-center gap-4">
        <label className="text-sm font-medium text-foreground whitespace-nowrap">Profile:</label>
        <select
          value={selectedProfile}
          onChange={e => setSelectedProfile(e.target.value)}
          className="w-full max-w-xs rounded-xl border border-border bg-background px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
        >
          {profiles.map(p => (
            <option key={p.id} value={p.id}>{p.name} {p.phone ? `(${p.phone})` : ''}</option>
          ))}
        </select>
        <Button onClick={() => setShowAdd(true)} className="bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white ml-auto">
          + Add Document
        </Button>
      </div>

      {/* Add Document Dialog */}
      {showAdd && (
        <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <span>📄</span> Add Knowledge Document
            </h3>
            <button onClick={() => setShowAdd(false)} className="text-muted-foreground hover:text-foreground text-xl">×</button>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">Document Name</label>
            <Input
              value={docName}
              onChange={e => setDocName(e.target.value)}
              placeholder="e.g., FAQ, Product Catalog, Company Info"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">Content</label>
            <textarea
              value={docContent}
              onChange={e => setDocContent(e.target.value)}
              placeholder="Paste your knowledge text here...&#10;&#10;The text will be automatically split into searchable chunks."
              className="w-full h-40 rounded-xl border border-border bg-background px-4 py-3 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
            />
            <p className="text-xs text-muted-foreground mt-1">{docContent.length.toLocaleString()} characters</p>
          </div>
          <div className="flex gap-3">
            <Button onClick={handleAddDocument} disabled={addingDoc || !docName.trim() || !docContent.trim()} className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white">
              {addingDoc ? 'Processing...' : '✅ Add Document'}
            </Button>
            <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Documents Table */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">
            Documents ({documents.length})
          </h3>
          <button onClick={loadDocuments} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            🔄 Refresh
          </button>
        </div>
        {docsLoading ? (
          <div className="p-8 text-center text-muted-foreground animate-pulse">Loading documents...</div>
        ) : documents.length === 0 ? (
          <div className="p-12 text-center">
            <div className="text-4xl mb-3">📚</div>
            <p className="text-muted-foreground text-sm">No documents yet</p>
            <p className="text-xs text-muted-foreground mt-1">Add your first document to start building the knowledge base</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/30">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Name</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Type</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Size</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Chunks</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Created</th>
                  <th className="text-center px-4 py-3 font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {documents.map(doc => (
                  <tr key={doc.id} className="border-b border-border/50 hover:bg-secondary/20 transition-colors">
                    <td className="px-4 py-3 font-medium text-foreground">{doc.name}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 uppercase">
                        {doc.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground font-mono text-xs">{formatSize(doc.size)}</td>
                    <td className="px-4 py-3 text-right">
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
                        {doc.chunkCount}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{new Date(doc.createdAt).toLocaleDateString()}</td>
                    <td className="px-4 py-3 text-center">
                      {deletingId === doc.id ? (
                        <div className="flex items-center justify-center gap-2">
                          <button onClick={() => handleDelete(doc.id)} className="text-xs text-red-500 hover:text-red-600 font-medium">Confirm</button>
                          <button onClick={() => setDeletingId(null)} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
                        </div>
                      ) : (
                        <button onClick={() => setDeletingId(doc.id)} className="text-muted-foreground hover:text-red-500 transition-colors" title="Delete">
                          🗑️
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Search Section */}
      <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <span>🔍</span> Search Knowledge Base
        </h3>
        <div className="flex gap-3">
          <Input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Ask a question to search across all documents..."
            className="flex-1"
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
          />
          <Button onClick={handleSearch} disabled={searching || !searchQuery.trim()} variant="outline">
            {searching ? 'Searching...' : '🔍 Search'}
          </Button>
        </div>

        {/* Search Results */}
        {searchResults.length > 0 && (
          <div className="space-y-3 mt-4">
            <p className="text-xs text-muted-foreground">{searchResults.length} result(s) found</p>
            {searchResults.map((result, i) => (
              <div key={i} className="bg-secondary/30 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">{result.documentName}</span>
                  <span className="px-2 py-0.5 rounded-full text-xs font-mono font-medium bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
                    {(result.score * 100).toFixed(0)}% match
                  </span>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">{result.content}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
