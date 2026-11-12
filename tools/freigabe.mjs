import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { APPROVERS, alleSeiten, api, ereignis, fremdeApi, geaenderteDateien, gepruefteAdvisories, inhaltAn, queueEintraege } from "./github.mjs";
import { BESTAENDE, bestandAuf, gewachseneEintraege } from "./pruefen.mjs";
import { NODE_JA_TEXT, NODE_LABEL, NOT_AUS_ABFRAGE, PAUSE_LABEL, nodeListeLesen, nodeLtsSeit, prueferEingabeBauen, updateArtBestimmen } from "./mutation-laeufe.mjs";

const BAU_AGENT = "sundartha-agent[bot]";
const PRODUKTCODE = "src/";
const FREIGEGEBEN = "APPROVED";
const KURZ = 7;
export const SYSTEM_BRANCH = /^(?:system|dependabot)\//;
export const PRUEFREGELN = [
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
const PLATZHALTER = "HIER_AUSFUELLEN";
const NODE_ZEILE = /\bnode-version:[ \t]*["']?(\d[\w.-]*)/g;
const NODE_STANDARD = /^([ \t]+)node-version:[ \t]*\r?\n(?:\1[ \t]+\S[^\r\n]*\r?\n)*\1[ \t]+default:[ \t]*["']?(\d[\w.-]*)/gm;
const USES_ZEILE = /\buses:[ \t]*["']?([^\s"'@]+)@([^\s"'#]+)/g;
const WARTE_KURZ_TAGE = 7;
const WARTE_LANG_TAGE = 14;
const NPM_WARTE_TAGE = new Map([["patch", WARTE_KURZ_TAGE], ["minor", WARTE_KURZ_TAGE], ["major", WARTE_LANG_TAGE]]);
const ACTIONS_WARTE_TAGE = WARTE_LANG_TAGE;
const NODE_ART = "node-hauptversion";
const NODE_WARTE_TAGE = 14;
const NODE_JA_LOGIN = "Antonio20045";
const TAG_MS = 86_400_000;
const NPM_REGISTRY = "https://registry.npmjs.org";
const NPM_FRIST_MS = 30_000;
const FREMD_SEITE = 100;
const VORAUS_STATUS = new Set(["ahead", "identical"]);
const PAKET_DATEI = /(?:^|\/)package(?:-lock)?\.json$/;
const PAKET_JSON = /(?:^|\/)package\.json$/;
const COMMIT_SHA = /^[0-9a-f]{40}$/;
const NODE_UNTERGRENZE = /^[^<]*\d/;
const NPM = "npm";

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
      const bestand = BESTAENDE.find((eintrag) => eintrag.datei === pfad && pfad.startsWith("tools/basis/"));
      if (bestand) return gewachseneEintraege(bestandAuf(basis, bestand), bestandAuf(kopf ?? null, bestand)).length > 0;
      return true;
    })
    .map(({ pfad }) => `${pfad}: Prüfregel auf Branch ${branch}. ${SCHRANKE_AUSWEG}`);
}

function freigabenAufKopf(pull, reviews) {
  return letzteUrteile(reviews).filter(({ state, commit_id: stand }) => state === FREIGEGEBEN && stand === pull.head.sha);
}

function approvesAufKopf(pull, reviews) {
  const jeAutor = new Map();
  for (const review of reviews) {
    const login = review.user?.login;
    if (!APPROVERS.includes(login) || review.state === "COMMENTED") continue;
    if (review.state === FREIGEGEBEN && review.commit_id === pull.head.sha) jeAutor.set(login, [...(jeAutor.get(login) ?? []), review]);
    else jeAutor.delete(login);
  }
  return [...jeAutor.values()].flat();
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
  const text = String(inhalt ?? "");
  const direkt = [...text.matchAll(NODE_ZEILE)].map(([, wert]) => wert);
  const standard = [...text.matchAll(NODE_STANDARD)].map(([, , wert]) => wert);
  return einmaligSortiert([...direkt, ...standard]);
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

function wertGefuellt(wert) {
  return wert !== "" && !wert.includes(PLATZHALTER);
}

function feldGefuellt(zeilen, feld) {
  const anfang = `${feld}:`;
  return zeilen.some((zeile) => zeile.startsWith(anfang) && wertGefuellt(zeile.slice(anfang.length).trim()));
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
  const mitUrteil = approvesAufKopf(pull, reviews).map(({ body }) => prueferEingabeBauen({ ...roh, changelogs: migrationsAuszuege(body) }));
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

function hatLabel(pull, name) {
  return (pull.labels ?? []).some((label) => label.name === name);
}

function istUpdatePull(pull) {
  return String(pull.head?.ref ?? "").startsWith(UPDATE_BRANCH) || hatLabel(pull, NODE_LABEL);
}

function wartetageVon(paket) {
  return paket.oekosystem === "actions" ? ACTIONS_WARTE_TAGE : NPM_WARTE_TAGE.get(updateArtBestimmen({ pakete: [paket] }));
}

async function paketAlterBefund(paket, { quellen, jetzt }) {
  const tage = wartetageVon(paket);
  const zeiten = [];
  for (const stand of String(paket.neu).split(" ")) zeiten.push(Date.parse(await quellen.veroeffentlicht(paket.oekosystem, paket.name, stand)));
  if (tage === undefined || zeiten.some(Number.isNaN)) return [`Update-PR: Alter von ${paket.name} ${paket.neu} nicht bestimmbar.`];
  if (jetzt - Math.max(...zeiten) >= tage * TAG_MS || (await quellen.ersterFix(paket))) return [];
  return [`Update-PR: ${paket.name} ${paket.neu} ist jünger als ${tage} Tage.`];
}

async function alterBefunde(roh, umfeld) {
  const befunde = [];
  for (const paket of roh.pakete) befunde.push(...(await paketAlterBefund(paket, umfeld)));
  return befunde;
}

function hatAntoniosJa(pull, reviews) {
  return approvesAufKopf(pull, reviews).some(({ user, body }) => user.login === NODE_JA_LOGIN && String(body ?? "").trim() === NODE_JA_TEXT);
}

function nodeStaende(wert) {
  return String(wert).split(/\s+/).filter((teil) => NODE_UNTERGRENZE.test(teil));
}

function geaenderteNodeStaende({ alt, neu }) {
  const vorher = new Set(nodeStaende(alt));
  const staende = nodeStaende(neu);
  const geaendert = staende.filter((stand) => !vorher.has(stand));
  return geaendert.length > 0 ? geaendert : staende;
}

function nodeZielHaupt(node) {
  return Math.max(...node.flatMap(geaenderteNodeStaende).map((stand) => Number(/\d+/.exec(stand)[0])));
}

async function ltsBefunde(roh, { quellen, jetzt }) {
  const haupt = nodeZielHaupt(roh.node);
  const seit = Number.isFinite(haupt) ? Date.parse(await quellen.nodeLtsSeit(haupt)) : Number.NaN;
  if (Number.isNaN(seit)) return ["Node-Hauptversion: das Datum der Active LTS ist nicht bestimmbar."];
  return jetzt - seit < NODE_WARTE_TAGE * TAG_MS ? [`Node ${haupt}: noch nicht ${NODE_WARTE_TAGE} Tage Active LTS.`] : [];
}

async function nodeBefunde({ roh, pull, reviews, umfeld }) {
  const label = hatLabel(pull, NODE_LABEL);
  if (updateArtBestimmen(roh) !== NODE_ART && !label) return [];
  const befunde = label ? [] : [`Node-Hauptversion ohne Label ${NODE_LABEL}.`];
  if (!hatAntoniosJa(pull, reviews)) befunde.push(`Node-Hauptversion braucht Antonios Ja: ein Approve auf dem Stand ${pull.head.sha.slice(0, KURZ)} mit genau dem Text „${NODE_JA_TEXT}“.`);
  return [...befunde, ...(await ltsBefunde(roh, umfeld))];
}

async function zweitesUpdateBefunde(pull, { quellen }) {
  for (const { pr, sha } of await quellen.queueEintraege()) {
    if (pr !== pull.number && (await quellen.liegtVor(sha)) && istUpdatePull(await quellen.pull(pr))) return [`Update-PR wartet: #${pr} ist noch in der Merge-Queue, höchstens ein Update zur Zeit.`];
  }
  return [];
}

function eigenePaketDateien(dateien) {
  return new Set(dateien.map(({ pfad }) => pfad).filter((pfad) => PAKET_DATEI.test(pfad)).map((pfad) => pfad.replace("package-lock.json", "package.json")));
}

async function ueberschneidungBefunde(pull, dateien, { quellen }) {
  const eigene = eigenePaketDateien(dateien);
  if (eigene.size === 0) return [];
  const andere = (await quellen.offenePRs()).filter((anderer) => anderer.number !== pull.number && !istUpdatePull(anderer));
  const befunde = [];
  for (const { number } of andere) {
    const gemeinsam = (await quellen.dateienVon(number)).filter((pfad) => PAKET_JSON.test(pfad) && eigene.has(pfad));
    if (gemeinsam.length > 0) befunde.push(`Update-PR wartet: der offene PR #${number} ändert ebenfalls ${namenListe(gemeinsam)}.`);
  }
  return befunde;
}

async function notAusBefunde({ quellen }) {
  const [gesetzt] = await quellen.notAus();
  return gesetzt ? [`Update-PR wartet: Not-Aus, Label ${PAUSE_LABEL} an #${gesetzt.number}.`] : [];
}

async function updateMergeBefunde({ pull, reviews, dateien, basis, kopf, lesen, umfeld }) {
  const roh = updateRoh({ branch: pull.head.ref, titel: pull.title, dateien, basis, kopf, lesen });
  if (!istUpdate(roh)) return [];
  return [
    ...(await notAusBefunde(umfeld)),
    ...(await nodeBefunde({ roh, pull, reviews, umfeld })),
    ...(await alterBefunde(roh, umfeld)),
    ...(await zweitesUpdateBefunde(pull, umfeld)),
    ...(await ueberschneidungBefunde(pull, dateien, umfeld)),
  ];
}

export async function laufBefunde({ pull, reviews, dateien, imQueue, basis, kopf, lesen = inhaltAn, quellen, jetzt = Date.now() }) {
  const gefunden = befundeFuerLauf({ pull, reviews, dateien, imQueue, basis, kopf, lesen });
  if (!imQueue) return gefunden;
  return [...gefunden, ...(await updateMergeBefunde({ pull, reviews, dateien, basis, kopf, lesen, umfeld: { quellen, jetzt } }))];
}

async function npmZeit(name, version) {
  const antwort = await fetch(`${NPM_REGISTRY}/${encodeURIComponent(name).replace(/^%40/, "@")}`, { signal: AbortSignal.timeout(NPM_FRIST_MS) });
  if (!antwort.ok) throw new Error(`npm-Registry ${name}: HTTP ${antwort.status}`);
  return (await antwort.json()).time?.[version];
}

async function actionTags(repo, stand) {
  if (!COMMIT_SHA.test(stand)) return new Set([stand]);
  const tags = await fremdeApi(repo, `/tags?per_page=${FREMD_SEITE}`);
  return new Set(tags.filter(({ commit }) => commit.sha === stand).map(({ name }) => name));
}

async function actionRelease(repo, stand) {
  const tags = await actionTags(repo, stand);
  const releases = await fremdeApi(repo, `/releases?per_page=${FREMD_SEITE}`);
  return releases.find(({ tag_name: tag, published_at: seit }) => tags.has(tag) && seit)?.published_at;
}

async function actionZeit(name, stand) {
  const [besitzer, eigenerName] = name.split("/");
  const repo = `${encodeURIComponent(besitzer)}/${encodeURIComponent(eigenerName)}`;
  const release = await actionRelease(repo, stand);
  return release ?? (await fremdeApi(repo, `/commits/${encodeURIComponent(stand)}`)).commit?.committer?.date;
}

function behebtAdvisory({ withdrawn_at: zurueckgezogen, vulnerabilities }, name, neu) {
  return zurueckgezogen === null && vulnerabilities.some(({ package: paket, first_patched_version: fix }) => paket.ecosystem === NPM && paket.name === name && fix === neu);
}

async function ersterFix({ oekosystem, name, alt, neu }) {
  if (oekosystem !== NPM) return false;
  return (await gepruefteAdvisories(`${name}@${alt}`)).some((advisory) => behebtAdvisory(advisory, name, neu));
}

export function echteQuellen(pull, gruppenKopf) {
  return {
    veroeffentlicht: (oekosystem, name, stand) => (oekosystem === "actions" ? actionZeit(name, stand) : npmZeit(name, stand)),
    ersterFix,
    nodeLtsSeit: async (haupt) => nodeLtsSeit(await nodeListeLesen(), haupt),
    queueEintraege: () => queueEintraege(pull.base.ref),
    liegtVor: async (sha) => VORAUS_STATUS.has((await api(`/compare/${sha}...${gruppenKopf}`)).status),
    pull: (nummer) => api(`/pulls/${nummer}`),
    offenePRs: () => alleSeiten("/pulls?state=open"),
    dateienVon: async (nummer) => (await alleSeiten(`/pulls/${nummer}/files`)).map(({ filename }) => filename),
    notAus: () => api(`/${NOT_AUS_ABFRAGE}`),
  };
}

function urteilsVorlage(namen) {
  const abschnitte = [...new Set(namen)].flatMap((name) => [`${PAKET_KOPF}${name}`, ...PFLICHTFELDER.map((feld) => `${feld}: ${PLATZHALTER}`)]);
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
  const { pr, basis, kopf, gruppenKopf } = ereignis();
  const pull = await api(`/pulls/${pr}`);
  const reviews = await alleSeiten(`/pulls/${pr}/reviews`);
  const dateien = geaenderteDateien(basis, kopf);
  const imQueue = kopf !== undefined;
  if (!imQueue) console.log("Das KI-Urteil wird erst in der Merge-Queue verlangt.");
  const gefunden = await laufBefunde({ pull, reviews, dateien, imQueue, basis, kopf, quellen: echteQuellen(pull, gruppenKopf) });
  for (const zeile of gefunden) console.log(zeile);
  if (gefunden.length > 0) process.exitCode = EXIT_ROT;
}

if (realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
