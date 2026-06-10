import dns from "node:dns";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

type EmailStatus = "valid" | "risky" | "invalid";

type Lead = {
  lead_id: string;
  full_name: string;
  job_title: string;
  company_name: string;
  company_domain: string;
  linkedin_url?: string;
  email: string;
  email_status: string;
  status: string;
  email_candidates?: EmailCandidate[];
  email_enrichment?: Record<string, unknown>;
  [key: string]: unknown;
};

type LeadFile = {
  metadata: Record<string, unknown>;
  leads: Lead[];
};

type EmailCandidate = {
  email: string;
  pattern: string;
  status: EmailStatus;
  reason: string;
  mx_host?: string;
};

type ValidationResult = {
  status: EmailStatus;
  reason: string;
  mx_host?: string;
};

const ROOT = process.cwd();
const SOURCE_FILE = path.join(ROOT, "data", "leads", "new", "ctos-tech-extra-11-2026-06-07.json");
const LOG_FILE = path.join(ROOT, "vault", "imprensa", "logs", "ctos_extra_email_enrichment_2026-06-07.json");
const SMTP_FROM = "validator@ialeads.local";
const SMTP_TIMEOUT_MS = 5_000;
const MAX_CANDIDATES_PER_LEAD = 3;

dns.setServers(["1.1.1.1", "8.8.8.8"]);

const candidateOverrides: Record<string, Array<{ email: string; pattern: string }>> = {
  "cto-extra-003": [
    { email: "dgeison.delucca@contasimples.com", pattern: "first.compoundLast@domain" },
    { email: "dgeison.de.lucca@contasimples.com", pattern: "first.de.last@domain" },
    { email: "dgeison@contasimples.com", pattern: "first@domain" },
  ],
  "cto-extra-005": [
    { email: "carlos.rezende@projuris.com.br", pattern: "first.last@domain" },
    { email: "carlos.eduardo@projuris.com.br", pattern: "first.middle@domain" },
    { email: "carlos.eduardo.rezende@projuris.com.br", pattern: "first.middle.last@domain" },
  ],
  "cto-extra-008": [
    { email: "kalecser.kurtz@ebanx.com", pattern: "first.last@domain" },
    { email: "kalecser.pasquali@ebanx.com", pattern: "first.middle@domain" },
    { email: "kalecser@ebanx.com", pattern: "first@domain" },
  ],
  "cto-extra-011": [
    { email: "fabio.trentini@clickbus.com.br", pattern: "first.last@domain" },
    { email: "fabio.wakim@clickbus.com.br", pattern: "first.middle@domain" },
    { email: "fabio.wakim.trentini@clickbus.com.br", pattern: "first.middle.last@domain" },
  ],
};

function normalizeNamePart(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

function buildDefaultCandidates(lead: Lead): Array<{ email: string; pattern: string }> {
  const parts = lead.full_name.split(/\s+/).map(normalizeNamePart).filter(Boolean);
  const first = parts[0];
  const last = parts.at(-1);
  const domain = lead.company_domain.toLowerCase();

  if (!first || !last || !domain) {
    return [];
  }

  const raw = [
    { email: `${first}.${last}@${domain}`, pattern: "first.last@domain" },
    { email: `${first}@${domain}`, pattern: "first@domain" },
    { email: `${first}${last}@${domain}`, pattern: "firstlast@domain" },
  ];

  return Array.from(new Map(raw.map((candidate) => [candidate.email, candidate])).values());
}

function getCandidates(lead: Lead): Array<{ email: string; pattern: string }> {
  return (candidateOverrides[lead.lead_id] ?? buildDefaultCandidates(lead)).slice(0, MAX_CANDIDATES_PER_LEAD);
}

function emailDomain(email: string): string | null {
  return email.match(/^[^@\s]+@([^@\s]+)$/)?.[1]?.toLowerCase() ?? null;
}

function parseSmtpCode(response: string): number | null {
  const match = response.match(/^(\d{3})/m);
  return match ? Number(match[1]) : null;
}

function readSmtpResponse(socket: net.Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("timeout", onTimeout);
    };
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const lastLine = buffer.split(/\r?\n/).filter(Boolean).at(-1);
      if (lastLine && /^\d{3} /.test(lastLine)) {
        cleanup();
        resolve(buffer);
      }
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onTimeout = () => {
      cleanup();
      reject(new Error("SMTP timeout"));
    };

    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("timeout", onTimeout);
  });
}

function connectSmtp(host: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port: 25 });
    socket.setTimeout(SMTP_TIMEOUT_MS);

    const cleanup = () => {
      socket.off("connect", onConnect);
      socket.off("error", onError);
      socket.off("timeout", onTimeout);
    };
    const onConnect = () => {
      cleanup();
      resolve(socket);
    };
    const onError = (error: Error) => {
      cleanup();
      socket.destroy();
      reject(error);
    };
    const onTimeout = () => {
      cleanup();
      socket.destroy();
      reject(new Error("SMTP connection timeout"));
    };

    socket.once("connect", onConnect);
    socket.once("error", onError);
    socket.once("timeout", onTimeout);
  });
}

async function sendCommand(socket: net.Socket, command: string): Promise<string> {
  socket.write(`${command}\r\n`);
  return readSmtpResponse(socket);
}

async function smtpValidate(mxHost: string, email: string): Promise<ValidationResult> {
  let socket: net.Socket | null = null;

  try {
    socket = await connectSmtp(mxHost);

    const greetingCode = parseSmtpCode(await readSmtpResponse(socket));
    if (!greetingCode || greetingCode >= 400) {
      return { status: greetingCode && greetingCode >= 500 ? "invalid" : "risky", reason: `SMTP greeting ${greetingCode ?? "unknown"}` };
    }

    const ehloCode = parseSmtpCode(await sendCommand(socket, "EHLO ialeads.local"));
    if (!ehloCode || ehloCode >= 400) {
      return { status: ehloCode && ehloCode >= 500 ? "invalid" : "risky", reason: `EHLO ${ehloCode ?? "unknown"}` };
    }

    const mailCode = parseSmtpCode(await sendCommand(socket, `MAIL FROM:<${SMTP_FROM}>`));
    if (!mailCode || mailCode >= 400) {
      return { status: mailCode && mailCode >= 500 ? "invalid" : "risky", reason: `MAIL FROM ${mailCode ?? "unknown"}` };
    }

    const rcptCode = parseSmtpCode(await sendCommand(socket, `RCPT TO:<${email}>`));
    await sendCommand(socket, "QUIT").catch(() => undefined);

    if (rcptCode === 250 || rcptCode === 251) {
      return { status: "valid", reason: `RCPT TO confirmed ${rcptCode}`, mx_host: mxHost };
    }
    if (rcptCode && rcptCode >= 500) {
      return { status: "invalid", reason: `RCPT TO rejected ${rcptCode}`, mx_host: mxHost };
    }

    return { status: "risky", reason: `RCPT TO inconclusive ${rcptCode ?? "unknown"}`, mx_host: mxHost };
  } catch (error) {
    const message = error instanceof Error ? error.message : "SMTP error";
    return { status: "risky", reason: message, mx_host: mxHost };
  } finally {
    socket?.destroy();
  }
}

async function validateCandidate(email: string): Promise<ValidationResult> {
  const domain = emailDomain(email);
  if (!domain) {
    return { status: "invalid", reason: "invalid email format" };
  }

  try {
    const mxRecords = await dns.promises.resolveMx(domain);
    const mxHost = mxRecords.sort((a, b) => a.priority - b.priority)[0]?.exchange;
    if (!mxHost) {
      return { status: "invalid", reason: "no MX record" };
    }

    return smtpValidate(mxHost, email);
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    const message = error instanceof Error ? error.message : "DNS lookup failed";
    return {
      status: code === "ENODATA" || code === "ENOTFOUND" ? "invalid" : "risky",
      reason: message,
    };
  }
}

async function enrichLead(lead: Lead): Promise<Lead> {
  const checkedAt = new Date().toISOString();
  const candidates: EmailCandidate[] = [];

  for (const candidate of getCandidates(lead)) {
    const result = await validateCandidate(candidate.email);
    candidates.push({
      email: candidate.email,
      pattern: candidate.pattern,
      status: result.status,
      reason: result.reason,
      mx_host: result.mx_host,
    });

    if (result.status === "valid") {
      break;
    }
  }

  const best = candidates.find((candidate) => candidate.status === "valid") ?? candidates.find((candidate) => candidate.status === "risky") ?? candidates[0];

  lead.email = best?.email ?? lead.email;
  lead.email_status = best?.status ?? "invalid";
  lead.status = lead.email_status === "valid" ? "validado" : "pendente";
  lead.email_candidates = candidates;
  lead.email_enrichment = {
    method: "pattern_candidates_mx_smtp_rcpt",
    checkedAt,
    smtpNoDataSent: true,
    selectedEmail: lead.email,
    selectedReason: best?.reason ?? "no candidate generated",
  };

  return lead;
}

function printTable(leads: Lead[]): void {
  console.table(
    leads.map((lead) => ({
      Nome: lead.full_name,
      Empresa: lead.company_name,
      Email: lead.email,
      Status: lead.email_status,
    })),
  );
}

async function main(): Promise<void> {
  const raw = await readFile(SOURCE_FILE, "utf8");
  const data = JSON.parse(raw) as LeadFile;
  const enriched: Lead[] = [];

  for (const lead of data.leads) {
    enriched.push(await enrichLead(lead));
  }

  data.metadata = {
    ...data.metadata,
    enrichedAt: new Date().toISOString(),
    enrichmentStatus: "completed",
    enrichmentMethod: "pattern_candidates_mx_smtp_rcpt",
  };
  data.leads = enriched;

  await writeFile(SOURCE_FILE, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await mkdir(path.dirname(LOG_FILE), { recursive: true });
  await writeFile(
    LOG_FILE,
    `${JSON.stringify(
      {
        source: path.relative(ROOT, SOURCE_FILE),
        generatedAt: new Date().toISOString(),
        total: enriched.length,
        valid: enriched.filter((lead) => lead.email_status === "valid").length,
        risky: enriched.filter((lead) => lead.email_status === "risky").length,
        invalid: enriched.filter((lead) => lead.email_status === "invalid").length,
        results: enriched.map((lead) => ({
          lead_id: lead.lead_id,
          full_name: lead.full_name,
          company_name: lead.company_name,
          email: lead.email,
          email_status: lead.email_status,
          selectedReason: lead.email_enrichment?.selectedReason,
          candidates: lead.email_candidates,
        })),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  printTable(enriched);
  console.log(`Log salvo em: ${path.relative(ROOT, LOG_FILE)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
