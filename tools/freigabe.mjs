import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { APPROVERS, alleSeiten, api, ereignis, geaenderteDateien, inhaltAn } from "./github.mjs";
import { prueferEingabeBauen } from "./mutation-laeufe.mjs";

const BAU_AGENT = "sundartha-agent[bot]";
const PRODUKTCODE = "src/";
const FREIGEGEBEN = "APPROVED";
const KURZ = 7;
const SYSTEM_BRANCH = /^(?:system|dependabot)\//;
const PRUEFREGELN = [
  /^tools\/(?:bereiche|bausteine)\.json$/,
  /^tools\/(?:basis|eslint-rules)\//,
  /^tools\/(?:freigabe|github)\.mjs$/,
  /^eslint\.config\./,
  /^eslint-suppressions[^/]*\.json$/,
  /^\.dependency-cruiser\.cjs$/,
  /^gitleaks\.toml$/,
  /^(?:\.github|\.claude)\//,
  /^CLAUDE\.md$/,
];
const SCHRANKE_AUSWEG = "Prüfregeln ändert nur Engineering, auf einem Branch system/*. Fehlt dir ein Weg im Test, schreibe ihn über den Eingang des Bereichs oder halte an und melde es im Issue.";
const EXIT_ROT = 1;
const MODULPFAD = "node_modules/";
const UPDATE_BRANCH = "dependabot/";
const MIGRATION_KOPF = "## Migrationsprüfung";
const ABSCHNITT_ENDE = "## ";
const PAKET_KOPF = "### ";
const PFLICHTFELDER = ["Quelle", "Auszug", "Nutzung"];
const NODE_ZEILE = /\bnode-version:[ \t]*["']?(\d[\w.-]*)/g;
const USES_ZEILE = /\buses:[ \t]*["']?([^\s"'@]+)@([^\s"'#]+)/g;

function letzteUrteile(reviews) {
  const jeAutor = new Map();
  for (const review of reviews) {
    if (APPROVERS.includes(review.user?.login) && review.state !== "COMMENTED") jeAutor.set(review.user.login, review);
  }
  return [...jeAutor.values()];
}

export function herkunftBefunde(pull, dateien) {
  const aendertSrc = dateien.some(({ pfad }) => pfad.startsWith(PRODUKTCODE));
  if (!aendertSrc || pull.user?.login === BAU_AGENT) return [];
  return [`Code unter ${PRODUKTCODE} kommt nur vom Bau-Agenten (${BAU_AGENT}); dieser PR ist von ${pull.user?.login}.`];
}

function alsJson(text) {
  return text === undefined ? undefined : JSON.parse(text);
}

function unterdrueckungenJeRegel(daten) {
  const summe = {};
  for (const regeln of Object.values(daten ?? {})) {
    for (const [regel, { count }] of Object.entries(regeln)) summe[regel] = (summe[regel] ?? 0) + count;
  }
  return summe;
}

function waechstUnterdrueckung(basis, kopf, pfad) {
  const vorher = unterdrueckungenJeRegel(alsJson(inhaltAn(basis, pfad)));
  const nachher = unterdrueckungenJeRegel(alsJson(inhaltAn(kopf, pfad)));
  return Object.entries(nachher).some(([regel, anzahl]) => anzahl > (vorher[regel] ?? 0));
}

function bausteinJeQuelle(daten) {
  const karte = new Map();
  for (const { baustein, quellen } of daten?.bausteine ?? []) for (const quelle of quellen) karte.set(quelle, baustein);
  return karte;
}

function ohneQuellen(daten) {
  return JSON.stringify({ ...daten, bausteine: (daten?.bausteine ?? []).map((eintrag) => Object.fromEntries(Object.entries(eintrag).filter(([schluessel]) => schluessel !== "quellen"))) });
}

function aendertBestandBausteine({ basis, kopf, dateien }) {
  const angelegt = new Set(dateien.filter(({ status }) => status === "A").map(({ pfad }) => pfad));
  const vorher = alsJson(inhaltAn(basis, "tools/bausteine.json"));
  const nachher = alsJson(inhaltAn(kopf, "tools/bausteine.json"));
  const neu = bausteinJeQuelle(nachher);
  const alt = bausteinJeQuelle(vorher);
  const bestandErhalten = [...alt].every(([quelle, baustein]) => neu.get(quelle) === baustein);
  const nurNeueDateien = [...neu.keys()].every((quelle) => alt.has(quelle) || angelegt.has(quelle));
  return !bestandErhalten || !nurNeueDateien || ohneQuellen(vorher) !== ohneQuellen(nachher);
}

export function schrankeBefunde({ branch, dateien, basis, kopf }) {
  if (SYSTEM_BRANCH.test(branch ?? "")) return [];
  return dateien
    .filter(({ pfad }) => PRUEFREGELN.some((muster) => muster.test(pfad)))
    .filter(({ pfad }) => {
      if (/^eslint-suppressions[^/]*\.json$/.test(pfad)) return waechstUnterdrueckung(basis, kopf, pfad);
      if (pfad === "tools/bausteine.json") return aendertBestandBausteine({ basis, kopf, dateien });
      return true;
    })
    .map(({ pfad }) => `${pfad}: Prüfregel auf Branch ${branch}. ${SCHRANKE_AUSWEG}`);
}

function freigabenAufKopf(pull, reviews) {
  return letzteUrteile(reviews).filter(({ state, commit_id: stand }) => state === FREIGEGEBEN && stand === pull.head.sha);
}

export function freigabeBefunde(pull, reviews, dateien) {
  const kopf = pull.head.sha;
  const ergebnis = herkunftBefunde(pull, dateien);
  const freigaben = freigabenAufKopf(pull, reviews);
  if (freigaben.length === 0) {
    ergebnis.push(`Es fehlt das KI-Urteil: ein Approve von ${APPROVERS.join(" oder ")} auf dem Stand ${kopf.slice(0, KURZ)}.`);
  } else {
    console.log(`Freigegeben von ${freigaben.map(({ user }) => user.login).join(" und ")} auf ${kopf.slice(0, KURZ)}.`);
  }
  return ergebnis;
}

function aenderungen(vorher, nachher) {
  return [...nachher].filter(([schluessel, neu]) => vorher.has(schluessel) && vorher.get(schluessel) !== neu).map(([schluessel, neu]) => ({ schluessel, alt: vorher.get(schluessel), neu }));
}

function lockVersionen(inhalt) {
  const eintraege = Object.entries(alsJson(inhalt)?.packages ?? {}).filter(([pfad]) => pfad.includes(MODULPFAD));
  return new Map(eintraege.map(([pfad, { version }]) => [pfad, version]));
}

function lockAenderungen(vorher, nachher) {
  const pakete = aenderungen(lockVersionen(vorher), lockVersionen(nachher)).map(({ schluessel, alt, neu }) => ({ name: schluessel.slice(schluessel.lastIndexOf(MODULPFAD) + MODULPFAD.length), alt, neu, oekosystem: "npm" }));
  return { pakete, node: [] };
}

function nodeAenderung(alt, neu) {
  return alt !== "" && neu !== "" && alt !== neu ? [{ alt, neu }] : [];
}

function enginesNode(inhalt) {
  return String(alsJson(inhalt)?.engines?.node ?? "");
}

function enginesAenderung(vorher, nachher) {
  return { pakete: [], node: nodeAenderung(enginesNode(vorher), enginesNode(nachher)) };
}

function nvmrcAenderung(vorher, nachher) {
  return { pakete: [], node: nodeAenderung(String(vorher ?? "").trim(), String(nachher ?? "").trim()) };
}

function einmaligSortiert(werte) {
  return [...new Set(werte)].toSorted().join(" ");
}

function workflowNode(inhalt) {
  return einmaligSortiert([...String(inhalt ?? "").matchAll(NODE_ZEILE)].map(([, wert]) => wert));
}

function actionStaende(inhalt) {
  const staende = new Map();
  for (const [, name, stand] of String(inhalt ?? "").matchAll(USES_ZEILE)) staende.set(name, [...(staende.get(name) ?? []), stand]);
  return new Map([...staende].map(([name, liste]) => [name, einmaligSortiert(liste)]));
}

function workflowAenderungen(vorher, nachher) {
  const pakete = aenderungen(actionStaende(vorher), actionStaende(nachher)).map(({ schluessel, alt, neu }) => ({ name: schluessel, alt, neu, oekosystem: "actions" }));
  return { pakete, node: nodeAenderung(workflowNode(vorher), workflowNode(nachher)) };
}

const VERSIONSQUELLEN = [
  [/(?:^|\/)package-lock\.json$/, lockAenderungen],
  [/(?:^|\/)package\.json$/, enginesAenderung],
  [/(?:^|\/)\.nvmrc$/, nvmrcAenderung],
  [/^\.github\/(?:workflows|actions)\/.+\.ya?ml$/, workflowAenderungen],
];

function einmalig(liste) {
  return [...new Map(liste.map((eintrag) => [JSON.stringify(eintrag), eintrag])).values()];
}

function updateRoh({ branch, titel, dateien, basis, kopf, lesen }) {
  const teile = dateien.flatMap(({ pfad }) => {
    const quelle = VERSIONSQUELLEN.find(([muster]) => muster.test(pfad));
    return quelle ? [quelle[1](lesen(basis, pfad), lesen(kopf, pfad))] : [];
  });
  return { branch, titel, pakete: einmalig(teile.flatMap(({ pakete }) => pakete)), node: einmalig(teile.flatMap(({ node }) => node)) };
}

function istUpdate({ pakete, node, branch }) {
  return pakete.length > 0 || node.length > 0 || String(branch ?? "").startsWith(UPDATE_BRANCH);
}

function migrationsZeilen(text) {
  const zeilen = String(text ?? "").split(/\r?\n/);
  const start = zeilen.indexOf(MIGRATION_KOPF);
  if (start < 0) return [];
  const rest = zeilen.slice(start + 1);
  const ende = rest.findIndex((zeile) => zeile.startsWith(ABSCHNITT_ENDE));
  return ende < 0 ? rest : rest.slice(0, ende);
}

function feldGefuellt(zeilen, feld) {
  const anfang = `${feld}:`;
  return zeilen.some((zeile) => zeile.startsWith(anfang) && zeile.slice(anfang.length).trim() !== "");
}

function migrationsAuszuege(text) {
  const abschnitte = new Map();
  let name;
  for (const zeile of migrationsZeilen(text)) {
    if (zeile.startsWith(PAKET_KOPF)) {
      name = zeile.slice(PAKET_KOPF.length).trim();
      abschnitte.set(name, []);
    } else if (name !== undefined) abschnitte.get(name).push(zeile);
  }
  const vollstaendig = [...abschnitte].filter(([, zeilen]) => PFLICHTFELDER.every((feld) => feldGefuellt(zeilen, feld)));
  return Object.fromEntries(vollstaendig.map(([paket, zeilen]) => [paket, zeilen.join("\n")]));
}

function namenListe(namen) {
  return [...new Set(namen)].join(", ");
}

export function updateBefunde({ pull, reviews, dateien, basis, kopf, lesen = inhaltAn }) {
  const roh = updateRoh({ branch: pull.head.ref, titel: pull.title, dateien, basis, kopf, lesen });
  if (!istUpdate(roh)) return [];
  const mitUrteil = freigabenAufKopf(pull, reviews).map(({ body }) => prueferEingabeBauen({ ...roh, changelogs: migrationsAuszuege(body) }));
  const [beste] = [prueferEingabeBauen(roh), ...mitUrteil].toSorted((links, rechts) => links.fehlend.length - rechts.fehlend.length);
  if (beste.passErlaubt) return [];
  const namen = namenListe(beste.fehlend) || "alle Pakete, die Art ist nicht bestimmbar";
  return [`Update-PR (Art ${beste.art}): kein PASS ohne Migrationsprüfung. Im Approve auf dem aktuellen Stand fehlt unter „${MIGRATION_KOPF}“ der vollständige Abschnitt für: ${namen}.`];
}

export function befundeFuerLauf({ pull, reviews, dateien, imQueue, basis, kopf, lesen }) {
  const schranke = schrankeBefunde({ branch: pull.head.ref, dateien, basis, kopf });
  if (!imQueue) return [...schranke, ...herkunftBefunde(pull, dateien)];
  return [...schranke, ...freigabeBefunde(pull, reviews, dateien), ...updateBefunde({ pull, reviews, dateien, basis, kopf, lesen })];
}

function urteilsVorlage(namen) {
  const abschnitte = [...new Set(namen)].flatMap((name) => [`${PAKET_KOPF}${name}`, ...PFLICHTFELDER.map((feld) => `${feld}: HIER_AUSFUELLEN`)]);
  return [MIGRATION_KOPF, ...abschnitte].join("\n");
}

function updateEingabeAusgeben({ basis, kopf, branch, titel }) {
  const roh = updateRoh({ branch, titel, dateien: geaenderteDateien(basis, kopf), basis, kopf, lesen: inhaltAn });
  if (!istUpdate(roh)) {
    console.log("Kein Update-PR.");
    return;
  }
  const { art, fehlend, text } = prueferEingabeBauen(roh);
  console.log(`Art: ${art}\nPflichtabschnitte: ${namenListe(fehlend) || "keine"}\n\n${text}`);
  if (fehlend.length > 0) console.log(`\n${urteilsVorlage(fehlend)}`);
}

async function main() {
  if (process.argv[2] === "update-eingabe") {
    const [, , , basis, kopf, branch, titel] = process.argv;
    updateEingabeAusgeben({ basis, kopf, branch, titel });
    return;
  }
  if (process.argv[2] === "schranke") {
    const [, , , branch, basis] = process.argv;
    const gefunden = schrankeBefunde({ branch, dateien: geaenderteDateien(basis, undefined), basis, kopf: undefined });
    for (const zeile of gefunden) console.log(zeile);
    process.exitCode = gefunden.length > 0 ? EXIT_ROT : 0;
    return;
  }
  const { pr, basis, kopf } = ereignis();
  const pull = await api(`/pulls/${pr}`);
  const reviews = await alleSeiten(`/pulls/${pr}/reviews`);
  const dateien = geaenderteDateien(basis, kopf);
  const imQueue = kopf !== undefined;
  if (!imQueue) console.log("Das KI-Urteil wird erst in der Merge-Queue verlangt.");
  const gefunden = befundeFuerLauf({ pull, reviews, dateien, imQueue, basis, kopf });
  for (const zeile of gefunden) console.log(zeile);
  if (gefunden.length > 0) process.exitCode = EXIT_ROT;
}

if (realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
