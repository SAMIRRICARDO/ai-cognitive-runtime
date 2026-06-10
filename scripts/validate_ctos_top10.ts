import dns from "node:dns";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

type EmailStatus = "valid" | "risky" | "invalid";

type SourceLead = {
  lead_id?: string;
  full_name: string;
  job_title: string;
  company_name: string;
  company_domain: string;
  linkedin_url?: string;
  email: string;
  email_status: string;
  [key: string]: unknown;
};

type TargetContact = {
  full_name: string;
  company_name: string;
  company_domain: string;
  job_title: string;
  email: string;
  linkedin_url: string;
  source_url: string;
  role_note: string;
};

type ValidationResult = TargetContact & {
  email_status: EmailStatus;
  previous_email_status?: string;
  reason: string;
  mx_host?: string;
  checked_at: string;
};

const ROOT = process.cwd();
const SOURCE_FILE = path.join(ROOT, "leads_validados_2026-06-03.json");
const OUTPUT_FILE = path.join(ROOT, "data", "leads", "validated", "ctos-top10-email-validation-2026-06-08.json");
const LOG_FILE = path.join(ROOT, "vault", "imprensa", "logs", "ctos_top10_email_validation_2026-06-08.json");
const SMTP_FROM = "validator@ialeads.local";
const SMTP_TIMEOUT_MS = 6_000;

dns.setServers(["1.1.1.1", "8.8.8.8"]);

const targets: TargetContact[] = [
  {
    full_name: "Fabio Caversan",
    company_name: "Stefanini",
    company_domain: "stefanini.com",
    job_title: "Global CTO",
    email: "fabio.caversan@stefanini.com",
    linkedin_url: "https://www.linkedin.com/in/fabio-caversan",
    source_url: "https://www.linkedin.com/in/fabio-caversan",
    role_note: "Contato pedido pelo usuario; perfil publico localizado.",
  },
  {
    full_name: "Fernanda Weiden",
    company_name: "VTEX",
    company_domain: "vtex.com",
    job_title: "Chief Technology Officer",
    email: "fernanda.weiden@vtex.com",
    linkedin_url: "https://ch.linkedin.com/in/nandaweiden",
    source_url: "https://vtex.com/us-en/press/vtex-announces-fernanda-weiden-as-cto-and-reinforces-commitment-to-platform-scalability/",
    role_note: "Contato pedido; fontes recentes indicam mudanca posterior para Caju CPTO, validar substituicao antes de outbound VTEX.",
  },
  {
    full_name: "Thiago Teixeira",
    company_name: "Dock",
    company_domain: "dock.tech",
    job_title: "Chief Technology Officer",
    email: "thiago.teixeira@dock.tech",
    linkedin_url: "https://www.linkedin.com/in/thiagotdotcom",
    source_url: "https://www.linkedin.com/posts/cio-news_themainstream-technews-brazil-activity-7293241641060999168-KUCO",
    role_note: "Contato pedido; fonte publica reporta nomeacao como CTO da Dock.",
  },
  {
    full_name: "Felipe Cavalcanti",
    company_name: "Wildlife Studios",
    company_domain: "wildlifestudios.com",
    job_title: "Chief Technology Officer",
    email: "felipe.cavalcanti@wildlifestudios.com",
    linkedin_url: "https://br.linkedin.com/in/felipejfc",
    source_url: "https://careers.wildlifestudios.com/founders/",
    role_note: "Contato pedido; pagina da empresa lista Felipe Cavalcanti como CTO.",
  },
  {
    full_name: "Rogerio Tessari",
    company_name: "Olist",
    company_domain: "olist.com",
    job_title: "Chief Technology Officer",
    email: "rogerio.tessari@olist.com",
    linkedin_url: "https://br.linkedin.com/in/rtessari",
    source_url: "https://theorg.com/org/olist/org-chart/rogerio-tessari",
    role_note: "Contato pedido; perfil publico e The Org apontam cargo de CTO.",
  },
  {
    full_name: "Daniela Binatti",
    company_name: "Pismo",
    company_domain: "pismo.io",
    job_title: "Co-Founder & CTO",
    email: "daniela.binatti@pismo.io",
    linkedin_url: "",
    source_url: "https://www.linkedin.com/posts/pismo_ep-270-pismo-cto-daniela-binatti-activity-7406394308989464576--Nde",
    role_note: "Contato pedido; Pismo a identifica como Co-Founder & CTO.",
  },
  {
    full_name: "Fabiola Marchiori",
    company_name: "Neon",
    company_domain: "neon.com.br",
    job_title: "Chief Technology Officer",
    email: "fabiola.marchiori@neon.com.br",
    linkedin_url: "https://br.linkedin.com/in/fabiola-marchiori-604b83b1",
    source_url: "https://tiinside.com.br/en/24/02/2026/neon-anuncia-fabiola-marchiori-como-cto-para-liderar-nova-fase-de-escala-e-eficiencia-tecnologica/",
    role_note: "Contato pedido; fonte publica reporta nomeacao como CTO da Neon.",
  },
  {
    full_name: "Gustavo Livrare Martins",
    company_name: "Cora",
    company_domain: "cora.com.br",
    job_title: "Chief Technology Officer",
    email: "gustavo.livrare@cora.com.br",
    linkedin_url: "https://br.linkedin.com/in/gustavo-livrare",
    source_url: "https://www.baguete.com.br/noticias/cora-tem-novo-cto",
    role_note: "Contato pedido; fonte publica reporta nomeacao como CTO da Cora.",
  },
  {
    full_name: "Marcus Fontoura",
    company_name: "StoneCo",
    company_domain: "stone.co",
    job_title: "Chief Technology Officer",
    email: "marcus.fontoura@stone.co",
    linkedin_url: "https://www.linkedin.com/in/marcusfontoura/pt",
    source_url: "https://www.annualreports.com/HostedData/AnnualReportArchive/s/NASDAQ_STNE_2023.pdf",
    role_note: "Contato pedido; ha sinal publico de transicao posterior para advisor e substituicao por Raul Renteria, validar antes de outbound Stone.",
  },
  {
    full_name: "Andre Penha",
    company_name: "QuintoAndar",
    company_domain: "quintoandar.com.br",
    job_title: "Co-Founder and CTO",
    email: "andre.penha@quintoandar.com.br",
    linkedin_url: "https://www.linkedin.com/posts/andrepenha_andr%C3%A9-penha-do-quintoandar-tem-nova-miss%C3%A3o-activity-7242483106568388609-nsjs",
    source_url: "https://www.lavca.org/feature/inside-quintoandars-ascendancy-in-brazilian-real-estate-tech-interview-with-cto-andre-penha/",
    role_note: "Contato pedido; fontes recentes indicam que Andre deixou a funcao de CTO do QuintoAndar e assumiu novo desafio, validar substituicao antes de outbound QuintoAndar.",
  },
];

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

async function smtpValidate(mxHost: string, email: string): Promise<{ status: EmailStatus; reason: string; mx_host: string }> {
  let socket: net.Socket | null = null;
  try {
    socket = await connectSmtp(mxHost);
    const greetingCode = parseSmtpCode(await readSmtpResponse(socket));
    if (!greetingCode || greetingCode >= 400) {
      return { status: greetingCode && greetingCode >= 500 ? "invalid" : "risky", reason: `SMTP greeting ${greetingCode ?? "unknown"}`, mx_host: mxHost };
    }

    const ehloCode = parseSmtpCode(await sendCommand(socket, "EHLO ialeads.local"));
    if (!ehloCode || ehloCode >= 400) {
      return { status: ehloCode && ehloCode >= 500 ? "invalid" : "risky", reason: `EHLO ${ehloCode ?? "unknown"}`, mx_host: mxHost };
    }

    const mailCode = parseSmtpCode(await sendCommand(socket, `MAIL FROM:<${SMTP_FROM}>`));
    if (!mailCode || mailCode >= 400) {
      return { status: mailCode && mailCode >= 500 ? "invalid" : "risky", reason: `MAIL FROM ${mailCode ?? "unknown"}`, mx_host: mxHost };
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

function findPreviousStatus(sourceLeads: SourceLead[], contact: TargetContact): string | undefined {
  const source = sourceLeads.find(
    (lead) =>
      lead.email?.toLowerCase() === contact.email.toLowerCase() ||
      (lead.company_name === contact.company_name && lead.full_name.toLowerCase().includes(contact.full_name.split(" ")[0].toLowerCase())),
  );
  return source?.email_status;
}

async function validateContact(contact: TargetContact, sourceLeads: SourceLead[]): Promise<ValidationResult> {
  const domain = contact.email.split("@")[1]?.toLowerCase();
  const checkedAt = new Date().toISOString();
  const previous = findPreviousStatus(sourceLeads, contact);

  if (!domain) {
    return { ...contact, email_status: "invalid", previous_email_status: previous, reason: "invalid email format", checked_at: checkedAt };
  }

  try {
    const mx = await dns.promises.resolveMx(domain);
    const mxHost = mx.sort((a, b) => a.priority - b.priority)[0]?.exchange;
    if (!mxHost) {
      return { ...contact, email_status: "invalid", previous_email_status: previous, reason: "no MX record", checked_at: checkedAt };
    }

    const smtp = await smtpValidate(mxHost, contact.email);
    return {
      ...contact,
      email_status: smtp.status,
      previous_email_status: previous,
      reason: smtp.reason,
      mx_host: smtp.mx_host,
      checked_at: checkedAt,
    };
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    const message = error instanceof Error ? error.message : "DNS lookup failed";
    return {
      ...contact,
      email_status: code === "ENODATA" || code === "ENOTFOUND" ? "invalid" : "risky",
      previous_email_status: previous,
      reason: message,
      checked_at: checkedAt,
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
  const sourceLeads = JSON.parse(await readFile(SOURCE_FILE, "utf8")) as SourceLead[];
  const results: ValidationResult[] = [];

  for (const contact of targets) {
    results.push(await validateContact(contact, sourceLeads));
  }

  const payload = {
    metadata: {
      type: "ctos_top10_email_validation",
      source: path.relative(ROOT, SOURCE_FILE),
      generatedAt: new Date().toISOString(),
      total: results.length,
      valid: results.filter((result) => result.email_status === "valid").length,
      risky: results.filter((result) => result.email_status === "risky").length,
      invalid: results.filter((result) => result.email_status === "invalid").length,
      smtpNoDataSent: true,
    },
    contacts: results,
  };

  await mkdir(path.dirname(OUTPUT_FILE), { recursive: true });
  await mkdir(path.dirname(LOG_FILE), { recursive: true });
  await writeFile(OUTPUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await writeFile(LOG_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  printTable(results);
  console.log(`Resultado salvo em: ${path.relative(ROOT, OUTPUT_FILE)}`);
  console.log(`Log salvo em: ${path.relative(ROOT, LOG_FILE)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
