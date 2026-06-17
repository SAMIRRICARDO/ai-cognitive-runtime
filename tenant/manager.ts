import crypto from 'crypto'
import pg from 'pg'
import { env } from '../config/env.js'
import { TenantKeyVault } from './key-vault.js'
import { logger } from '../config/logger.js'
import type { TenantConfig, TenantEnv, TenantPlan, TenantRecord } from './types.js'

export class TenantManager {
  private pool: pg.Pool
  private vault: TenantKeyVault

  constructor() {
    if (!env.DATABASE_URL) throw new Error('DATABASE_URL required for TenantManager')
    this.pool = new pg.Pool({ connectionString: env.DATABASE_URL })
    this.vault = new TenantKeyVault(this.pool)
  }

  async create(opts: {
    id: string
    name: string
    plan?: TenantPlan
    modules?: string[]
    keys: TenantEnv
  }): Promise<TenantRecord> {
    const apiKey = 'vrx_' + crypto.randomBytes(24).toString('hex')
    const plan = opts.plan ?? 'starter'
    const modules = opts.modules ?? []

    await this.pool.query(
      `INSERT INTO tenants (id, name, plan, modules, api_key)
       VALUES ($1, $2, $3, $4, $5)`,
      [opts.id, opts.name, plan, modules, apiKey]
    )

    await this.vault.saveKeys(opts.id, opts.keys)
    logger.info('[tenant-manager] created', { id: opts.id, plan })

    return {
      id: opts.id,
      name: opts.name,
      plan,
      modules,
      active: true,
      apiKey,
      createdAt: new Date().toISOString(),
    }
  }

  async getByApiKey(apiKey: string): Promise<TenantConfig | null> {
    const { rows } = await this.pool.query<{
      id: string; name: string; plan: TenantPlan
      modules: string[]; active: boolean; created_at: string
    }>(
      `SELECT id, name, plan, modules, active, created_at
       FROM tenants WHERE api_key = $1 AND active = true`,
      [apiKey]
    )
    const row = rows[0]
    if (!row) return null
    return { id: row.id, name: row.name, plan: row.plan, modules: row.modules, active: row.active, createdAt: row.created_at }
  }

  async getById(tenantId: string): Promise<TenantConfig | null> {
    const { rows } = await this.pool.query<{
      id: string; name: string; plan: TenantPlan
      modules: string[]; active: boolean; created_at: string
    }>(
      `SELECT id, name, plan, modules, active, created_at
       FROM tenants WHERE id = $1`,
      [tenantId]
    )
    const row = rows[0]
    if (!row) return null
    return { id: row.id, name: row.name, plan: row.plan, modules: row.modules, active: row.active, createdAt: row.created_at }
  }

  async getKeys(tenantId: string): Promise<TenantEnv | null> {
    return this.vault.getKeys(tenantId)
  }

  async updateKeys(tenantId: string, keys: TenantEnv): Promise<void> {
    await this.vault.saveKeys(tenantId, keys)
    logger.info('[tenant-manager] keys updated', { id: tenantId })
  }

  async activateModule(tenantId: string, moduleId: string): Promise<void> {
    await this.pool.query(
      `UPDATE tenants
       SET modules = array_append(modules, $2), updated_at = NOW()
       WHERE id = $1 AND NOT ($2 = ANY(modules))`,
      [tenantId, moduleId]
    )
    logger.info('[tenant-manager] module activated', { tenantId, moduleId })
  }

  async deactivateModule(tenantId: string, moduleId: string): Promise<void> {
    await this.pool.query(
      `UPDATE tenants SET modules = array_remove(modules, $2), updated_at = NOW() WHERE id = $1`,
      [tenantId, moduleId]
    )
    logger.info('[tenant-manager] module deactivated', { tenantId, moduleId })
  }

  async deactivate(tenantId: string): Promise<void> {
    await this.pool.query(`UPDATE tenants SET active = false, updated_at = NOW() WHERE id = $1`, [tenantId])
    logger.info('[tenant-manager] tenant deactivated', { id: tenantId })
  }

  async list(): Promise<TenantConfig[]> {
    const { rows } = await this.pool.query<{
      id: string; name: string; plan: TenantPlan
      modules: string[]; active: boolean; created_at: string
    }>(`SELECT id, name, plan, modules, active, created_at FROM tenants ORDER BY created_at DESC`)
    return rows.map(r => ({ id: r.id, name: r.name, plan: r.plan, modules: r.modules, active: r.active, createdAt: r.created_at }))
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}

let _instance: TenantManager | null = null

export function getTenantManager(): TenantManager {
  if (!_instance) _instance = new TenantManager()
  return _instance
}
