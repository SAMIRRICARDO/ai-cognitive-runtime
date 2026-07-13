// packages/work/src/agents/LearningAgent.ts
// Analisa lacunas de skills vs mercado e gera roadmap de estudos (Sonnet)

import Anthropic from '@anthropic-ai/sdk';
import { LearningRoadmap, SkillsMapItem } from '../types/index.js';
import { TwinStore } from '../twin/candidate-twin.js';
import { CareerMemory } from '../memory/career-memory.js';

export class LearningAgent {
  private client: Anthropic;

  constructor(
    private twinStore: TwinStore,
    private memory: CareerMemory,
    apiKey?: string,
  ) {
    this.client = new Anthropic({ apiKey });
  }

  // Mapa de habilidades: tenho vs mercado pede
  async buildSkillsMap(): Promise<SkillsMapItem[]> {
    const twin = this.twinStore.get();
    const marketKeywords = this.memory.getTopKeywords(30);
    const mySkills = new Set(
      [...twin.professional.stack, ...twin.professional.skills].map(s => s.toLowerCase().trim()),
    );

    return marketKeywords.map(kw => {
      const hasIt = mySkills.has(kw.keyword) || [...mySkills].some(s => s.includes(kw.keyword) || kw.keyword.includes(s));
      const priority = kw.aparicoes > 10 ? 'alta' : kw.aparicoes > 4 ? 'media' : 'baixa';
      return {
        skill: kw.keyword,
        hasIt,
        marketDemand: kw.aparicoes,
        priority: hasIt ? 'baixa' : priority,
        studyResource: this.getResource(kw.keyword),
      };
    });
  }

  async generateRoadmap(): Promise<LearningRoadmap> {
    const twin = this.twinStore.get();
    const skillsMap = await this.buildSkillsMap();
    const gaps = skillsMap.filter(s => !s.hasIt && s.priority !== 'baixa').slice(0, 15);

    const prompt = `Você é um tech mentor especialista em carreiras de engenharia de software.
Crie um roadmap de estudos personalizado e prático.

PERFIL DO CANDIDATO:
- ${twin.identity.name} — ${twin.professional.seniority} com ${twin.professional.yearsExp} anos
- Stack atual: ${twin.professional.stack.join(', ')}
- Estudando: ${twin.learning.studying.join(', ') || 'nada formalmente'}
- Objetivos: ${twin.learning.goals.slice(0, 3).join('; ') || 'não definidos'}

LACUNAS IDENTIFICADAS (mercado pede, candidato não tem):
${gaps.map(g => `- ${g.skill}: ${g.marketDemand} aparições nas vagas, prioridade ${g.priority}`).join('\n')}

Gere um roadmap realista. Retorne APENAS JSON:
{
  "immediate": ["<skill 1>", "<skill 2>"],
  "midTerm": ["<skill 3>", "<skill 4>"],
  "longTerm": ["<skill 5>"],
  "weeklyGoal": "<meta semanal concreta, ex: 2h React + 1 projeto>",
  "estimatedHoursTotal": <horas totais estimadas para cobrir lacunas imediatas>,
  "topGapByImpact": "<skill mais importante a aprender AGORA e por quê em 1 frase>"
}`;

    try {
      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
      const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());

      return {
        generatedAt: new Date().toISOString(),
        gaps,
        immediate:           parsed.immediate ?? [],
        midTerm:             parsed.midTerm ?? [],
        longTerm:            parsed.longTerm ?? [],
        weeklyGoal:          parsed.weeklyGoal ?? '',
        estimatedHoursTotal: parsed.estimatedHoursTotal ?? 40,
        topGapByImpact:      parsed.topGapByImpact ?? gaps[0]?.skill ?? 'Nenhuma lacuna crítica',
      };
    } catch (err) {
      console.error('[LearningAgent] Erro:', err);
      return {
        generatedAt: new Date().toISOString(),
        gaps,
        immediate:           gaps.filter(g => g.priority === 'alta').map(g => g.skill).slice(0, 3),
        midTerm:             gaps.filter(g => g.priority === 'media').map(g => g.skill).slice(0, 3),
        longTerm:            [],
        weeklyGoal:          'Defina 4h/semana de estudo focado na lacuna mais pedida pelo mercado.',
        estimatedHoursTotal: 80,
        topGapByImpact:      gaps[0]?.skill ?? 'Nenhuma lacuna crítica',
      };
    }
  }

  private getResource(skill: string): string {
    const resources: Record<string, string> = {
      kubernetes: 'kubernetes.io/docs + CKA cert',
      'machine learning': 'fast.ai + Coursera ML Specialization',
      python: 'realpython.com + projetos práticos',
      aws: 'AWS Skill Builder + SAA-C03 cert',
      azure: 'Microsoft Learn + AZ-900/AZ-204',
      docker: 'docs.docker.com + Play with Docker',
      golang: 'go.dev/tour + Go by Example',
      rust: 'rust-lang.org/book',
      graphql: 'graphql.org/learn + Apollo docs',
      kafka: 'kafka.apache.org/quickstart',
      terraform: 'developer.hashicorp.com/terraform',
      llm: 'deeplearning.ai + Anthropic Cookbook',
      react: 'react.dev + build 3 projetos reais',
      vue: 'vuejs.org/guide',
      angular: 'angular.dev',
    };
    const key = skill.toLowerCase();
    return resources[key] ?? `Pesquise "${skill} roadmap 2026" no roadmap.sh`;
  }
}
