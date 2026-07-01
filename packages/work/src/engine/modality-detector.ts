// packages/work/src/engine/modality-detector.ts
// CPU-only — zero chamadas de API. Detecta modalidade e elegibilidade geográfica.

import { Job } from '../types/index.js';

export type Modality = 'REMOTO' | 'HÍBRIDO' | 'PRESENCIAL' | 'DESCONHECIDO';

export interface ModalityResult {
  modality: Modality;
  detectedCity: string | null;
  isEligible: boolean;
  needsReview: boolean;
  reason: string;
}

// ─── Normalização ─────────────────────────────────────────────────────────────

function norm(s: string): string {
  return (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// ─── Padrões de modalidade ────────────────────────────────────────────────────

const RX_REMOTO = /\bremot[ao]\b|home.?office|homeoffice|100%.?remot|fully.?remote|work.?from.?home|anywhere|todo.*brasil|qualquer.*lugar/;
const RX_HIBRIDO = /\bhibrido\b|\bhybrid\b|modelo.?misto|formato.?misto|trabalho.?flex|flex.?work|semi.?presencial/;
const RX_PRESENCIAL = /\bpresencial\b|on.?site\b|onsite\b|in.?office|no.?escritorio|em.?escritorio|presenca.?obrig/;

// ─── Cidades da Grande São Paulo (normalizadas) ───────────────────────────────

const SP_CITIES: string[] = [
  'sao paulo',
  'guarulhos',
  'santo andre',
  'sao bernardo do campo',
  'sao bernardo',
  'sao caetano do sul',
  'sao caetano',
  'diadema',
  'maua',
  'ribeirao pires',
  'rio grande da serra',
  'osasco',
  'carapicuiba',
  'barueri',
  'santana de parnaiba',
  'cotia',
  'itapevi',
  'jandira',
  'alphaville',
  'taboao da serra',
  'embu das artes',
  'embu',
  'mogi das cruzes',
  'mogi',
  'suzano',
  'ferraz de vasconcelos',
  'ferraz',
  'itaquaquecetuba',
  'cacapava',
  // Expressões regionais LinkedIn
  'sao paulo e regiao',
  'grande sao paulo',
  'abc paulista',
  'regiao metropolitana de sao paulo',
  'metropolitan area of sao paulo',
];

// São José dos Campos — avaliar caso a caso
const SJC_RX = /\bsao jose dos campos\b|\bsjc\b/;

// Regiões fora de SP — lista conservadora (só bloqueia quando explícito)
const NON_SP_RX = /\brio de janeiro\b|\brj\b|\bbelo horizonte\b|\bporto alegre\b|\bcuritiba\b|\brecife\b|\bfortaleza\b|\bsalvador\b|\bmanaus\b|\bgoiania\b|\bflorianopolis\b|\bbrasilia\b|\bdf\b|\bcampinas\b|\bribeirao preto\b|\bsorocaba\b|\bsao jose do rio preto\b|\buberlandia\b|\bbelem\b|\bpa\b|\bnatal\b|\bmaceio\b|\bjoao pessoa\b|\bteresina\b|\bcampo grande\b|\bcuiaba\b|\bporto velho\b|\bmacapa\b|\bboa vista\b|\bpalmas\b|\baracaju\b/;

// ─── Detecção de cidade ───────────────────────────────────────────────────────

interface CityInfo {
  inSP: boolean;
  isSJC: boolean;
  knownOutside: boolean;
  city: string | null;
}

function detectCity(text: string): CityInfo {
  // São José dos Campos primeiro (antes de "sao" casar com "sao paulo")
  if (SJC_RX.test(text)) {
    return { inSP: false, isSJC: true, knownOutside: false, city: 'São José dos Campos' };
  }

  // Cidades fora de SP
  if (NON_SP_RX.test(text)) {
    const m = text.match(NON_SP_RX);
    return { inSP: false, isSJC: false, knownOutside: true, city: m?.[0] ?? null };
  }

  // Grande SP (ordena por comprimento decrescente para evitar match parcial)
  const sorted = [...SP_CITIES].sort((a, b) => b.length - a.length);
  for (const city of sorted) {
    if (text.includes(city)) {
      return { inSP: true, isSJC: false, knownOutside: false, city };
    }
  }

  // Poá — ambíguo com POA (Porto Alegre). Aceita só com contexto SP.
  if (/\bpoa\b/.test(text) && (text.includes(', sp') || text.includes('sao paulo'))) {
    return { inSP: true, isSJC: false, knownOutside: false, city: 'Poá' };
  }

  return { inSP: false, isSJC: false, knownOutside: false, city: null };
}

// ─── Detecção de modalidade ───────────────────────────────────────────────────

function detectModality(locNorm: string, titleNorm: string, descNorm: string): Modality {
  // 1. Campo location — sinal mais confiável
  if (RX_REMOTO.test(locNorm))     return 'REMOTO';
  if (RX_HIBRIDO.test(locNorm))    return 'HÍBRIDO';
  if (RX_PRESENCIAL.test(locNorm)) return 'PRESENCIAL';

  // 2. Título
  if (RX_REMOTO.test(titleNorm))     return 'REMOTO';
  if (RX_HIBRIDO.test(titleNorm))    return 'HÍBRIDO';
  if (RX_PRESENCIAL.test(titleNorm)) return 'PRESENCIAL';

  // 3. Início da descrição (primeiros 600 chars — menos ruído)
  const head = descNorm.slice(0, 600);
  if (RX_REMOTO.test(head))     return 'REMOTO';
  if (RX_HIBRIDO.test(head))    return 'HÍBRIDO';
  if (RX_PRESENCIAL.test(head)) return 'PRESENCIAL';

  return 'DESCONHECIDO';
}

// ─── ModalityDetector ─────────────────────────────────────────────────────────

export class ModalityDetector {
  evaluate(job: Pick<Job, 'title' | 'location' | 'description'>): ModalityResult {
    const locNorm   = norm(job.location);
    const titleNorm = norm(job.title);
    const descNorm  = norm(job.description);

    const modality = detectModality(locNorm, titleNorm, descNorm);

    // Para cidade, analisamos location + título (não descrição — muito ruído)
    const cityInfo = detectCity(locNorm + ' ' + titleNorm);

    // ── Regras de elegibilidade ───────────────────────────────────────────────

    if (modality === 'REMOTO') {
      return {
        modality, detectedCity: cityInfo.city,
        isEligible: true, needsReview: false,
        reason: 'Modalidade remota — elegível sem restrição geográfica',
      };
    }

    if (modality === 'HÍBRIDO' || modality === 'PRESENCIAL') {
      if (cityInfo.inSP) {
        return {
          modality, detectedCity: cityInfo.city,
          isEligible: true, needsReview: false,
          reason: `${modality} em Grande SP (${cityInfo.city ?? 'São Paulo'}) — elegível`,
        };
      }

      if (cityInfo.isSJC) {
        return {
          modality, detectedCity: 'São José dos Campos',
          isEligible: true, needsReview: true,
          reason: `${modality} em São José dos Campos — avaliar caso a caso`,
        };
      }

      if (cityInfo.knownOutside) {
        return {
          modality, detectedCity: cityInfo.city,
          isEligible: false, needsReview: false,
          reason: `${modality} fora de SP (${cityInfo.city}) — não elegível geograficamente`,
        };
      }

      // Localização não identificada → incluir para revisão (não perder vagas SP)
      return {
        modality, detectedCity: null,
        isEligible: true, needsReview: true,
        reason: `${modality} — localização não identificada, incluir para revisão manual`,
      };
    }

    // DESCONHECIDO — deixa Haiku decidir
    return {
      modality: 'DESCONHECIDO', detectedCity: cityInfo.city,
      isEligible: true, needsReview: true,
      reason: 'Modalidade não identificada — incluir para revisão',
    };
  }
}

// ─── Exemplos de teste inline (use com npx tsx) ───────────────────────────────
// const d = new ModalityDetector();
// console.log(d.evaluate({ title: 'AI Architect', location: 'São Paulo, SP', description: 'Cargo 100% presencial no escritório da Av. Paulista.' }));
// → { modality: 'PRESENCIAL', detectedCity: 'sao paulo', isEligible: true, needsReview: false, reason: 'PRESENCIAL em Grande SP (sao paulo) — elegível' }
//
// console.log(d.evaluate({ title: 'Senior AI Engineer (Remote)', location: 'Brasil', description: 'Trabalho 100% remoto.' }));
// → { modality: 'REMOTO', ..., isEligible: true }
//
// console.log(d.evaluate({ title: 'Tech Lead', location: 'Rio de Janeiro, RJ', description: 'Cargo presencial no Rio.' }));
// → { modality: 'PRESENCIAL', detectedCity: 'rio de janeiro', isEligible: false, reason: 'PRESENCIAL fora de SP (rio de janeiro) — não elegível geograficamente' }
