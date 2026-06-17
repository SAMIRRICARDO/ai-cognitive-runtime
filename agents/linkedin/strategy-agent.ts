import { type ProfileContactState } from './profile-analyzer.js';
import { type LeadState } from './lead-state-machine.js';

export type ExecutionStrategy =
  | 'SEND_DIRECT_MESSAGE'     // enviar DM direta (1º grau)
  | 'SEND_CONNECTION_NOTE'    // enviar convite com nota (2º/3º grau)
  | 'SKIP_PENDING_INVITE'     // convite já enviado — aguardar aceite
  | 'SKIP_NO_CHANNEL'         // sem canal disponível (InMail Premium)
  | 'SKIP_ALREADY_HANDLED';   // estado terminal — já foi tratado

export interface StrategyDecision {
  strategy: ExecutionStrategy;
  reason: string;
  shouldLog: boolean;
}

// Mapa puro de estado → estratégia
// Separa a decisão da execução — permite testar sem Playwright
export function selectStrategy(
  profileState: ProfileContactState,
  leadState: LeadState
): StrategyDecision {
  // Estados terminais da SM têm prioridade sobre qualquer análise de perfil
  if (leadState === 'MESSAGE_SENT' || leadState === 'CLOSED') {
    return {
      strategy: 'SKIP_ALREADY_HANDLED',
      reason: `Estado terminal no SM: ${leadState}`,
      shouldLog: false,
    };
  }

  if (leadState === 'INVITATION_SENT' || leadState === 'WAITING_ACCEPTANCE') {
    return {
      strategy: 'SKIP_PENDING_INVITE',
      reason: 'Convite já enviado — aguardando aceite da conexão',
      shouldLog: false,
    };
  }

  if (leadState === 'FOLLOWUP_PENDING') {
    if (profileState === 'DIRECT_MESSAGE_AVAILABLE') {
      return {
        strategy: 'SEND_DIRECT_MESSAGE',
        reason: 'Follow-up: conexão aceita, enviando mensagem de acompanhamento',
        shouldLog: true,
      };
    }
    return {
      strategy: 'SKIP_PENDING_INVITE',
      reason: 'Follow-up pendente, mas canal direto ainda não disponível',
      shouldLog: false,
    };
  }

  // Lead novo — decide baseado no estado real do perfil
  switch (profileState) {
    case 'DIRECT_MESSAGE_AVAILABLE':
      return {
        strategy: 'SEND_DIRECT_MESSAGE',
        reason: '1º grau confirmado — canal de mensagem direta disponível',
        shouldLog: true,
      };

    case 'CONNECTION_REQUIRED':
      return {
        strategy: 'SEND_CONNECTION_NOTE',
        reason: '2º/3º grau — enviando convite com nota personalizada',
        shouldLog: true,
      };

    case 'INVITATION_SENT':
      return {
        strategy: 'SKIP_PENDING_INVITE',
        reason: 'Convite pendente detectado no perfil — aguardando aceite',
        shouldLog: true,
      };

    case 'NO_CHANNEL':
      return {
        strategy: 'SKIP_NO_CHANNEL',
        reason: 'Nenhum canal disponível — perfil requer InMail Premium',
        shouldLog: true,
      };
  }
}
