import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { MOCK_TRANSCRIPTION_RESULT } from '@/mock/mock-data';

export interface TranscriptionLine {
  timestamp: string;
  speaker: string;
  text: string;
}

export interface CanonicalLine extends TranscriptionLine {}

export interface FlaggedSegment {
  start: string;
  end: string;
  text: string;
  reason: string;
}

export interface AiAnalysisResult {
  /** Suspicion score 0–100. >= 60 triggers flagged_ai status. */
  aiScore: number;
  transcriptionLines: TranscriptionLine[];
  canonicalLines: CanonicalLine[];
  flaggedSegments: FlaggedSegment[];
  canonicalAnalysis: Record<string, unknown>;
}

/**
 * Wraps OpenAI Whisper (transcription) and GPT-4o (canonical analysis + flagging).
 *
 * Set `USE_MOCK_AI=true` in `.env` to skip real API calls and return canned mock
 * data — useful for local development without internet access or API keys.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly client: OpenAI | null;
  private readonly useMockAi: boolean;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    this.useMockAi = this.config.get<string>('USE_MOCK_AI') === 'true' || !apiKey;

    if (!this.useMockAi && apiKey) {
      this.client = new OpenAI({ apiKey });
      this.logger.log('AI backend: OpenAI (Whisper + GPT-4o)');
    } else {
      this.client = null;
      this.logger.log('AI backend: mock (no OPENAI_API_KEY or USE_MOCK_AI=true)');
    }
  }

  /**
   * Transcribe an audio buffer with Whisper and then analyse with GPT-4o.
   * @param audioBuffer  PCM/MP3/WAV audio bytes (extracted from the video)
   * @param filename     Filename hint for OpenAI (determines codec)
   */
  async analyse(audioBuffer: Buffer, filename = 'audio.mp3'): Promise<AiAnalysisResult> {
    if (this.useMockAi || !this.client) {
      return this.mockResult();
    }

    // ── 1. Whisper transcription ──────────────────────────────────────────
    this.logger.log('Calling Whisper for transcription…');
    const file = new File([audioBuffer.buffer.slice(audioBuffer.byteOffset, audioBuffer.byteOffset + audioBuffer.byteLength) as ArrayBuffer], filename, { type: 'audio/mpeg' });
    const whisperResp = await this.client.audio.transcriptions.create({
      model: 'whisper-1',
      file,
      response_format: 'verbose_json',
      timestamp_granularities: ['segment'],
    });

    const rawText = whisperResp.text;

    // ── 2. GPT-4o canonical analysis + flagging ────────────────────────────
    this.logger.log('Calling GPT-4o for canonical analysis…');
    const systemPrompt = `
Você é um sistema de análise de segurança penitenciária.
Receberá a transcrição bruta de uma visita em parlatório.
Responda APENAS com JSON no formato exato abaixo:
{
  "aiScore": <0-100>,
  "transcriptionLines": [{"timestamp":"MM:SS","speaker":"Visitante|Detento","text":"..."}],
  "canonicalLines":     [{"timestamp":"MM:SS","speaker":"Visitante|Detento","text":"texto normalizado"}],
  "flaggedSegments":    [{"start":"MM:SS","end":"MM:SS","text":"trecho suspeito","reason":"motivo"}],
  "canonicalAnalysis": {
    "summary": "resumo",
    "riskLevel": "baixo|médio|alto",
    "topics": ["topic1"],
    "entities": []
  }
}
Retorne flaggedSegments vazio se não houver indícios suspeitos.
aiScore deve refletir o nível de suspeita (0 = sem suspeita, 100 = altamente suspeito).
`.trim();

    const completion = await this.client.chat.completions.create({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Transcrição bruta:\n\n${rawText}` },
      ],
    });

    const content = completion.choices[0]?.message.content ?? '{}';
    try {
      return JSON.parse(content) as AiAnalysisResult;
    } catch {
      this.logger.error('Failed to parse GPT-4o response as JSON');
      return this.mockResult();
    }
  }

  // ─── Mock ──────────────────────────────────────────────────────────────────

  private mockResult(): AiAnalysisResult {
    const mock = MOCK_TRANSCRIPTION_RESULT;
    return {
      aiScore: 78,
      transcriptionLines: mock.lines as TranscriptionLine[],
      canonicalLines: mock.canonicalLines as CanonicalLine[],
      flaggedSegments: mock.flaggedSegments as FlaggedSegment[],
      canonicalAnalysis: mock.canonicalAnalysis,
    };
  }
}
