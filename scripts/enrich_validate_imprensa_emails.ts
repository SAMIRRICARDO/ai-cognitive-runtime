import dns from "node:dns";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

type EmailStatus = "valid" | "risky" | "invalid" | "pending";

type PressContact = {
  veiculo: string;
  nome_completo: string;
  cargo: string;
  editoria: string;
  email_validado: string;
  linkedin_url: string;
  cobre_ia_gestao: boolean;
  score_relevancia: number;
  template_recomendado: string;
  status: string;
  email_enrichment?: unknown;
  email_candidates?: EmailCandidate[];
  [key: string]: unknown;
};

type CandidateInput = {
  email: string;
  source: "public_institutional" | "pattern" | "generic";
  note: string;
};

type EmailCandidate = CandidateInput & {
  status: EmailStatus;
  reason: string;
  mx_host?: string;
};

const ROOT = process.cwd();
const SOURCE_FILE = path.join(ROOT, "dados_imprensa_linkedin", "contatos_validados.json");
const OUTPUT_FILE = path.join(ROOT, "dados_imprensa_linkedin", "contatos_enriched_2026-06-08.json");
const LOG_FILE = path.join(ROOT, "vault", "imprensa", "logs", "imprensa_email_enrichment_2026-06-08.json");
const SMTP_FROM = "validator@ialeads.local";
const SMTP_TIMEOUT_MS = 6_000;

dns.setServers(["1.1.1.1", "8.8.8.8"]);

const candidatesByVehicle: Record<string, CandidateInput[]> = {
  Exame: [
    { email: "redacao@exame.com", source: "public_institutional", note: "Expediente EXAME" },
    { email: "releases@exame.com", source: "public_institutional", note: "Expediente EXAME" },
    { email: "andre.lopes@exame.com", source: "pattern", note: "nome.sobrenome@exame.com" },
  ],
  "Valor Economico": [
    { email: "redacao@valor.com.br", source: "public_institutional", note: "Fale conosco Valor" },
    { email: "joao.rosa@valor.com.br", source: "pattern", note: "nome.sobrenome@valor.com.br" },
    { email: "joao.luiz.rosa@valor.com.br", source: "pattern", note: "nome.nome.sobrenome@valor.com.br" },
  ],
  "Forbes Brasil": [
    { email: "redacao@forbesbrasil.com.br", source: "generic", note: "redacao generica" },
    { email: "marianna@forbesbrasil.com.br", source: "pattern", note: "nome@forbesbrasil.com.br" },
    { email: "contato@forbesbrasil.com.br", source: "generic", note: "contato generico" },
  ],
  "Epoca Negocios": [
    { email: "redacao@epocanegocios.com.br", source: "generic", note: "redacao generica" },
    { email: "patricia.basilio@epocanegocios.com.br", source: "pattern", note: "nome.sobrenome@epocanegocios.com.br" },
    { email: "redacao@edglobo.com.br", source: "generic", note: "dominio Editora Globo" },
  ],
  "MIT Technology Review Brasil": [
    { email: "redacao@mittechreview.com.br", source: "public_institutional", note: "Contato MIT Technology Review Brasil" },
    { email: "contato@mittechreview.com.br", source: "generic", note: "contato generico" },
    { email: "alexandre.roldao@mittechreview.com.br", source: "pattern", note: "nome.sobrenome@mittechreview.com.br" },
  ],
  Canaltech: [
    { email: "redacao@canaltech.com.br", source: "public_institutional", note: "Pagina Quem Somos Canaltech" },
    { email: "fernanda@canaltech.com.br", source: "pattern", note: "nome@canaltech.com.br" },
    { email: "fernanda.santos@canaltech.com.br", source: "pattern", note: "nome.sobrenome@canaltech.com.br" },
  ],
  Tecnoblog: [
    { email: "imprensa@tecnoblog.net", source: "public_institutional", note: "Fale conosco Tecnoblog" },
    { email: "contato@tecnoblog.net", source: "public_institutional", note: "Fale conosco Tecnoblog" },
    { email: "thassius@tecnoblog.net", source: "pattern", note: "nome@tecnoblog.net" },
  ],
  "The Hack": [
    { email: "contato@thehack.com.br", source: "generic", note: "contato generico" },
    { email: "redacao@thehack.com.br", source: "generic", note: "redacao generica" },
    { email: "hello@thehack.com.br", source: "generic", note: "hello generico" },
  ],
  "Startups.com.br": [
    { email: "gustavo@startups.com.br", source: "pattern", note: "nome@startups.com.br" },
    { email: "redacao@startups.com.br", source: "generic", note: "redacao generica" },
    { email: "contato@startups.com.br", source: "generic", note: "contato generico" },
  ],
  "Harvard Business Review Brasil": [
    { email: "contato@hbrbr.com.br", source: "generic", note: "contato generico" },
    { email: "redacao@hbrbr.com.br", source: "generic", note: "redacao generica" },
    { email: "roberto.muller@hbrbr.com.br", source: "pattern", note: "nome.sobrenome@hbrbr.com.br" },
  ],
  "Cafe com ADM": [
    { email: "contato@administradores.com.br", source: "generic", note: "dominio Administradores" },
    { email: "leandro@administradores.com.br", source: "pattern", note: "nome@administradores.com.br" },
    { email: "leandro.vieira@administradores.com.br", source: "pattern", note: "nome.sobrenome@administradores.com.br" },
  ],
  "Pizza de Dados": [
    { email: "contato@pizzadedados.com", source: "generic", note: "contato generico" },
    { email: "jessica@pizzadedados.com", source: "pattern", note: "nome@pizzadedados.com" },
    { email: "jessica.temporal@pizzadedados.com", source: "pattern", note: "nome.sobrenome@pizzadedados.com" },
  ],
  "Hipsters.tech": [
    { email: "hipsters@alura.com.br", source: "generic", note: "podcast da Alura" },
    { email: "paulo@alura.com.br", source: "pattern", note: "nome@alura.com.br" },
    { email: "paulo.silveira@alura.com.br", source: "pattern", note: "nome.sobrenome@alura.com.br" },
  ],
  "Nerdcast Negocios": [
    { email: "nerdcast@jovemnerd.com.br", source: "generic", note: "podcast generico" },
    { email: "contato@jovemnerd.com.br", source: "generic", note: "contato generico" },
    { email: "comercial@jovemnerd.com.br", source: "generic", note: "comercial generico" },
  ],
  "Lex Fridman BR": [],
  "G1 / Globo": [
    { email: "braulio.lorentz@g1.com", source: "pattern", note: "nome.sobrenome@g1.com" },
    { email: "redacao@g1.com", source: "generic", note: "redacao generica" },
    { email: "tecnologia@g1.com", source: "generic", note: "editoria generica" },
  ],
  "UOL Economia": [
    { email: "aline.sordili@uol.com.br", source: "pattern", note: "nome.sobrenome@uol.com.br" },
    { email: "redacao@uol.com.br", source: "generic", note: "redacao generica" },
  ],
  "Folha de S.Paulo": [
    { email: "mauricio.meireles@uol.com.br", source: "pattern", note: "nome.sobrenome@uol.com.br" },
    { email: "mauricio.meireles@grupofolha.com.br", source: "pattern", note: "nome.sobrenome@grupofolha.com.br" },
  ],
  "O Globo": [
    { email: "rennan.setti@oglobo.com.br", source: "pattern", note: "nome.sobrenome@oglobo.com.br" },
    { email: "redacao@oglobo.com.br", source: "generic", note: "redacao generica" },
    { email: "rennan.setti@globo.com", source: "pattern", note: "nome.sobrenome@globo.com" },
  ],
  Estadao: [
    { email: "redacao@estadao.com", source: "generic", note: "redacao generica" },
    { email: "negocios@estadao.com", source: "generic", note: "editoria generica" },
    { email: "inovacao@estadao.com", source: "generic", note: "editoria generica" },
  ],
};

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
    const greeting = parseSmtpCode(await readSmtpResponse(socket));
    if (!greeting || greeting >= 400) {
      return { status: greeting && greeting >= 500 ? "invalid" : "risky", reason: `SMTP greeting ${greeting ?? "unknown"}`, mx_host: mxHost };
    }

    const ehlo = parseSmtpCode(await sendCommand(socket, "EHLO ialeads.local"));
    if (!ehlo || ehlo >= 400) {
      return { status: ehlo && ehlo >= 500 ? "invalid" : "risky", reason: `EHLO ${ehlo ?? "unknown"}`, mx_host: mxHost };
    }

    const mail = parseSmtpCode(await sendCommand(socket, `MAIL FROM:<${SMTP_FROM}>`));
    if (!mail || mail >= 400) {
      return { status: mail && mail >= 500 ? "invalid" : "risky", reason: `MAIL FROM ${mail ?? "unknown"}`, mx_host: mxHost };
    }

    const rcpt = parseSmtpCode(await sendCommand(socket, `RCPT TO:<${email}>`));
    await sendCommand(socket, "QUIT").catch(() => undefined);

    if (rcpt === 250 || rcpt === 251) {
      return { status: "valid", reason: `RCPT TO confirmed ${rcpt}`, mx_host: mxHost };
    }
    if (rcpt && rcpt >= 500) {
      return { status: "invalid", reason: `RCPT TO rejected ${rcpt}`, mx_host: mxHost };
    }
    return { status: "risky", reason: `RCPT TO inconclusive ${rcpt ?? "unknown"}`, mx_host: mxHost };
  } catch (error) {
    const message = error instanceof Error ? error.message : "SMTP error";
    return { status: "risky", reason: message, mx_host: mxHost };
  } finally {
    socket?.destroy();
  }
}

async function validateEmail(candidate: CandidateInput): Promise<EmailCandidate> {
  const domain = candidate.email.split("@")[1]?.toLowerCase();
  if (!domain) {
    return { ...candidate, status: "invalid", reason: "invalid email format" };
  }

  try {
    const mxRecords = await dns.promises.resolveMx(domain);
    const mxHost = mxRecords.sort((a, b) => a.priority - b.priority)[0]?.exchange;
    if (!mxHost) {
      return { ...candidate, status: "invalid", reason: "no MX record" };
    }

    const result = await smtpValidate(mxHost, candidate.email);
    return { ...candidate, status: result.status, reason: result.reason, mx_host: result.mx_host };
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    const message = error instanceof Error ? error.message : "DNS lookup failed";
    return {
      ...candidate,
      status: code === "ENODATA" || code === "ENOTFOUND" ? "invalid" : "risky",
      reason: message,
    };
  }
}

async function enrichContact(contact: PressContact): Promise<PressContact> {
  if (contact.email_validado) {
    return {
      ...contact,
      email_enrichment: {
        skipped: true,
        reason: "email_validado already present",
      },
    };
  }

  const inputs = candidatesByVehicle[contact.veiculo] ?? [];
  const candidates: EmailCandidate[] = [];

  for (const input of inputs) {
    const result = await validateEmail(input);
    candidates.push(result);
    if (result.status === "valid") {
      break;
    }
  }

  const selected = candidates.find((candidate) => candidate.status === "valid");
  const updated: PressContact = {
    ...contact,
    email_candidates: candidates,
    email_enrichment: {
      checkedAt: new Date().toISOString(),
      method: "public_institutional_and_pattern_candidates_mx_smtp_rcpt",
      smtpNoDataSent: true,
      selectedEmail: selected?.email ?? "",
      selectedStatus: selected?.status ?? "pending",
      selectedReason: selected?.reason ?? (inputs.length ? "no valid candidate" : "no candidate available"),
    },
  };

  if (selected) {
    updated.email_validado = selected.email;
    updated.status = "pendente";
  }

  return updated;
}

function printTable(contacts: PressContact[]): void {
  console.table(
    contacts.map((contact) => ({
      Veiculo: contact.veiculo,
      Nome: contact.nome_completo,
      Email: contact.email_validado || "",
      Status: contact.email_validado ? "valid" : "pending",
    })),
  );
}

async function main(): Promise<void> {
  const contacts = JSON.parse(await readFile(SOURCE_FILE, "utf8")) as PressContact[];
  const enriched: PressContact[] = [];

  for (const contact of contacts) {
    enriched.push(await enrichContact(contact));
  }

  const newlyValidated = enriched.filter((contact) => contact.email_validado && !contacts.find((original) => original.veiculo === contact.veiculo)?.email_validado);
  const payload = {
    metadata: {
      source: path.relative(ROOT, SOURCE_FILE),
      generatedAt: new Date().toISOString(),
      total: enriched.length,
      alreadyValidated: contacts.filter((contact) => contact.email_validado).length,
      newlyValidated: newlyValidated.length,
      stillPending: enriched.filter((contact) => !contact.email_validado).length,
      smtpNoDataSent: true,
    },
    contacts: enriched,
  };

  await writeFile(SOURCE_FILE, `${JSON.stringify(enriched, null, 2)}\n`, "utf8");
  await writeFile(OUTPUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await mkdir(path.dirname(LOG_FILE), { recursive: true });
  await writeFile(LOG_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  printTable(enriched);
  console.log(`Enriquecido salvo em: ${path.relative(ROOT, OUTPUT_FILE)}`);
  console.log(`Log salvo em: ${path.relative(ROOT, LOG_FILE)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
