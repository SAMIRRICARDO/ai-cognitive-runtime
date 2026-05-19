# Security Policy

This document covers data handling, secret management, and safe deployment guidelines for the AI Cognitive Runtime.

---

## What This System Handles

- **Lead data**: company names, contact names, inferred email addresses
- **AI API keys**: Anthropic, OpenAI, Resend, Tavily
- **Email delivery**: outbound campaigns with rate limiting and audit logging
- **Semantic memory**: embeddings stored in pgvector

None of this data should ever appear in version control.

---

## Secret Management

### Required secrets (`.env`)

| Variable | Description | Never commit |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude API access | Yes |
| `OPENAI_API_KEY` | Embeddings | Yes |
| `RESEND_API_KEY` | Email delivery | Yes |
| `TAVILY_API_KEY` | Web search | Yes |
| `DATABASE_URL` | Postgres connection string | Yes |
| `REDIS_URL` | Redis connection string | Yes |
| `OUTBOUND_BCC_EMAIL` | Audit BCC inbox | Yes |

Use `.env.example` as the template. Copy to `.env` and fill in real values locally.

**`.env` is in `.gitignore` — never remove it.**

---

## Data That Must Never Be Committed

```
data/leads/          # all lead JSON/CSV files
data/leads/validated/
data/leads/futurecom/
data/outreach/       # generated outreach queues
dashboard/metrics.json  # contains real send history
logs/                # runtime logs (may contain email addresses)
backups/             # database snapshots
exports/             # any CSV/PDF exports
assets/pdfs/         # media kits (private)
assets/leads/        # any lead lists in assets
cache/               # agent response cache
usage/               # API usage reports
```

All of these are in `.gitignore`. **Do not force-add them.**

---

## Sample Data for Development

Use the sanitized examples in `data/examples/` for onboarding and testing:

```
data/examples/sample-leads.json          # mock leads (fake names/emails)
data/examples/sample-outreach-queue.json # mock outreach queue
data/examples/sample-metrics.json        # mock dashboard metrics
data/examples/sample-delivery-report.json # mock delivery report
```

These use placeholder names, generic domains, and fake scores only.

---

## Email Delivery Safety

The outbound system has built-in safety rails:

1. **Dry-run by default** — `--dry-run` is the default mode; `--live` must be explicit
2. **Daily cap** — `MAX_SENDS_PER_DAY` enforced in env (default: 5)
3. **Time guard** — `NO_SEND_AFTER=16:00` blocks late sends
4. **Weekend block** — `WEEKEND_BLOCK=true` prevents Saturday/Sunday sends
5. **BCC audit** — every live send is BCC'd to the configured audit inbox
6. **Quality gate** — leads below `--min-quality` threshold are skipped

**Never run `--live` without reviewing the dry-run output first.**

---

## Local-Only Guidance

This system is designed for local or self-hosted operation:

- The Postgres and Redis containers bind to `localhost` only (see `docker-compose.yml`)
- The dashboard server (`dashboard/server.js`) is local-only — do not expose publicly
- API keys are read at startup only from the validated env config (`config/env.ts`)
- No telemetry is sent to external services beyond the configured AI/email providers

---

## Production Recommendations

If deploying to a server:

1. Use a secrets manager (AWS Secrets Manager, Vault, Doppler) — not `.env` files
2. Run Postgres and Redis behind a private network — no public exposure
3. Rotate API keys after any suspected exposure
4. Enable TLS on all external connections
5. Restrict `OUTBOUND_BCC_EMAIL` to a monitored security inbox
6. Set `MAX_SENDS_PER_DAY` conservatively until email reputation is established
7. Review `docs/SYSTEM_GUARDRAILS.md` and implement all circuit breakers before scaling

---

## Reporting a Security Issue

If you discover a vulnerability or a secret was accidentally exposed:

1. Rotate the affected credential immediately
2. Audit git history: `git log --all --full-history -- path/to/file`
3. If the secret reached a remote: use `git filter-repo` to rewrite history and force-push
4. Notify the relevant API provider to invalidate the leaked key

---

## Responsible Disclosure

This is a private internal system. If you have access to this repository and find a security issue, report it directly to the project owner — do not file a public issue.
