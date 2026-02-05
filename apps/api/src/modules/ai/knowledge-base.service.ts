// MultiWA Gateway - AI Knowledge Base Service
// apps/api/src/modules/ai/knowledge-base.service.ts

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { prisma } from '@multiwa/database';

const CHUNK_SIZE = 500; // characters per chunk
const CHUNK_OVERLAP = 50; // overlap between chunks

@Injectable()
export class KnowledgeBaseService {
  private readonly logger = new Logger(KnowledgeBaseService.name);

  /**
   * Upload and index a new document.
   */
  async uploadDocument(
    profileId: string,
    name: string,
    content: string,
    type: string,
  ): Promise<{ id: string; name: string; chunkCount: number }> {
    // Chunk the content
    const chunks = this.chunkText(content);

    // Create document and chunks in a transaction
    const doc = await prisma.knowledgeDocument.create({
      data: {
        profileId,
        name,
        type,
        size: Buffer.byteLength(content, 'utf-8'),
        chunkCount: chunks.length,
        chunks: {
          create: chunks.map((text, i) => ({
            content: text,
            position: i,
          })),
        },
      },
    });

    this.logger.log(`Indexed document "${name}" → ${chunks.length} chunks for profile ${profileId}`);
    return { id: doc.id, name: doc.name, chunkCount: chunks.length };
  }

  /**
   * List all documents for a profile.
   */
  async listDocuments(profileId: string) {
    return prisma.knowledgeDocument.findMany({
      where: { profileId },
      select: {
        id: true,
        name: true,
        type: true,
        size: true,
        chunkCount: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Delete a document and its chunks.
   */
  async deleteDocument(id: string): Promise<void> {
    const doc = await prisma.knowledgeDocument.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException('Document not found');

    await prisma.knowledgeDocument.delete({ where: { id } });
    this.logger.log(`Deleted document: ${doc.name}`);
  }

  /**
   * Search knowledge base using keyword matching (TF-IDF-lite).
   * Returns the most relevant chunks for a given query.
   */
  async search(
    profileId: string,
    query: string,
    maxResults: number = 5,
  ): Promise<{ documentName: string; content: string; score: number }[]> {
    // Get all chunks for this profile
    const chunks = await prisma.knowledgeChunk.findMany({
      where: {
        document: { profileId },
      },
      include: {
        document: { select: { name: true } },
      },
    });

    if (chunks.length === 0) return [];

    // Tokenize query
    const queryTokens = this.tokenize(query);
    if (queryTokens.length === 0) return [];

    // Score each chunk using simple TF-IDF-like relevance
    const scored = chunks.map((chunk) => {
      const chunkTokens = this.tokenize(chunk.content);
      let score = 0;

      for (const qt of queryTokens) {
        // Term frequency in this chunk
        const tf = chunkTokens.filter((t) => t === qt).length;
        // Inverse document frequency (how rare is this term across all chunks)
        const docsWithTerm = chunks.filter((c) =>
          this.tokenize(c.content).includes(qt)
        ).length;
        const idf = docsWithTerm > 0 ? Math.log(chunks.length / docsWithTerm) : 0;

        score += tf * idf;
      }

      return {
        documentName: chunk.document.name,
        content: chunk.content,
        score,
      };
    });

    // Sort by score and return top results
    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);
  }

  /**
   * Get context string for RAG-enhanced auto-reply.
   */
  async getRelevantContext(profileId: string, query: string): Promise<string> {
    const results = await this.search(profileId, query, 3);
    if (results.length === 0) return '';

    return results
      .map((r) => `[From: ${r.documentName}]\n${r.content}`)
      .join('\n\n---\n\n');
  }

  /**
   * Split text into overlapping chunks.
   */
  private chunkText(text: string): string[] {
    const chunks: string[] = [];
    const cleanText = text.replace(/\r\n/g, '\n').trim();

    if (cleanText.length <= CHUNK_SIZE) {
      return [cleanText];
    }

    let start = 0;
    while (start < cleanText.length) {
      let end = start + CHUNK_SIZE;

      // Try to break at a sentence boundary
      if (end < cleanText.length) {
        const lastPeriod = cleanText.lastIndexOf('.', end);
        const lastNewline = cleanText.lastIndexOf('\n', end);
        const breakPoint = Math.max(lastPeriod, lastNewline);
        if (breakPoint > start + CHUNK_SIZE * 0.5) {
          end = breakPoint + 1;
        }
      }

      chunks.push(cleanText.slice(start, end).trim());
      start = end - CHUNK_OVERLAP;
    }

    return chunks.filter((c) => c.length > 0);
  }

  /**
   * Simple tokenizer for keyword search.
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2); // ignore very short words
  }
}
