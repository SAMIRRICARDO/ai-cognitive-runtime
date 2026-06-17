import { getTenantManager } from './manager.js'
import { logger } from '../config/logger.js'
import type { TenantEnv, TenantPlan, TenantRecord } from './types.js'

export interface ProvisionOptions {
  id: string
  name: string
  plan?: TenantPlan
  modules?: string[]
  keys: TenantEnv
}

export async function provisionTenant(opts: ProvisionOptions): Promise<TenantRecord> {
  const manager = getTenantManager()

  const existing = await manager.getById(opts.id)
  if (existing) throw new Error(`Tenant '${opts.id}' already exists`)

  const record = await manager.create(opts)

  logger.info('[provisioner] tenant ready', {
    id: record.id,
    name: record.name,
    plan: record.plan,
    modules: record.modules,
  })

  return record
}
