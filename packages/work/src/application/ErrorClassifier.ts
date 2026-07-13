// packages/work/src/application/ErrorClassifier.ts
// Classifica automaticamente erros de candidatura e gera Root Cause Analysis.

import { ErrorCategory, ApplicationError, ApplicationState } from './types.js';

interface ErrorPattern {
  pattern: RegExp;
  category: ErrorCategory;
  rca: string;
  recommendation: string;
  retryable: boolean;
}

const ERROR_PATTERNS: ErrorPattern[] = [
  // Login / sessão
  {
    pattern: /login|auth|401|403|unauthorized|session.*expired|cookie|credential/i,
    category: 'LOGIN_ERROR',
    rca: 'Sessão expirada ou credenciais inválidas. O cookie de autenticação pode ter sido invalidado pela plataforma.',
    recommendation: 'Executar `npm run session:renew` para renovar a sessão. Verificar .linkedin-profile/.',
    retryable: false,
  },
  // CAPTCHA / anti-bot
  {
    pattern: /captcha|recaptcha|challenge|bot.*detected|suspicious.*activity|verify.*human|cloudflare/i,
    category: 'CAPTCHA_ERROR',
    rca: 'Plataforma detectou comportamento automatizado. Rate de requests ou padrão de navegação acima do normal.',
    recommendation: 'Aguardar 30-60 minutos. Aumentar delays aleatórios em anti-detection.ts. Verificar USER_AGENT.',
    retryable: false,
  },
  // Rate limit
  {
    pattern: /rate.*limit|too.*many.*request|429|throttl/i,
    category: 'RATE_LIMIT_ERROR',
    rca: 'Limite de requisições atingido na plataforma. Muitas candidaturas em um curto período.',
    recommendation: 'Reduzir maxApplicationsPerRun. Aumentar delay entre candidaturas. Aguardar 1-2h.',
    retryable: false,
  },
  // Timeout
  {
    pattern: /timeout|timed.*out|navigation.*timeout|exceeded.*time|waitFor/i,
    category: 'TIMEOUT_ERROR',
    rca: 'Operação excedeu o timeout configurado. Pode ser lentidão da plataforma, conexão lenta ou elemento DOM não carregou.',
    recommendation: 'Verificar latência da rede. Aumentar timeouts no PlaywrightConfig. Verificar se plataforma está sob manutenção.',
    retryable: true,
  },
  // DOM
  {
    pattern: /element.*not.*found|locator.*resolve|strict.*mode|not.*visible|detached|no.*element/i,
    category: 'DOM_ERROR',
    rca: 'Elemento DOM não encontrado ou removido. Plataforma pode ter alterado sua estrutura HTML (AB test, deploy).',
    recommendation: 'Inspecionar screenshot de erro. Atualizar seletores no LinkedInApplyEngine ou motor ATS correspondente.',
    retryable: true,
  },
  // Upload
  {
    pattern: /upload|file.*input|setInputFiles|resume|pdf.*invalid|file.*size/i,
    category: 'UPLOAD_ERROR',
    rca: 'Falha no upload do currículo. Arquivo pode não ser encontrado, estar corrompido ou o campo de upload mudou.',
    recommendation: 'Verificar se RESUME_PATH existe e é um PDF válido. Verificar tamanho (max 5MB). Recriar PDF se necessário.',
    retryable: true,
  },
  // Submit
  {
    pattern: /submit|enviar.*candidatura|already.*applied|já.*candidatou/i,
    category: 'SUBMIT_ERROR',
    rca: 'Falha na etapa de submit do formulário. Botão não encontrado, formulário inválido ou candidatura duplicada.',
    recommendation: 'Verificar screenshot de submit. Se "already applied", a candidatura pode já ter sido enviada com sucesso.',
    retryable: false,
  },
  // ATS externo
  {
    pattern: /greenhouse|lever|workday|icims|taleo|brassring|ats.*error|external.*ats/i,
    category: 'ATS_ERROR',
    rca: 'Erro no sistema ATS externo da empresa. Pode ser timeout, mudança de versão ou campo obrigatório não preenchido.',
    recommendation: 'Verificar trace do Greenhouse/Lever. Pode requerer intervenção manual. Checar se empresa mudou ATS.',
    retryable: true,
  },
  // Navegação
  {
    pattern: /navigation|goto|ERR_|net::ERR|SSL|certificate|redirect.*external|page.*crash/i,
    category: 'NAVIGATION_ERROR',
    rca: 'Falha de navegação no browser. Pode ser erro de rede, SSL, URL inválida ou redirect inesperado.',
    recommendation: 'Verificar conectividade. Inspecionar URL no trace.json. Verificar se LinkedIn está acessível.',
    retryable: true,
  },
  // LLM
  {
    pattern: /anthropic|openai|api.*key|llm.*error|model.*error|token.*limit|context.*length/i,
    category: 'LLM_ERROR',
    rca: 'Erro na chamada ao LLM. Pode ser API key inválida, quota esgotada ou prompt muito longo.',
    recommendation: 'Verificar ANTHROPIC_API_KEY em .env. Verificar saldo na Anthropic Console. Checar max_tokens.',
    retryable: false,
  },
  // OAuth / Token
  {
    pattern: /oauth|access.*token|refresh.*token|bearer|jwt|forbidden/i,
    category: 'OAUTH_ERROR',
    rca: 'Falha de autenticação OAuth. Token de acesso expirado ou revogado.',
    recommendation: 'Renovar tokens de autenticação. Executar fluxo de login manualmente.',
    retryable: false,
  },
  // Banco de dados
  {
    pattern: /sqlite|database|db.*error|sql.*error|SQLITE_BUSY|SQLITE_CORRUPT/i,
    category: 'DATABASE_ERROR',
    rca: 'Erro no banco de dados SQLite. Pode ser corrupção, lock ou disco cheio.',
    recommendation: 'Verificar work.db. Em caso de corrupção, restaurar do backup. Verificar espaço em disco.',
    retryable: false,
  },
  // API
  {
    pattern: /500|502|503|504|server.*error|internal.*error|service.*unavailable/i,
    category: 'API_ERROR',
    rca: 'Erro interno na plataforma (5xx). Servidor da plataforma com problemas temporários.',
    recommendation: 'Aguardar 15-30 minutos e tentar novamente. Verificar status page da plataforma.',
    retryable: true,
  },
];

export class ErrorClassifier {
  classify(
    errorMessage: string,
    state: ApplicationState = 'failed',
    context?: Record<string, unknown>,
  ): ApplicationError {
    const matched = ERROR_PATTERNS.find(p => p.pattern.test(errorMessage));

    if (matched) {
      return {
        category:       matched.category,
        message:        errorMessage.slice(0, 500),
        rca:            matched.rca,
        recommendation: matched.recommendation,
        retryable:      matched.retryable,
        state,
        timestamp:      new Date().toISOString(),
      };
    }

    // Fallback — analisa pelo estado em que ocorreu
    const stateBasedRca = this.rcaFromState(state);

    return {
      category:       'UNKNOWN_ERROR',
      message:        errorMessage.slice(0, 500),
      rca:            stateBasedRca.rca,
      recommendation: stateBasedRca.recommendation,
      retryable:      stateBasedRca.retryable,
      state,
      timestamp:      new Date().toISOString(),
    };
  }

  private rcaFromState(state: ApplicationState): { rca: string; recommendation: string; retryable: boolean } {
    switch (state) {
      case 'opening_job':
        return {
          rca: 'Falha ao carregar a página da vaga. Vaga pode ter sido removida ou URL inválida.',
          recommendation: 'Verificar se a vaga ainda existe no LinkedIn. Checar conectividade.',
          retryable: true,
        };
      case 'opening_easy_apply':
        return {
          rca: 'Modal Easy Apply não abriu. Vaga pode ter mudado para "External Apply" ou LinkedIn alterou o DOM.',
          recommendation: 'Inspecionar screenshot. Verificar se vaga ainda está com Easy Apply ativo.',
          retryable: false,
        };
      case 'filling_questions':
        return {
          rca: 'Erro ao preencher perguntas do formulário. Campo desconhecido ou tipo não suportado.',
          recommendation: 'Revisar questionnaire-log para identificar o campo problemático. Atualizar KB se necessário.',
          retryable: true,
        };
      case 'submitting':
        return {
          rca: 'Erro no momento do submit. Formulário pode ter campos obrigatórios não preenchidos.',
          recommendation: 'Revisar screenshot de submit. Verificar se todos os campos obrigatórios foram respondidos.',
          retryable: false,
        };
      default:
        return {
          rca: `Erro não classificado no estado '${state}'. Verificar trace.json para detalhes.',`,
          recommendation: 'Inspecionar logs em .vraxia-work/logs/application_<id>/trace.json.',
          retryable: false,
        };
    }
  }

  /** Gera estatísticas de erro de uma lista de erros classificados. */
  static summarize(errors: ApplicationError[]): Record<ErrorCategory, number> {
    const counts = {} as Record<ErrorCategory, number>;
    for (const e of errors) {
      counts[e.category] = (counts[e.category] ?? 0) + 1;
    }
    return counts;
  }
}
