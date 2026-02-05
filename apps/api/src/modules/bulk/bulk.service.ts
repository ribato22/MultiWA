// MultiWA Gateway - Bulk Messaging Service
// apps/api/src/modules/bulk/bulk.service.ts

import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { SendBulkDto, BulkBatchStatus, BulkMessageType, BulkMessageContent } from './dto';
import { EngineManagerService } from '../profiles/engine-manager.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class BulkService {
  private readonly logger = new Logger(BulkService.name);
  
  // In-memory batch storage (in production, use Redis)
  private batches: Map<string, BulkBatchStatus> = new Map();
  private batchProfiles: Map<string, string> = new Map(); // batchId -> profileId

  constructor(
    private readonly engineManager: EngineManagerService,
  ) {}

  /**
   * Substitute variables in text using {variable} syntax
   */
  private substituteVariables(text: string, variables: Record<string, string>): string {
    if (!variables || !text) return text;
    
    let result = text;
    for (const [key, value] of Object.entries(variables)) {
      result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
    }
    return result;
  }

  /**
   * Process content with variable substitution
   */
  private processContent(content: BulkMessageContent, variables?: Record<string, string>): BulkMessageContent {
    const processed: BulkMessageContent = { ...content };
    
    if (content.text && variables) {
      processed.text = this.substituteVariables(content.text, variables);
    }
    if (content.caption && variables) {
      processed.caption = this.substituteVariables(content.caption, variables);
    }
    
    return processed;
  }

  /**
   * Send bulk messages with variable substitution
   */
  async sendBulk(dto: SendBulkDto): Promise<{ 
    batchId: string; 
    status: string; 
    totalMessages: number;
    estimatedCompletionTime: Date;
    statusUrl: string;
  }> {
    const engine = await this.engineManager.getEngine(dto.profileId);
    if (!engine) {
      throw new NotFoundException(`Profile ${dto.profileId} not found or not connected`);
    }

    const batchId = dto.batchId || `batch_${uuidv4().substring(0, 12)}`;
    const options = {
      delayBetweenMessages: dto.options?.delayBetweenMessages || 3000,
      randomizeDelay: dto.options?.randomizeDelay !== false,
      stopOnError: dto.options?.stopOnError || false,
    };

    // Calculate estimated completion time
    const totalDelay = dto.messages.length * options.delayBetweenMessages;
    const estimatedCompletionTime = new Date(Date.now() + totalDelay);

    // Initialize batch status
    const batchStatus: BulkBatchStatus = {
      batchId,
      status: 'queued',
      progress: {
        total: dto.messages.length,
        sent: 0,
        failed: 0,
        pending: dto.messages.length,
        cancelled: 0,
      },
      results: dto.messages.map((m) => ({
        chatId: m.chatId,
        status: 'pending' as const,
      })),
      estimatedCompletionTime,
    };

    this.batches.set(batchId, batchStatus);
    this.batchProfiles.set(batchId, dto.profileId);

    // Process messages in background
    this.processBatch(batchId, dto.profileId, dto.messages, options);

    return {
      batchId,
      status: 'processing',
      totalMessages: dto.messages.length,
      estimatedCompletionTime,
      statusUrl: `/api/bulk/batch/${batchId}`,
    };
  }

  /**
   * Process batch messages asynchronously
   */
  private async processBatch(
    batchId: string,
    profileId: string,
    messages: SendBulkDto['messages'],
    options: { delayBetweenMessages: number; randomizeDelay: boolean; stopOnError: boolean },
  ): Promise<void> {
    const batch = this.batches.get(batchId);
    if (!batch) return;

    batch.status = 'processing';
    batch.startedAt = new Date();

    const engine = await this.engineManager.getEngine(profileId);
    if (!engine) {
      batch.status = 'failed';
      return;
    }

    for (let i = 0; i < messages.length; i++) {
      // Check if batch was cancelled
      const currentBatch = this.batches.get(batchId);
      if (!currentBatch || currentBatch.status === 'cancelled') {
        break;
      }

      const msg = messages[i];
      const processedContent = this.processContent(msg.content, msg.variables);

      try {
        let result: { messageId?: string };

        switch (msg.type) {
          case BulkMessageType.TEXT:
            result = await engine.sendText(msg.chatId, processedContent.text || '');
            break;
          case BulkMessageType.IMAGE:
            result = await engine.sendImage(msg.chatId, { url: processedContent.url, caption: processedContent.caption });
            break;
          case BulkMessageType.VIDEO:
            result = await engine.sendVideo(msg.chatId, { url: processedContent.url, caption: processedContent.caption });
            break;
          case BulkMessageType.AUDIO:
            result = await engine.sendAudio(msg.chatId, { url: processedContent.url });
            break;
          case BulkMessageType.DOCUMENT:
            result = await engine.sendDocument(msg.chatId, { url: processedContent.url, filename: processedContent.filename || 'document' });
            break;
          default:
            throw new Error(`Unknown message type: ${msg.type}`);
        }

        // Update batch status
        batch.progress.sent++;
        batch.progress.pending--;
        if (batch.results && batch.results[i]) {
          batch.results[i].status = 'sent';
          batch.results[i].messageId = result.messageId;
        }
      } catch (error) {
        this.logger.error(`Bulk send error for ${msg.chatId}: ${error.message}`);
        
        batch.progress.failed++;
        batch.progress.pending--;
        if (batch.results && batch.results[i]) {
          batch.results[i].status = 'failed';
          batch.results[i].error = {
            code: 'SEND_FAILED',
            message: error.message,
          };
        }

        if (options.stopOnError) {
          // Mark remaining as cancelled
          for (let j = i + 1; j < messages.length; j++) {
            batch.progress.cancelled++;
            batch.progress.pending--;
            if (batch.results && batch.results[j]) {
              batch.results[j].status = 'cancelled';
            }
          }
          batch.status = 'failed';
          batch.completedAt = new Date();
          return;
        }
      }

      // Apply delay between messages (except for last message)
      if (i < messages.length - 1) {
        let delay = options.delayBetweenMessages;
        if (options.randomizeDelay) {
          delay += Math.random() * 2000; // Add random 0-2s
        }
        await this.sleep(delay);
      }
    }

    batch.status = 'completed';
    batch.completedAt = new Date();
  }

  /**
   * Get batch status
   */
  async getBatchStatus(batchId: string, profileId: string): Promise<BulkBatchStatus> {
    const registeredProfileId = this.batchProfiles.get(batchId);
    if (!registeredProfileId || registeredProfileId !== profileId) {
      throw new NotFoundException(`Batch ${batchId} not found for this profile`);
    }

    const batch = this.batches.get(batchId);
    if (!batch) {
      throw new NotFoundException(`Batch ${batchId} not found`);
    }

    return batch;
  }

  /**
   * Cancel a batch in progress
   */
  async cancelBatch(batchId: string, profileId: string): Promise<BulkBatchStatus> {
    const registeredProfileId = this.batchProfiles.get(batchId);
    if (!registeredProfileId || registeredProfileId !== profileId) {
      throw new NotFoundException(`Batch ${batchId} not found for this profile`);
    }

    const batch = this.batches.get(batchId);
    if (!batch) {
      throw new NotFoundException(`Batch ${batchId} not found`);
    }

    if (batch.status === 'completed' || batch.status === 'cancelled') {
      throw new BadRequestException(`Batch ${batchId} is already ${batch.status}`);
    }

    // Mark as cancelled
    batch.status = 'cancelled';
    batch.completedAt = new Date();

    // Mark remaining pending as cancelled
    if (batch.results) {
      for (const result of batch.results) {
        if (result.status === 'pending') {
          result.status = 'cancelled';
          batch.progress.cancelled++;
          batch.progress.pending--;
        }
      }
    }

    return batch;
  }

  /**
   * List all batches for a profile
   */
  async listBatches(profileId: string): Promise<Omit<BulkBatchStatus, 'results'>[]> {
    const batches: Omit<BulkBatchStatus, 'results'>[] = [];
    
    for (const [batchId, batch] of this.batches.entries()) {
      if (this.batchProfiles.get(batchId) === profileId) {
        const { results, ...batchSummary } = batch;
        batches.push(batchSummary);
      }
    }

    return batches;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
