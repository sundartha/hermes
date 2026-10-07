import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
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
import { interneKennungen } from "../test/mcp-vertrag-pruefung.js";
import { REVIEWER_SEED_CALLS } from "../scripts/lib/reviewer-demo-seed.mjs";

const REPO_WURZEL = fileURLToPath(new URL("..", import.meta.url));
const OPTION_P10A = "doku-p10a";
const OPTION_REVIEWER = "doku-reviewer";
const STANDARD_DOKUS = {
  [OPTION_P10A]: join(REPO_WURZEL, "docs", "OPENAI-TOOL-INVENTORY.md"),
  [OPTION_REVIEWER]: join(REPO_WURZEL, "docs", "OPENAI-REVIEWER-ACCESS.md"),
};
const AUFRUF_OPTIONEN = {
  [OPTION_P10A]: { type: "string" },
  [OPTION_REVIEWER]: { type: "string" },
};
const NUTZUNG = `Nutzung: node tools/openai-doku-pruefen.mjs [--${OPTION_P10A} PFAD] [--${OPTION_REVIEWER} PFAD]`;
const EXIT_SAUBER = 0;
const EXIT_BEFUND = 1;
const EXIT_AUFRUF = 2;

const WERKZEUGLISTE_ANFRAGE = { jsonrpc: "2.0", id: 1, method: "tools/list" };
const RUECKFRAGE_EINGESCHALTET = { ASSISTANT_CONTEXT_ENABLED: "true", CONSULT_ENABLED: "true" };
const METADATEN_PFAD = "/.well-known/oauth-protected-resource";
const VOLLE_KONFIGURATION = "K1";
const KEINE_RUECKFRAGE = {};
const OHNE_TOKEN = null;
const STDIO_EINSTIEG = "src/mcp-server.js";
const STDIO_ANTWORT = z.object({ tools: z.array(z.any()) });
const STDIO_CLIENT = { name: "openai-doku-pruefen", version: "0.0.0" };
const BEZAHLTER_TARIF = "starter";
const MANDANT_STANDARD = { id: "t_doku_standard", subjekt: "sub-doku-standard" };
const MANDANT_BEZAHLT = { id: "t_doku_bezahlt", subjekt: "sub-doku-bezahlt" };

const KONFIGURATIONEN = ["K1", "K2", "K3", "K4", "K5", "K6"];
const HINWEIS_SPALTEN = ["readOnlyHint", "destructiveHint", "openWorldHint", "idempotentHint"];
const SPALTEN_A = ["name", "title", "condition"].concat(HINWEIS_SPALTEN);
const ERWARTETE_ZEILEN_A = 12;
const HINWEIS_FEHLT = "-";
const BLOCK_A = ["TABLE-A-BEGIN", "TABLE-A-END"];
const BLOCK_B = ["TABLE-B-BEGIN", "TABLE-B-END"];
const PROSA_KOPF_A = "| name | title | condition |";
const PROSA_KOPF_B = "| K | transport |";
const TRENNZEILE = /^\|[-|\s]+\|$/;
const BEDINGUNG_NACH_ANWESENHEIT = new Map([
  ["111111", "always"],
  ["100100", "consult"],
]);

const SPRACHEN = ["en", "de"];
const ANKER = ["ANKER-BEGIN", "ANKER-END"];
const ABSCHNITTE = { de: ["## Deutsch", "## Anker"], en: ["## English", "## Deutsch"] };
const LOGIN_KOEPFE = { de: "### 3. Login-Pfad", en: "### 3. Login path" };
const NAECHSTER_UNTERABSCHNITT = "\n### ";
const NUMMERIERTER_SCHRITT = /^\d+\. /gm;
const BETREIBER_ZUSAGE = { de: "Zusage des Betreibers", en: "Operator commitment" };
const ZITAT_ANFANG = '> "';
const OPENAI_URL = "https://developers.openai.com/";
const WERKZEUGNAME_IN_BACKTICKS = /`([a-z]+(?:_[a-z]+)+)`/g;
const KEINE_WERKZEUGE = new Set(["authorization_servers"]);
const EXTRAKTOR_PROBE = "list_calls";
const KENNUNGS_PROBE = "siehe T2-20 und OW-L";

const BEISPIELBLOECKE = [
  {
    sprache: "en",
    marken: ["SEED-EN-BEGIN -->", "<!-- SEED-EN-END"],
    anruf: "Incoming call from",
    aufgabe: "Action item:",
  },
  {
    sprache: "de",
    marken: ["SEED-DE-BEGIN -->", "<!-- SEED-DE-END"],
    anruf: "Eingehender Anruf von",
    aufgabe: "Action Item:",
  },
];

const PLATZHALTER = [
  "<REVIEWER_EMAIL>",
  "<REVIEWER_PASSWORD>",
  "<MCP_SERVER_URL>",
  "<TEST_TARGET_NUMBER>",
];

const PFLICHTZITATE = [
  "When submitting a plugin with an authenticated MCP server, provide a login and password for a fully featured demo account that includes sample data. Plugins that require additional login steps, such as a new account sign-up or 2FA through an inaccessible account, will be rejected.",
  "For servers requiring authentication, our review team must be able to log into a demo account with no further configuration required.",
  "Ensure that the provided URL and credentials are correct, do not feature MFA (including requiring SMS codes, login through systems that require SMS, email or other verification schemes).",
  "Ensure that the provided credentials can be used to log in successfully (test them outside any company networks, local area networks, or other internal networks).",
  "Confirm that the credentials have not expired.",
  "Test account or fixture data required to reproduce it.",
  "Use test cases that reviewers can run without internal context. If your plugin requires authentication, make sure the provided demo credentials can complete each test without MFA, SMS, email confirmation, or private-network access.",
  "Reviewer credentials work without MFA, email confirmation, SMS confirmation, or private-network access.",
  "Reviewer-ready demo credentials when the server uses OAuth.",
];

const WARNUNGEN = [
  { en: "Operator commitment, not a code fact", de: "Zusage des Betreibers, keine Code-Tatsache" },
  { en: "does not technically restrict", de: "technisch" },
  { en: "reach real people", de: "echte Menschen" },
  { en: "fictional", de: "fiktiv" },
  { en: "Please do not", de: "Bitte" },
  { en: "retention period", de: "Aufbewahrungsfrist" },
  { en: "do not expire", de: "nicht ablaufen" },
  { en: "no administrator override", de: "keine Administrator-Ausnahme" },
  { en: "without MFA", de: "ohne MFA" },
  { en: "empty inbox", de: "leeren Posteingang" },
  { en: "does not extend the retention", de: "verlaengert die Aufbewahrung vorhandener nicht" },
];

const HYGIENE_MUSTER = [
  { art: "Phase", beispiel: "siehe Phase 3", muster: /\bPhase\b/ },
  { art: "P-/E-Nummer", beispiel: "wie in P7b", muster: /\b[PE]\d+[a-z]?\b/ },
  { art: "E-Mail", beispiel: "reviewer@example.com", muster: /[\w.+-]+@[\w-]+\.[\w.]+/ },
  {
    art: "Nummer ausser 555-01xx",
    beispiel: "+4915112345678",
    muster: /\+(?!120255501\d\d\b)\d{6,}/,
  },
  { art: "Stripe-Schluessel", beispiel: "sk_live_abc", muster: /\bsk_/ },
  { art: "Webhook-Secret", beispiel: "whsec_abc", muster: /whsec_/ },
  {
    art: "Anbieter-Nutzerkennung",
    beispiel: "user_01ABCDEFGHJK",
    muster: /\buser_[A-Za-z0-9]{10,}/,
  },
  { art: "Anbieter-Organisation", beispiel: "org_01ABC", muster: /\borg_/ },
];

const nichtLeer = (zeile) => zeile.trim() !== "";
const aufzaehlung = (namen) => (namen.length > 0 ? namen.join(",") : "keine");
const zeilenNummer = (text, position) => text.slice(0, position).split("\n").length;
const alsZelle = (wert) => (wert === undefined ? HINWEIS_FEHLT : String(wert));
const alsZeileA = (zellen) =>
  Object.fromEntries(SPALTEN_A.map((spalte, index) => [spalte, zellen[index]]));

function blockZeilen(text, [anfang, ende]) {
  const start = text.indexOf(anfang);
  const stopp = text.indexOf(ende);
  if (start === -1 || stopp <= start) throw new Error(`Block ${anfang}..${ende} fehlt`);
  const zeilen = text.slice(start + anfang.length, stopp).split("\n");
  return zeilen.map((zeile) => zeile.trim()).filter(nichtLeer);
}

function tabelleA(doku) {
  return blockZeilen(doku, BLOCK_A).map((zeile) => alsZeileA(zeile.split("|")));
}

function tabelleB(doku) {
  const eintraege = blockZeilen(doku, BLOCK_B).map((zeile) => {
    const [konfiguration, transport, anzahl, namen] = zeile.split("|");
    return [konfiguration, { transport, anzahl: Number(anzahl), namen: (namen ?? "").split(",") }];
  });
  return new Map(eintraege);
}

function eintragB(tabelle, konfiguration) {
  const eintrag = tabelle.get(konfiguration);
  if (eintrag === undefined) throw new Error(`Tabelle B ohne ${konfiguration}`);
  return eintrag;
}

function prosaZeilen(doku, kopf) {
  const zeilen = doku.split("\n");
  const kopfIndex = zeilen.findIndex((zeile) => zeile.startsWith(kopf));
  if (kopfIndex === -1) throw new Error(`Prosatabelle "${kopf}" fehlt`);
  const folgende = zeilen.slice(kopfIndex + 1);
  const ende = folgende.findIndex((zeile) => !zeile.startsWith("|"));
  const tabelle = ende === -1 ? folgende : folgende.slice(0, ende);
  const inhalt = tabelle.filter((zeile) => !TRENNZEILE.test(zeile));
  return inhalt.map((zeile) =>
    zeile
      .split("|")
      .slice(1, -1)
      .map((zelle) => zelle.trim()),
  );
}

const prosaTabelleA = (doku) => prosaZeilen(doku, PROSA_KOPF_A).map(alsZeileA);

function prosaAnzahlenB(doku) {
  return new Map(
    prosaZeilen(doku, PROSA_KOPF_B).map((zellen) => [zellen[0], Number(zellen.at(-1))]),
  );
}

function namensAbweichung(bezeichnung, ist, soll) {
  const sortiert = (namen) => [...namen].sort().join(",");
  if (sortiert(ist) === sortiert(soll)) return [];
  const zusaetzlich = ist.filter((name) => !soll.includes(name));
  const fehlend = soll.filter((name) => !ist.includes(name));
  return [
    `${bezeichnung}: Namensmenge weicht ab (zusaetzlich: ${aufzaehlung(zusaetzlich)}; fehlend: ${aufzaehlung(fehlend)}; ist: ${sortiert(ist)})`,
  ];
}

function fallTabelleA({ p10a }) {
  const zeilen = tabelleA(p10a);
  const anzahl =
    zeilen.length === ERWARTETE_ZEILEN_A
      ? []
      : [`Tabelle A hat ${zeilen.length} statt ${ERWARTETE_ZEILEN_A} Zeilen`];
  const blockK1 = eintragB(tabelleB(p10a), VOLLE_KONFIGURATION);
  const namen = zeilen.map((zeile) => zeile.name);
  return [
    ...anzahl,
    ...namensAbweichung(`Tabelle A vs. Tabelle B ${VOLLE_KONFIGURATION}`, namen, blockK1.namen),
  ];
}

function fallProsaA({ p10a }) {
  const prosa = prosaTabelleA(p10a);
  const block = tabelleA(p10a);
  if (prosa.length !== block.length)
    return [`Prosatabelle A hat ${prosa.length} Zeilen, Block ${block.length}`];
  return prosa.flatMap((zeile, index) => {
    const blockZeile = block[index];
    const abweichend = SPALTEN_A.filter((spalte) => zeile[spalte] !== blockZeile[spalte]);
    return abweichend.map(
      (spalte) =>
        `Zeile ${index + 1} ${spalte}: Prosa "${zeile[spalte]}", Block "${blockZeile[spalte]}"`,
    );
  });
}

function fallProsaB({ p10a }) {
  const prosa = prosaAnzahlenB(p10a);
  const block = tabelleB(p10a);
  const erwartet = KONFIGURATIONEN.join(",");
  const vorhanden = [...prosa.keys()].join(",");
  const reihe =
    vorhanden === erwartet ? [] : [`Prosatabelle B traegt ${vorhanden} statt ${erwartet}`];
  const anzahlen = KONFIGURATIONEN.filter(
    (konfiguration) => prosa.get(konfiguration) !== block.get(konfiguration)?.anzahl,
  );
  return reihe.concat(
    anzahlen.map(
      (konfiguration) =>
        `${konfiguration}: Anzahl Prosa ${prosa.get(konfiguration)}, Block ${block.get(konfiguration)?.anzahl}`,
    ),
  );
}

function anzahlBefunde(konfiguration, werkzeuge, { block, prosa }) {
  const eintrag = eintragB(block, konfiguration);
  const prosaAnzahl = prosa.get(konfiguration);
  const amDraht = werkzeuge.length;
  const befunde = [];
  if (amDraht !== eintrag.anzahl)
    befunde.push(`${konfiguration}: ${amDraht} Werkzeuge am Draht, Block nennt ${eintrag.anzahl}`);
  if (amDraht !== prosaAnzahl)
    befunde.push(`${konfiguration}: ${amDraht} Werkzeuge am Draht, Prosa nennt ${prosaAnzahl}`);
  const namen = werkzeuge.map((werkzeug) => werkzeug.name);
  return befunde.concat(namensAbweichung(`${konfiguration} Draht vs. Block`, namen, eintrag.namen));
}

function fallDrahtAnzahl({ p10a, draht }) {
  const tabellen = { block: tabelleB(p10a), prosa: prosaAnzahlenB(p10a) };
  return KONFIGURATIONEN.flatMap((konfiguration) =>
    anzahlBefunde(konfiguration, draht.konfigurationen.get(konfiguration), tabellen),
  );
}

function werkzeugGegenZeile(bezeichnung, werkzeug, zeile) {
  if (zeile === undefined) return [`${bezeichnung}: fehlt in Tabelle A`];
  const annotationen = werkzeug.annotations ?? {};
  const vergleiche = [
    ["title", werkzeug.title, zeile.title],
    ["annotations.title", annotationen.title, zeile.title],
    ...HINWEIS_SPALTEN.map((hinweis) => [hinweis, alsZelle(annotationen[hinweis]), zeile[hinweis]]),
  ];
  const abweichend = vergleiche.filter(([, ist, doku]) => ist !== doku);
  return abweichend.map(
    ([feld, ist, doku]) => `${bezeichnung}: ${feld} ist "${ist}", Doku "${doku}"`,
  );
}

function fallTitelUndHinweise({ p10a, draht }) {
  const quellen = { Block: tabelleA(p10a), Prosa: prosaTabelleA(p10a) };
  return Object.entries(quellen).flatMap(([quelle, zeilen]) => {
    const nachName = new Map(zeilen.map((zeile) => [zeile.name, zeile]));
    return [...draht.konfigurationen].flatMap(([konfiguration, werkzeuge]) =>
      werkzeuge.flatMap((werkzeug) =>
        werkzeugGegenZeile(
          `${quelle}/${konfiguration}/${werkzeug.name}`,
          werkzeug,
          nachName.get(werkzeug.name),
        ),
      ),
    );
  });
}

function bedingungAmDraht(konfigurationen, name) {
  const anwesenheit = KONFIGURATIONEN.map((konfiguration) =>
    konfigurationen.get(konfiguration).some((werkzeug) => werkzeug.name === name) ? "1" : "0",
  ).join("");
  return BEDINGUNG_NACH_ANWESENHEIT.get(anwesenheit) ?? `unerwartet:${anwesenheit}`;
}

function fallBedingung({ p10a, draht }) {
  const quellen = { Block: tabelleA(p10a), Prosa: prosaTabelleA(p10a) };
  return Object.entries(quellen).flatMap(([quelle, zeilen]) =>
    zeilen
      .map((zeile) => ({ zeile, gemessen: bedingungAmDraht(draht.konfigurationen, zeile.name) }))
      .filter(({ zeile, gemessen }) => zeile.condition !== gemessen)
      .map(
        ({ zeile, gemessen }) =>
          `${quelle}: ${zeile.name} condition "${zeile.condition}", am Draht gemessen "${gemessen}"`,
      ),
  );
}

function zwischen(text, [anfang, ende]) {
  const start = text.indexOf(anfang);
  const stopp = text.indexOf(ende, start + anfang.length);
  if (start === -1 || stopp <= start) throw new Error(`Abschnitt ${anfang}..${ende} fehlt`);
  return { start, stopp: stopp + ende.length, inhalt: text.slice(start + anfang.length, stopp) };
}

const abschnitt = (doku, sprache) => zwischen(doku, ABSCHNITTE[sprache]).inhalt;

function ohneAnker(doku) {
  const { start, stopp } = zwischen(doku, ANKER);
  const zeilenumbrueche = doku.slice(start, stopp).replace(/[^\n]/g, "");
  return doku.slice(0, start) + zeilenumbrueche + doku.slice(stopp);
}

function musterBefunde(prosa, { art, beispiel, muster }) {
  const befunde = muster.test(beispiel) ? [] : [`Positiv-Kontrolle ${art} versagt`];
  const fundstelle = prosa.search(muster);
  if (fundstelle !== -1)
    befunde.push(`${art} im Dokument (Zeile ${zeilenNummer(prosa, fundstelle)})`);
  return befunde;
}

function fallHygiene({ reviewer }) {
  const kennungen = interneKennungen(reviewer).map((kennung) => `interne Kennung: ${kennung}`);
  const kontrolle =
    interneKennungen(KENNUNGS_PROBE).length > 0
      ? []
      : ["Positiv-Kontrolle interneKennungen versagt"];
  const prosa = ohneAnker(reviewer);
  return [
    ...kennungen,
    ...kontrolle,
    ...HYGIENE_MUSTER.flatMap((regel) => musterBefunde(prosa, regel)),
  ];
}

function fallZitate({ reviewer }) {
  const zeilen = reviewer.split("\n");
  const zitate = zeilen.flatMap((zeile, index) => (zeile.startsWith(ZITAT_ANFANG) ? [index] : []));
  const zuWenige =
    zitate.length >= PFLICHTZITATE.length
      ? []
      : [`nur ${zitate.length} Zitate gefunden, der Extraktor greift nicht`];
  const ohneUrl = zitate.filter((index) => !zeilen[index + 1]?.includes(OPENAI_URL));
  const englisch = abschnitt(reviewer, "en");
  const fehlend = PFLICHTZITATE.filter((zitat) => !englisch.includes(`${ZITAT_ANFANG}${zitat}"`));
  return [
    ...zuWenige,
    ...ohneUrl.map((index) => `Zitat ohne developers.openai.com-URL in Zeile ${index + 1}`),
    ...fehlend.map((zitat) => `Soll-Zitat fehlt im EN-Teil: ${zitat}`),
  ];
}

function sollBeispielzeilen({ anruf, aufgabe }) {
  return REVIEWER_SEED_CALLS.flatMap((gespraech) => [
    `- ${anruf} ${gespraech.from}: ${gespraech.summary}`,
    ...gespraech.actionItems.map((punkt) => `  - ${aufgabe} ${punkt}`),
  ]);
}

function fallBeispieldaten({ reviewer }) {
  return BEISPIELBLOECKE.flatMap((block) => {
    const { inhalt } = zwischen(reviewer, block.marken);
    const ist = inhalt.split("\n").filter(nichtLeer);
    const soll = sollBeispielzeilen(block);
    const positionen = [...Array(Math.max(ist.length, soll.length)).keys()];
    const erste = positionen.find((position) => ist[position] !== soll[position]);
    if (erste === undefined) return [];
    return [
      `${block.sprache}: Beispieldaten weichen in Zeile ${erste + 1} ab: ist "${ist[erste] ?? ""}", soll "${soll[erste] ?? ""}"`,
    ];
  });
}

function loginSchritte(doku, sprache) {
  const text = abschnitt(doku, sprache);
  const kopf = LOGIN_KOEPFE[sprache];
  const start = text.indexOf(kopf);
  if (start === -1) throw new Error(`${sprache}: Login-Abschnitt fehlt`);
  const rest = text.slice(start + kopf.length);
  const naechster = rest.indexOf(NAECHSTER_UNTERABSCHNITT);
  const bereich = naechster === -1 ? rest : rest.slice(0, naechster);
  return (bereich.match(NUMMERIERTER_SCHRITT) ?? []).length;
}

function fehlendeTexte(reviewer, sprache) {
  const text = abschnitt(reviewer, sprache);
  const platzhalter = PLATZHALTER.filter((eintrag) => !text.includes(eintrag));
  const warnungen = WARNUNGEN.map((warnung) => warnung[sprache]).filter(
    (warnung) => !text.includes(warnung),
  );
  return [
    ...platzhalter.map((eintrag) => `${sprache}: Platzhalter ${eintrag} fehlt`),
    ...warnungen.map((warnung) => `${sprache}: Warnung "${warnung}" fehlt`),
  ];
}

function fallZweisprachig({ reviewer }) {
  const befunde = SPRACHEN.flatMap((sprache) => fehlendeTexte(reviewer, sprache));
  const schritte = { en: loginSchritte(reviewer, "en"), de: loginSchritte(reviewer, "de") };
  if (schritte.en === 0) befunde.push("Login-Schritte nicht gefunden");
  if (schritte.de !== schritte.en)
    befunde.push(`Login-Schritte: EN ${schritte.en}, DE ${schritte.de}`);
  const zusagen = Object.fromEntries(
    SPRACHEN.map((sprache) => [
      sprache,
      abschnitt(reviewer, sprache).split(BETREIBER_ZUSAGE[sprache]).length - 1,
    ]),
  );
  if (zusagen.de !== zusagen.en)
    befunde.push(`Betreiber-Zusagen: EN ${zusagen.en}, DE ${zusagen.de}`);
  return befunde;
}

function fallWerkzeugnamen({ reviewer, draht }) {
  const kennungen = [...reviewer.matchAll(WERKZEUGNAME_IN_BACKTICKS)].map(([, name]) => name);
  const genannt = new Set(kennungen.filter((name) => !KEINE_WERKZEUGE.has(name)));
  const befunde = genannt.has(EXTRAKTOR_PROBE)
    ? []
    : [`Extraktor greift nicht (${EXTRAKTOR_PROBE} nicht gefunden)`];
  const metadatenFelder = Object.keys(draht.metadaten);
  const keinFeld = [...KEINE_WERKZEUGE].filter((name) => !metadatenFelder.includes(name));
  const werkzeugeK1 = draht.konfigurationen.get(VOLLE_KONFIGURATION);
  const amDraht = new Set(werkzeugeK1.map((werkzeug) => werkzeug.name));
  const unbekannt = [...genannt].filter((name) => !amDraht.has(name));
  return [
    ...befunde,
    ...keinFeld.map((name) => `${name} ist kein Feld von ${METADATEN_PFAD}`),
    ...unbekannt.map((name) => `Werkzeug fehlt im tools/list: ${name}`),
  ];
}

const FAELLE = [
  ["p10a Tabelle A", fallTabelleA],
  ["p10a Prosatabelle A", fallProsaA],
  ["p10a Prosatabelle B", fallProsaB],
  ["p10a Anzahl am Draht", fallDrahtAnzahl],
  ["p10a Titel und Hinweise", fallTitelUndHinweise],
  ["p10a Bedingung", fallBedingung],
  ["reviewer Hygiene", fallHygiene],
  ["reviewer Zitate", fallZitate],
  ["reviewer Beispieldaten", fallBeispieldaten],
  ["reviewer EN/DE", fallZweisprachig],
  ["reviewer Werkzeugnamen", fallWerkzeugnamen],
];

function fallBefunde([name, pruefung], kontext) {
  try {
    return pruefung(kontext).map((befund) => `${name}: ${befund}`);
  } catch (fehler) {
    return [`${name}: ${fehler.message}`];
  }
}

function ladeDokus() {
  try {
    const { values } = parseArgs({ options: AUFRUF_OPTIONEN, strict: true });
    const pfade = { ...STANDARD_DOKUS, ...values };
    const fehlend = Object.values(pfade).filter((pfad) => !existsSync(pfad));
    if (fehlend.length > 0) return { fehler: fehlend.map((pfad) => `Dokument fehlt: ${pfad}`) };
    return {
      p10a: readFileSync(pfade[OPTION_P10A], "utf8"),
      reviewer: readFileSync(pfade[OPTION_REVIEWER], "utf8"),
    };
  } catch (fehler) {
    return { fehler: [`Aufruf falsch: ${fehler.message}`, NUTZUNG] };
  }
}

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

async function messeDraht() {
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

function beende(code, zeilen) {
  for (const zeile of zeilen) console.log(zeile);
  process.exit(code);
}

async function hauptprogramm() {
  const dokus = ladeDokus();
  if (dokus.fehler) return beende(EXIT_AUFRUF, dokus.fehler);
  const draht = await messeDraht();
  const befunde = FAELLE.flatMap((fall) => fallBefunde(fall, { ...dokus, draht }));
  const zusammenfassung = `openai-doku-pruefen: ${befunde.length} Befunde in ${FAELLE.length} Faellen`;
  return beende(befunde.length > 0 ? EXIT_BEFUND : EXIT_SAUBER, [...befunde, zusammenfassung]);
}

hauptprogramm().catch((fehler) =>
  beende(EXIT_BEFUND, [`openai-doku-pruefen abgebrochen: ${fehler.message}`]),
);
