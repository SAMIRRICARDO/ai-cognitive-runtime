-- Migration 001: email delivery events from Resend webhooks
-- Run once against the ai_lab database.

CREATE TABLE IF NOT EXISTS email_events (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  resend_id    TEXT        NOT NULL,
  event_type   TEXT        NOT NULL,   -- email.delivered | email.opened | email.clicked | email.bounced | email.complained | email.sent
  recipient    TEXT        NOT NULL,
  company      TEXT,
  subject      TEXT,
  url          TEXT,                   -- populated for email.clicked
  bounce_msg   TEXT,                   -- populated for email.bounced
  user_agent   TEXT,                   -- populated for email.opened / email.clicked
  ip           TEXT,                   -- populated for email.opened / email.clicked
  raw          JSONB       NOT NULL DEFAULT '{}',
  occurred_at  TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS email_events_resend_id_idx   ON email_events (resend_id);
CREATE INDEX IF NOT EXISTS email_events_recipient_idx   ON email_events (recipient);
CREATE INDEX IF NOT EXISTS email_events_event_type_idx  ON email_events (event_type);
CREATE INDEX IF NOT EXISTS email_events_occurred_at_idx ON email_events (occurred_at DESC);

-- Useful aggregation view
CREATE OR REPLACE VIEW email_funnel AS
SELECT
  recipient,
  company,
  subject,
  MAX(CASE WHEN event_type = 'email.delivered'  THEN occurred_at END) AS delivered_at,
  MAX(CASE WHEN event_type = 'email.opened'     THEN occurred_at END) AS first_opened_at,
  COUNT(CASE WHEN event_type = 'email.opened'   THEN 1 END)           AS open_count,
  MAX(CASE WHEN event_type = 'email.clicked'    THEN occurred_at END) AS first_clicked_at,
  COUNT(CASE WHEN event_type = 'email.clicked'  THEN 1 END)           AS click_count,
  MAX(CASE WHEN event_type = 'email.bounced'    THEN occurred_at END) AS bounced_at,
  MAX(CASE WHEN event_type = 'email.complained' THEN occurred_at END) AS complained_at
FROM email_events
GROUP BY recipient, company, subject;
