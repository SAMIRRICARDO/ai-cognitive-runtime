// packages/work/src/rag/skill-normalizer.ts
// Canonical alias resolution: maps raw skill names to normalized keys.
// Alias dictionary is loaded from candidate-profile.json normalizationAliases.

export class SkillNormalizer {
  private aliases: Map<string, string>;

  constructor(normalizationAliases: Record<string, string> = {}) {
    this.aliases = new Map(
      Object.entries(normalizationAliases).map(([k, v]) => [this.key(k), v]),
    );
  }

  // Returns canonical skill key for the given raw input.
  normalize(raw: string): string {
    const k = this.key(raw);
    return this.aliases.get(k) ?? k.replace(/[\s\-\.]+/g, '_');
  }

  private key(s: string): string {
    return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  }
}
