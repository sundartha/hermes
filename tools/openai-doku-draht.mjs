import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { planProfileFor } from "../src/plans.js";
import {
  BASE_ENV,
  startServer,
  startIdp,
  seedState,
  mcpPost,
  readToolResult,
} from "../test/helpers.js";

const REPO_WURZEL = fileURLToPath(new URL("..", import.meta.url));
const WERKZEUGLISTE_ANFRAGE = { jsonrpc: "2.0", id: 1, method: "tools/list" };
const RUECKFRAGE_EINGESCHALTET = { ASSISTANT_CONTEXT_ENABLED: "true", CONSULT_ENABLED: "true" };
export const METADATEN_PFAD = "/.well-known/oauth-protected-resource";
export const VOLLE_KONFIGURATION = "K1";
const KEINE_RUECKFRAGE = {};
const OHNE_TOKEN = null;
const STDIO_EINSTIEG = "src/mcp-server.js";
const STDIO_ANTWORT = z.object({ tools: z.array(z.any()) });
const STDIO_CLIENT = { name: "openai-doku-pruefen", version: "0.0.0" };
const BEZAHLTER_TARIF = "starter";
const MANDANT_STANDARD = { id: "t_doku_standard", subjekt: "sub-doku-standard" };
const MANDANT_BEZAHLT = { id: "t_doku_bezahlt", subjekt: "sub-doku-bezahlt" };

async function mitServer(startoptionen, arbeit) {
  const server = await startServer(startoptionen);
  try {
    return await arbeit(server.localUrl);
  } finally {
    await server.stop();
    rmSync(server.dataDir, { recursive: true, force: true });
  }
}

async function werkzeugliste(basis, token) {
  const antwort = await mcpPost(`${basis}/mcp`, token, WERKZEUGLISTE_ANFRAGE);
  const { tools } = await readToolResult(antwort);
  return tools;
}

async function metadatenVon(basis) {
  const antwort = await fetch(`${basis}${METADATEN_PFAD}`);
  return antwort.json();
}

function oauthMandanten() {
  return seedState({
    tenants: [MANDANT_STANDARD, MANDANT_BEZAHLT].map(({ id, subjekt }) => ({
      id,
      status: "active",
      idpSubject: subjekt,
    })),
    profiles: { [MANDANT_BEZAHLT.id]: planProfileFor(BEZAHLTER_TARIF) },
  });
}

async function messeOauth() {
  const idp = await startIdp();
  const oauthStart = (schalter) => ({
    seed: oauthMandanten(),
    env: { ...schalter, MCP_AUTH: "oauth", OAUTH_ISSUER_URL: idp.issuer },
  });
  try {
    const standard = await idp.sign({ sub: MANDANT_STANDARD.subjekt });
    const bezahlt = await idp.sign({ sub: MANDANT_BEZAHLT.subjekt });
    const [k3, k4] = await mitServer(oauthStart(RUECKFRAGE_EINGESCHALTET), async (basis) => [
      await werkzeugliste(basis, standard),
      await werkzeugliste(basis, bezahlt),
    ]);
    const k5 = await mitServer(oauthStart(KEINE_RUECKFRAGE), (basis) =>
      werkzeugliste(basis, bezahlt),
    );
    return [
      ["K3", k3],
      ["K4", k4],
      ["K5", k5],
    ];
  } finally {
    await idp.close();
  }
}

async function messeStdio() {
  const kanal = new StdioClientTransport({
    command: process.execPath,
    args: [STDIO_EINSTIEG],
    cwd: REPO_WURZEL,
    env: { ...BASE_ENV },
    stderr: "pipe",
  });
  const client = new Client(STDIO_CLIENT);
  try {
    await client.connect(kanal);
    const { tools } = await client.request({ method: "tools/list" }, STDIO_ANTWORT);
    return tools;
  } finally {
    await client.close();
  }
}

export async function messeDraht() {
  const ohneAnmeldung = (schalter) => ({ seed: seedState({}), env: schalter });
  const voll = await mitServer(ohneAnmeldung(RUECKFRAGE_EINGESCHALTET), async (basis) => ({
    werkzeuge: await werkzeugliste(basis, OHNE_TOKEN),
    metadaten: await metadatenVon(basis),
  }));
  const k2 = await mitServer(ohneAnmeldung(KEINE_RUECKFRAGE), (basis) =>
    werkzeugliste(basis, OHNE_TOKEN),
  );
  const oauth = await messeOauth();
  const k6 = await messeStdio();
  const konfigurationen = new Map([
    [VOLLE_KONFIGURATION, voll.werkzeuge],
    ["K2", k2],
    ...oauth,
    ["K6", k6],
  ]);
  return { konfigurationen, metadaten: voll.metadaten };
}
