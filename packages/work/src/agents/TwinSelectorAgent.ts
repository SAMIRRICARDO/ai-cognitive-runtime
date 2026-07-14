// packages/work/src/agents/TwinSelectorAgent.ts
// Selects the best Professional Twin for a given job — uses Haiku (fast, cheap).

import Anthropic from '@anthropic-ai/sdk';
import type { Job } from '../types/index.js';
import type { ProfessionalTwin, TwinId } from '../types/hire-intelligence.js';

export interface TwinCompatibility {
  twinId: TwinId;
  score: number;        // 0–100
  reason: string;
}

export interface TwinSelectionResult {
  selectedTwin: ProfessionalTwin;
  confidence: number;   // 0–100: how confident the selector is
  allScores: TwinCompatibility[];
  reasoning: string;
}

export class TwinSelectorAgent {
  private client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic({ apiKey });
  }

  async select(job: Job, twins: ProfessionalTwin[]): Promise<TwinSelectionResult> {
    if (!twins.length) throw new Error('No active twins available for selection');
    if (twins.length === 1) {
      return {
        selectedTwin: twins[0],
        confidence: 100,
        allScores: [{ twinId: twins[0].id, score: 100, reason: 'Only twin available' }],
        reasoning: 'Single active twin — no selection needed.',
      };
    }

    const twinsDesc = twins.map(t =>
      `ID: ${t.id}\nLabel: ${t.label}\nTarget roles: ${t.targetRoles.slice(0, 4).join(', ')}\nKeywords: ${t.atsKeywords.slice(0, 8).join(', ')}`
    ).join('\n\n');

    const prompt = `You are selecting the best candidate profile (Twin) for a job.

JOB:
Title: ${job.title}
Company: ${job.company}
Description: ${job.description.slice(0, 1500)}

AVAILABLE TWINS:
${twinsDesc}

Score each twin from 0-100 based on how well the job title, required skills, and description match each twin's target roles and keywords.

Return ONLY this JSON (no extra text):
{
  "selected_twin_id": "<id>",
  "confidence": <0-100>,
  "reasoning": "<1 sentence>",
  "all_scores": [{"twin_id":"<id>","score":<0-100>,"reason":"<short phrase>"}]
}`;

    try {
      const response = await this.client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
      const raw = text.replace(/```json|```/g, '').trim();
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : '{}');

      const selectedId: TwinId = parsed.selected_twin_id;
      const selectedTwin = twins.find(t => t.id === selectedId) ?? twins[0];

      const allScores: TwinCompatibility[] = (parsed.all_scores ?? []).map((s: { twin_id: TwinId; score: number; reason: string }) => ({
        twinId: s.twin_id,
        score: Math.min(100, Math.max(0, Number(s.score) || 0)),
        reason: s.reason ?? '',
      }));

      // Fill in any missing twins with score 0
      for (const twin of twins) {
        if (!allScores.some(s => s.twinId === twin.id)) {
          allScores.push({ twinId: twin.id, score: 0, reason: 'Not scored' });
        }
      }

      return {
        selectedTwin,
        confidence: Math.min(100, Math.max(0, Number(parsed.confidence) || 70)),
        allScores,
        reasoning: parsed.reasoning ?? `Selected ${selectedTwin.label} for ${job.title}`,
      };
    } catch {
      // Fallback: pick the twin whose keywords overlap most with job description + title
      const desc = `${job.title} ${job.description}`.toLowerCase();
      const scored = twins.map(t => {
        const hits = t.atsKeywords.filter(k => desc.includes(k.toLowerCase())).length;
        return { twin: t, hits };
      }).sort((a, b) => b.hits - a.hits);

      const best = scored[0].twin;
      return {
        selectedTwin: best,
        confidence: 50,
        allScores: scored.map(s => ({ twinId: s.twin.id, score: Math.min(100, s.hits * 8), reason: `${s.hits} keyword matches` })),
        reasoning: `Keyword-based fallback — selected ${best.label}`,
      };
    }
  }
}
