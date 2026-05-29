/**
 * webhooks/resend-webhook.ts — Resend delivery event receiver
 *
 * Listens for email.delivered / email.opened / email.clicked / email.bounced /
 * email.complained events from Resend and persists them to PostgreSQL.
 *
 * Resend uses Svix for signing. Signature verification is done here without
 * the svix package — only Node.js built-in crypto is needed.
 *
 * Setup:
 *   1. Run migration: psql $DATABASE_URL -f infra/postgres/migrations/001_email_events.sql
 *   2. Set RESEND_WEBHOOK_SECRET (from Resend dashboard → Webhooks → Signing Secret)
 *   3. tsx webhooks/resend-webhook.ts
 *   4. Expose via ngrok / reverse proxy and register URL in Resend dashboard
 *
 * Usage in dev:
 *   npx tsx webhooks/resend-webhook.ts
 */

import express, { type Request, type Response } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import pg from "pg";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";

const { Pool } = pg;

// ─── Postgres pool ─────────────────────────────────────────────────────────────

const pool = env.DATABASE_URL
  ? new Pool({ connectionString: env.DATABASE_URL })
  : null;

if (!pool) {
  logger.warn("[resend-webhook] DATABASE_URL not set — events will be logged but NOT persisted");
}

// ─── Svix signature verification ──────────────────────────────────────────────
// Docs: https://docs.svix.com/receiving/verifying-payloads/how-manual

const TOLERANCE_SECONDS = 300; // reject payloads older than 5 min

function verifySignature(
  rawBody: Buffer,
  headers: Record<string, string | string[] | undefined>,
  secret: string,
): boolean {
  const msgId        = String(headers["svix-id"]        ?? "");
  const msgTimestamp = String(headers["svix-timestamp"] ?? "");
  const msgSig       = String(headers["svix-signature"] ?? "");

  if (!msgId || !msgTimestamp || !msgSig) return false;

  // Reject stale payloads
  const ts = parseInt(msgTimestamp, 10);
  if (isNaN(ts)) return false;
  const ageSecs = Math.abs(Date.now() / 1000 - ts);
  if (ageSecs > TOLERANCE_SECONDS) {
    logger.warn("[resend-webhook] rejected stale payload", { ageSecs });
    return false;
  }

  // Derive signing key: strip "whsec_" prefix, base64-decode
  const keyB64 = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  const key = Buffer.from(keyB64, "base64");

  // Signed content: "<msgId>.<msgTimestamp>.<rawBody>"
  const toSign = `${msgId}.${msgTimestamp}.${rawBody.toString("utf8")}`;
  const expectedSig = createHmac("sha256", key).update(toSign).digest("base64");

  // svix-signature header may contain multiple sigs: "v1,<b64> v1,<b64>"
  for (const part of msgSig.split(" ")) {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) continue;
    try {
      if (timingSafeEqual(Buffer.from(sig, "base64"), Buffer.from(expectedSig, "base64"))) {
        return true;
      }
    } catch {
      // buffers of different length throw — not a match, continue
    }
  }

  return false;
}

// ─── Event types ──────────────────────────────────────────────────────────────

interface ResendEvent {
  type: string;
  created_at: string;
  data: {
    email_id: string;
    created_at?: string;
    from?: string;
    to?: string[];
    subject?: string;
    click?: {
      ipAddress?: string;
      link?: string;
      timestamp?: string;
      userAgent?: string;
    } | null;
    bounce?: { message?: string } | null;
    headers?: unknown[];
    tags?: Record<string, string>;
  };
}

// ─── Persist event ─────────────────────────────────────────────────────────────

async function persistEvent(event: ResendEvent): Promise<void> {
  const { type, data } = event;
  const recipient   = (data.to ?? [])[0] ?? "unknown";
  const occurredAt  = data.created_at ?? event.created_at;

  const url        = data.click?.link        ?? null;
  const userAgent  = data.click?.userAgent   ?? null;
  const ip         = data.click?.ipAddress   ?? null;
  const bounceMsg  = data.bounce?.message    ?? null;

  const logPayload = { type, recipient, subject: data.subject ?? null, emailId: data.email_id };
  logger.info("[resend-webhook] event received", logPayload);

  if (!pool) return;

  await pool.query(
    `INSERT INTO email_events
       (resend_id, event_type, recipient, subject, url, bounce_msg, user_agent, ip, raw, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT DO NOTHING`,
    [
      data.email_id,
      type,
      recipient,
      data.subject ?? null,
      url,
      bounceMsg,
      userAgent,
      ip,
      JSON.stringify(event),
      new Date(occurredAt),
    ],
  );
}

// ─── Express app ───────────────────────────────────────────────────────────────

const app = express();

// Raw body required for HMAC signature verification
app.use(express.raw({ type: "application/json" }));

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", db: pool ? "connected" : "disabled" });
});

app.post("/webhooks/resend", async (req: Request, res: Response) => {
  const rawBody = req.body as Buffer;

  // ── Signature check ──────────────────────────────────────────────────────────
  const secret = env.RESEND_WEBHOOK_SECRET;
  if (secret) {
    if (!verifySignature(rawBody, req.headers as Record<string, string>, secret)) {
      logger.warn("[resend-webhook] invalid signature — rejected");
      res.status(401).json({ error: "invalid signature" });
      return;
    }
  } else {
    logger.warn("[resend-webhook] RESEND_WEBHOOK_SECRET not set — skipping signature verification");
  }

  // ── Parse + handle ───────────────────────────────────────────────────────────
  let event: ResendEvent;
  try {
    event = JSON.parse(rawBody.toString("utf8")) as ResendEvent;
  } catch {
    res.status(400).json({ error: "invalid JSON" });
    return;
  }

  const TRACKED = new Set([
    "email.sent",
    "email.delivered",
    "email.opened",
    "email.clicked",
    "email.bounced",
    "email.complained",
  ]);

  if (!TRACKED.has(event.type)) {
    // Acknowledge untracked event types without error
    res.status(200).json({ ignored: true, type: event.type });
    return;
  }

  try {
    await persistEvent(event);
    res.status(200).json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[resend-webhook] failed to persist event", { error: msg, type: event.type });
    // Return 200 to prevent Resend from retrying on a DB error
    // (retries are fine, but we don't want to be flooded during an outage)
    res.status(200).json({ ok: false, error: msg });
  }
});

// ─── Start ─────────────────────────────────────────────────────────────────────

const PORT = env.WEBHOOK_PORT ?? 4000;

const server = app.listen(PORT, () => {
  logger.info(`[resend-webhook] listening on port ${PORT}`, {
    db: pool ? "postgres" : "disabled",
    signatureVerification: env.RESEND_WEBHOOK_SECRET ? "enabled" : "disabled (dev mode)",
  });
});

process.on("SIGTERM", () => {
  server.close(async () => {
    await pool?.end();
    process.exit(0);
  });
});
