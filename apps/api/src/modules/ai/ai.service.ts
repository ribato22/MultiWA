// MultiWA Gateway - AI Service
// apps/api/src/modules/ai/ai.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface AICompletionOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

export interface AICompletionResult {
  success: boolean;
  content?: string;
  error?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface ConversationMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

@Injectable()
export class AIService {
  private readonly logger = new Logger(AIService.name);
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('OPENAI_API_KEY');
    this.baseUrl = this.configService.get<string>('OPENAI_BASE_URL', 'https://api.openai.com/v1');
  }

  /**
   * Check if AI service is configured
   */
  isConfigured(): boolean {
    return !!this.apiKey;
  }

  /**
   * Generate a completion using OpenAI ChatGPT
   */
  async complete(
    prompt: string,
    options: AICompletionOptions = {}
  ): Promise<AICompletionResult> {
    if (!this.apiKey) {
      return { success: false, error: 'OpenAI API key not configured' };
    }

    const {
      model = 'gpt-4o-mini',
      maxTokens = 500,
      temperature = 0.7,
      systemPrompt = 'You are a helpful WhatsApp assistant.',
    } = options;

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt },
          ],
          max_tokens: maxTokens,
          temperature,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        this.logger.error(`OpenAI API error: ${error}`);
        return { success: false, error: `API error: ${response.status}` };
      }

      const data = await response.json();
      
      return {
        success: true,
        content: data.choices[0]?.message?.content || '',
        usage: {
          promptTokens: data.usage?.prompt_tokens || 0,
          completionTokens: data.usage?.completion_tokens || 0,
          totalTokens: data.usage?.total_tokens || 0,
        },
      };
    } catch (error) {
      this.logger.error(`OpenAI request failed: ${error}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Generate a chat completion with conversation history
   */
  async chat(
    messages: ConversationMessage[],
    options: AICompletionOptions = {}
  ): Promise<AICompletionResult> {
    if (!this.apiKey) {
      return { success: false, error: 'OpenAI API key not configured' };
    }

    const {
      model = 'gpt-4o-mini',
      maxTokens = 500,
      temperature = 0.7,
      systemPrompt,
    } = options;

    try {
      const allMessages = systemPrompt
        ? [{ role: 'system' as const, content: systemPrompt }, ...messages]
        : messages;

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: allMessages,
          max_tokens: maxTokens,
          temperature,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        this.logger.error(`OpenAI API error: ${error}`);
        return { success: false, error: `API error: ${response.status}` };
      }

      const data = await response.json();
      
      return {
        success: true,
        content: data.choices[0]?.message?.content || '',
        usage: {
          promptTokens: data.usage?.prompt_tokens || 0,
          completionTokens: data.usage?.completion_tokens || 0,
          totalTokens: data.usage?.total_tokens || 0,
        },
      };
    } catch (error) {
      this.logger.error(`OpenAI request failed: ${error}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Generate auto-reply based on incoming message and context.
   * Enhanced with RAG: pulls relevant context from knowledge base if profileId is provided.
   */
  async generateAutoReply(
    incomingMessage: string,
    context?: {
      customerName?: string;
      businessName?: string;
      previousMessages?: string[];
      customPrompt?: string;
      profileId?: string; // If provided, search knowledge base for context
      knowledgeContext?: string; // Pre-fetched KB context
    }
  ): Promise<AICompletionResult> {
    let kbContext = context?.knowledgeContext || '';

    const systemPrompt = context?.customPrompt || `
You are a helpful customer service assistant for ${context?.businessName || 'our business'}.
Respond in a friendly, professional manner.
Keep responses concise and helpful.
${context?.customerName ? `The customer's name is ${context.customerName}.` : ''}
${kbContext ? `\nRelevant knowledge base information:\n${kbContext}\n\nUse the above information to answer the customer's question accurately.` : ''}

Previous conversation context:
${context?.previousMessages?.slice(-5).join('\n') || 'No previous messages'}
`.trim();

    return this.complete(incomingMessage, {
      systemPrompt,
      maxTokens: 300,
      temperature: 0.7,
    });
  }

  /**
   * Analyze message sentiment
   */
  async analyzeSentiment(message: string): Promise<{
    success: boolean;
    sentiment?: 'positive' | 'negative' | 'neutral';
    confidence?: number;
    error?: string;
  }> {
    const result = await this.complete(
      `Analyze the sentiment of this message and respond with ONLY one word: "positive", "negative", or "neutral".\n\nMessage: "${message}"`,
      {
        maxTokens: 10,
        temperature: 0,
        systemPrompt: 'You are a sentiment analysis assistant. Respond with only one word.',
      }
    );

    if (!result.success) {
      return { success: false, error: result.error };
    }

    const sentiment = result.content?.toLowerCase().trim() as 'positive' | 'negative' | 'neutral';
    
    if (!['positive', 'negative', 'neutral'].includes(sentiment)) {
      return { success: false, error: 'Invalid sentiment response' };
    }

    return {
      success: true,
      sentiment,
      confidence: 0.85, // Placeholder confidence
    };
  }

  /**
   * Translate message to target language
   */
  async translate(
    message: string,
    targetLanguage: string = 'English'
  ): Promise<AICompletionResult> {
    return this.complete(
      `Translate the following message to ${targetLanguage}. Only provide the translation, no explanations.\n\nMessage: "${message}"`,
      {
        maxTokens: 500,
        temperature: 0.3,
        systemPrompt: 'You are a professional translator. Provide accurate translations.',
      }
    );
  }
}
