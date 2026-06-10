import { promises as dns } from "node:dns";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

type EmailStatus = "valid" | "risky" | "invalid";

type Lead = {
  lead_id?: string;
  full_name?: string;
  job_title?: string;
  company_name?: string;
  company_domain?: string;
  email?: string;
  email_status?: string;
  [key: string]: unknown;
};

type ValidationResult = {
  lead_id?: string;
  full_name: string;
  company_name: string;
  job_title: string;
  email: string;
  previous_status: string;
  email_status: EmailStatus;
  reason: string;
  mx_host?: string;
  checked_at: string;
};

const ROOT = process.cwd();
const SOURCE_FILE = path.join(ROOT, "leads_validados_2026-06-03.json");
const LOG_FILE = path.join(ROOT, "vault", "imprensa", "logs", "ctos_validated_2026-06-08.json");
const SMTP_TIMEOUT_MS = 8_000;
const SMTP_FROM = "validator@ialeads.local";

function isTargetLead(lead: Lead): boolean {
  const title = lead.job_title ?? "";
  return (
    lead.email_status === "risky" &&
    /\bCTO\b|Chief Technology|Co-Founder/i.test(title)
  );
}

function getEmailDomain(email: string): string | null {
  const match = email.trim().toLowerCase().match(/^[^@\s]+@([^@\s]+\.[^@\s]+)$/);
  return match?.[1] ?? null;
}

function formatSmtpCommand(command: string): string {
  return `${command}\r\n`;
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
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      const lastLine = lines.at(-1);

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

async function sendSmtpCommand(socket: net.Socket, command: string): Promise<string> {
  socket.write(formatSmtpCommand(command));
  return readSmtpResponse(socket);
}

async function connectToSmtp(host: string): Promise<net.Socket> {
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

async function smtpHandshake(mxHost: string, email: string): Promise<{ status: EmailStatus; reason: string }> {
  let socket: net.Socket | null = null;

  try {
    socket = await connectToSmtp(mxHost);

    const greeting = await readSmtpResponse(socket);
    const greetingCode = parseSmtpCode(greeting);
    if (!greetingCode || greetingCode >= 400) {
      return { status: greetingCode && greetingCode >= 500 ? "invalid" : "risky", reason: `SMTP greeting ${greetingCode ?? "unknown"}` };
    }

    const ehlo = await sendSmtpCommand(socket, "EHLO ialeads.local");
    const ehloCode = parseSmtpCode(ehlo);
    if (!ehloCode || ehloCode >= 400) {
      return { status: ehloCode && ehloCode >= 500 ? "invalid" : "risky", reason: `EHLO ${ehloCode ?? "unknown"}` };
    }

    const mailFrom = await sendSmtpCommand(socket, `MAIL FROM:<${SMTP_FROM}>`);
    const mailCode = parseSmtpCode(mailFrom);
    if (!mailCode || mailCode >= 400) {
      return { status: mailCode && mailCode >= 500 ? "invalid" : "risky", reason: `MAIL FROM ${mailCode ?? "unknown"}` };
    }

    const rcptTo = await sendSmtpCommand(socket, `RCPT TO:<${email}>`);
    const rcptCode = parseSmtpCode(rcptTo);

    await sendSmtpCommand(socket, "QUIT").catch(() => undefined);

    if (rcptCode === 250 || rcptCode === 251) {
      return { status: "valid", reason: `RCPT TO confirmed ${rcptCode}` };
    }
    if (rcptCode && rcptCode >= 500) {
      return { status: "invalid", reason: `RCPT TO rejected ${rcptCode}` };
    }

    return { status: "risky", reason: `RCPT TO inconclusive ${rcptCode ?? "unknown"}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown SMTP error";
    return { status: "risky", reason: message };
  } finally {
    socket?.destroy();
  }
}

async function validateEmail(lead: Lead): Promise<ValidationResult> {
  const email = String(lead.email ?? "");
  const domain = getEmailDomain(email);
  const checkedAt = new Date().toISOString();
  const baseResult = {
    lead_id: lead.lead_id,
    full_name: String(lead.full_name ?? ""),
    company_name: String(lead.company_name ?? ""),
    job_title: String(lead.job_title ?? ""),
    email,
    previous_status: String(lead.email_status ?? ""),
    checked_at: checkedAt,
  };

  if (!domain) {
    return { ...baseResult, email_status: "invalid", reason: "invalid email format" };
  }

  try {
    const mxRecords = await dns.resolveMx(domain);
    const mxHost = mxRecords.sort((a, b) => a.priority - b.priority)[0]?.exchange;

    if (!mxHost) {
      return { ...baseResult, email_status: "invalid", reason: "no MX record" };
    }

    const smtpResult = await smtpHandshake(mxHost, email);
    return {
      ...baseResult,
      email_status: smtpResult.status,
      reason: smtpResult.reason,
      mx_host: mxHost,
    };
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    const message = error instanceof Error ? error.message : "DNS lookup failed";
    return {
      ...baseResult,
      email_status: code === "ENODATA" || code === "ENOTFOUND" ? "invalid" : "risky",
      reason: message,
    };
  }
}

function printTable(results: ValidationResult[]): void {
  console.table(
    results.map((result) => ({
      Nome: result.full_name,
      Empresa: result.company_name,
      Email: result.email,
      Status: result.email_status,
    })),
  );
}

async function main(): Promise<void> {
  const raw = await readFile(SOURCE_FILE, "utf8");
  const leads = JSON.parse(raw) as Lead[];
  const targets = leads.filter(isTargetLead);
  const results: ValidationResult[] = [];

  for (const lead of targets) {
    const result = await validateEmail(lead);
    lead.email_status = result.email_status;
    results.push(result);
  }

  await writeFile(SOURCE_FILE, `${JSON.stringify(leads, null, 2)}\n`, "utf8");
  await mkdir(path.dirname(LOG_FILE), { recursive: true });
  await writeFile(
    LOG_FILE,
    `${JSON.stringify(
      {
        source: path.relative(ROOT, SOURCE_FILE),
        validatedAt: new Date().toISOString(),
        total: results.length,
        results,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  printTable(results);
  console.log(`Resultado salvo em: ${path.relative(ROOT, LOG_FILE)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
