export interface TenantEnv {
  ANTHROPIC_API_KEY: string
  OPENAI_API_KEY?: string
  TAVILY_API_KEY?: string
  RESEND_API_KEY?: string
  RESEND_FROM_EMAIL?: string
  RESEND_FROM_NAME?: string
  OUTBOUND_BCC_EMAIL?: string
}

export type TenantPlan = 'starter' | 'professional' | 'business' | 'enterprise'

export interface TenantConfig {
  id: string
  name: string
  plan: TenantPlan
  modules: string[]
  active: boolean
  createdAt: string
}

export interface TenantRecord extends TenantConfig {
  apiKey: string
}
