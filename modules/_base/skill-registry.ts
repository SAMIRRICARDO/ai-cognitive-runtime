import fs from "node:fs";
import path from "node:path";

export interface Skill {
  id: string;
  name: string;
  description: string;
  content: string;
  prompt: string;
  tags: string[];
  module: string;
}

export class SkillRegistry {
  private skills: Map<string, Skill> = new Map();

  constructor(
    private readonly skillsDir: string,
    private readonly moduleName: string
  ) {}

  load(): void {
    if (!fs.existsSync(this.skillsDir)) return;
    const files = fs.readdirSync(this.skillsDir).filter((f) => f.endsWith(".md"));
    for (const file of files) {
      const raw = fs.readFileSync(path.join(this.skillsDir, file), "utf8");
      const skill = this.parse(file, raw);
      if (skill) this.skills.set(skill.id, skill);
    }
  }

  private parse(filename: string, raw: string): Skill | null {
    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) return null;

    const fm = fmMatch[1];
    const name = fm.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? filename.replace(".md", "");
    const description = fm.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? "";

    // Extract prompt block inside ```...```
    const promptMatch = raw.match(/## O Prompt\s*```(?:\w*\n)?([\s\S]*?)```/);
    const prompt = promptMatch?.[1]?.trim() ?? "";

    const tagsRaw = raw.match(/\*\*Tags:\*\*\s*(.+)/)?.[1] ?? "";
    const tags = tagsRaw.split("|").map((t) => t.trim()).filter(Boolean);

    return {
      id: filename.replace(".md", ""),
      name,
      description,
      content: raw,
      prompt,
      tags,
      module: this.moduleName,
    };
  }

  getAll(): Skill[] {
    return Array.from(this.skills.values());
  }

  getById(id: string): Skill | undefined {
    return this.skills.get(id);
  }

  // Keyword search — no embeddings needed for skill discovery
  search(query: string, limit = 8): Skill[] {
    const q = query.toLowerCase();
    return this.getAll()
      .map((s) => ({ skill: s, score: this.score(s, q) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((r) => r.skill);
  }

  private score(skill: Skill, query: string): number {
    let n = 0;
    const words = query.split(/\s+/);
    const name = skill.name.toLowerCase();
    const desc = skill.description.toLowerCase();
    const tags = skill.tags.join(" ").toLowerCase();

    if (name.includes(query)) n += 12;
    if (desc.includes(query)) n += 6;
    if (tags.includes(query)) n += 4;

    for (const w of words) {
      if (name.includes(w)) n += 3;
      if (desc.includes(w)) n += 2;
      if (tags.includes(w)) n += 1;
    }
    return n;
  }

  count(): number {
    return this.skills.size;
  }

  toContext(limit = 30): string {
    return this.getAll()
      .slice(0, limit)
      .map((s) => `- id="${s.id}" | ${s.name}: ${s.description}`)
      .join("\n");
  }

  toFullContext(): string {
    return this.getAll()
      .map((s) => `- id="${s.id}" | ${s.name}: ${s.description}`)
      .join("\n");
  }
}
