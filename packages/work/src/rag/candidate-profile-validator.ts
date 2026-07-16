// packages/work/src/rag/candidate-profile-validator.ts
// Pre-boot validation: schema fields, type constraints, and cross-fact consistency.

import type { CandidateProfile } from './candidate-profile-types.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export class CandidateProfileValidator {
  validate(profile: CandidateProfile): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Required top-level fields
    if (!profile.candidateId) errors.push('Missing candidateId');
    if (typeof profile.profileVersion !== 'number') errors.push('profileVersion must be a number');
    if (!profile.updatedAt) errors.push('Missing updatedAt');

    // candidateFacts field validation
    for (const [key, fact] of Object.entries(profile.candidateFacts ?? {})) {
      if (typeof fact.value !== 'boolean')
        errors.push(`candidateFacts.${key}.value must be boolean`);
      if (!Array.isArray(fact.triggers) || fact.triggers.length === 0)
        errors.push(`candidateFacts.${key}.triggers must be a non-empty array`);
      if (typeof fact.confidence !== 'number' || fact.confidence < 0 || fact.confidence > 100)
        errors.push(`candidateFacts.${key}.confidence must be 0–100`);
    }

    // skills field validation
    for (const [key, skill] of Object.entries(profile.skills ?? {})) {
      if (typeof skill.hasExperience !== 'boolean')
        errors.push(`skills.${key}.hasExperience must be boolean`);
      if (typeof skill.expertiseLevel !== 'number' || skill.expertiseLevel < 1 || skill.expertiseLevel > 10)
        errors.push(`skills.${key}.expertiseLevel must be 1–10`);
      if (typeof skill.years !== 'number' || skill.years < 0)
        errors.push(`skills.${key}.years must be >= 0`);
    }

    this.runConsistencyChecks(profile, warnings);

    return { valid: errors.length === 0, errors, warnings };
  }

  private runConsistencyChecks(profile: CandidateProfile, warnings: string[]): void {
    const facts = profile.candidateFacts ?? {};
    const skills = profile.skills ?? {};

    // productionRAG=true → rag skill must exist and have production=true
    if (facts['productionRAG']?.value === true) {
      if (!skills['rag'])
        warnings.push('productionRAG=true but no rag skill entry found');
      else if (!skills['rag'].production)
        warnings.push('productionRAG=true but skills.rag.production=false — inconsistent');
    }

    // productionLLM=true → llm_orchestration skill must exist
    if (facts['productionLLM']?.value === true) {
      if (!skills['llm_orchestration'])
        warnings.push('productionLLM=true but no llm_orchestration skill found');
    }

    // agentsAI=true → multi_agent_systems skill must exist
    if (facts['agentsAI']?.value === true) {
      if (!skills['multi_agent_systems'])
        warnings.push('agentsAI=true but no multi_agent_systems skill found');
    }

    // Skills with long experience should have reasonable expertise
    for (const [key, skill] of Object.entries(skills)) {
      if (skill.hasExperience && skill.years > 3 && skill.expertiseLevel < 5)
        warnings.push(`skills.${key}: ${skill.years} years but expertiseLevel=${skill.expertiseLevel} — review`);
    }

    // Negative facts should have low confidence
    for (const [key, fact] of Object.entries(facts)) {
      if (!fact.value && fact.confidence > 50)
        warnings.push(`candidateFacts.${key}: value=false but confidence=${fact.confidence} — should be ≤50 for negatives`);
    }
  }
}
