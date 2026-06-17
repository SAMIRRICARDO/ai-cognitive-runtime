import crypto from 'crypto'
import pg from 'pg'
import { env } from '../config/env.js'
import type { TenantEnv } from './types.js'

const ALGORITHM = 'aes-256-gcm' as const

function deriveKey(): Buffer {
  return crypto.createHash('sha256').update(env.VRAXIA_MASTER_KEY!).digest()
}

function encrypt(text: string): string {
  const key = deriveKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`
}

function decrypt(encoded: string): string {
  const key = deriveKey()
  const parts = encoded.split(':')
  if (parts.length !== 3) throw new Error('Invalid encrypted value format')
  const [ivHex, tagHex, encHex] = parts
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  const dec = decipher.update(Buffer.from(encHex, 'hex'))
  return Buffer.concat([dec, decipher.final()]).toString('utf8')
}

export class TenantKeyVault {
  constructor(private pool: pg.Pool) {}

  async saveKeys(tenantId: string, keys: TenantEnv): Promise<void> {
    await this.pool.query(
      `UPDATE tenants SET
         anthropic_key_enc  = $2,
         openai_key_enc     = $3,
         tavily_key_enc     = $4,
         resend_key_enc     = $5,
         resend_from_email  = $6,
         resend_from_name   = $7,
         outbound_bcc_email = $8,
         updated_at         = NOW()
       WHERE id = $1`,
      [
        tenantId,
        encrypt(keys.ANTHROPIC_API_KEY),
        keys.OPENAI_API_KEY     ? encrypt(keys.OPENAI_API_KEY)    : null,
        keys.TAVILY_API_KEY     ? encrypt(keys.TAVILY_API_KEY)    : null,
        keys.RESEND_API_KEY     ? encrypt(keys.RESEND_API_KEY)    : null,
        keys.RESEND_FROM_EMAIL  ?? null,
        keys.RESEND_FROM_NAME   ?? null,
        keys.OUTBOUND_BCC_EMAIL ?? null,
      ]
    )
  }

  async getKeys(tenantId: string): Promise<TenantEnv | null> {
    const { rows } = await this.pool.query<{
      anthropic_key_enc: string | null
      openai_key_enc: string | null
      tavily_key_enc: string | null
      resend_key_enc: string | null
      resend_from_email: string | null
      resend_from_name: string | null
      outbound_bcc_email: string | null
    }>(
      `SELECT anthropic_key_enc, openai_key_enc, tavily_key_enc,
              resend_key_enc, resend_from_email, resend_from_name, outbound_bcc_email
       FROM tenants WHERE id = $1 AND active = true`,
      [tenantId]
    )

    const row = rows[0]
    if (!row?.anthropic_key_enc) return null

    return {
      ANTHROPIC_API_KEY:  decrypt(row.anthropic_key_enc),
      OPENAI_API_KEY:     row.openai_key_enc     ? decrypt(row.openai_key_enc)    : undefined,
      TAVILY_API_KEY:     row.tavily_key_enc     ? decrypt(row.tavily_key_enc)    : undefined,
      RESEND_API_KEY:     row.resend_key_enc     ? decrypt(row.resend_key_enc)    : undefined,
      RESEND_FROM_EMAIL:  row.resend_from_email  ?? undefined,
      RESEND_FROM_NAME:   row.resend_from_name   ?? undefined,
      OUTBOUND_BCC_EMAIL: row.outbound_bcc_email ?? undefined,
    }
  }
}
