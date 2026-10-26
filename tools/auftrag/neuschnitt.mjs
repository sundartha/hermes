import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { env, execPath } from "node:process";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { testPrompt } from "./agenten.mjs";
import { BELEGE, GRUEN, ROT, fingerabdruck, schreibeBeleg } from "./bericht.mjs";
import { pruefeNachricht } from "./commitlint.mjs";
import { bereichSchluessel, brauchtRotenTest, istPitchPhase, istTestdatei, ladePhase, phasenBefunde } from "./format.mjs";
import { festhalten, gemeinsamerOrdner, git, kopf, offenePfade, vormerken } from "./git.mjs";
import { freigabeProblem, phasenIssue } from "./issue-freigabe.mjs";
import { kostenDesAuftrags } from "./kosten.mjs";
import { fuehreAus } from "./pruefungen.mjs";
import { MELDUNG, PRUEFUNG, ohneZweck, zweckBlock } from "./zweck.mjs";
import { listHint } from "../testschutz/freigabe.mjs";

export const NEU_GESCHNITTEN = "neu geschnitten";
export const NEUSCHNITTE_JE_AUFTRAG = 1;
export const PLANUNG_VERSUCHE = 2;
const PHASENDATEI = "phase.json";
const PITCH = "pitch.md";
const PFLICHT = [PITCH, "sicherheit.md"];
const DOKUMENTE = ["pitch.md", "design.md", "sicherheit.md"];
const NEUSCHNITT_TEIL = /-n[1-9]\d*(?=-|$)/g;
const NUMMER = /^[1-9]\d*$/;
const PITCH_AENDERN = /^Pitch ändern:\s*(\S.*)$/m;
const EMPFEHLUNG = /^Empfehlung:\s*(\S.*)$/m;
const PASST_NICHT = /^Zerlegung passt nicht:\s*(\S.*)$/m;
const ABDECKUNG = fileURLToPath(new URL("../abdeckung-pruefen.mjs", import.meta.url));
const NEUSCHNITT_START = fileURLToPath(new URL("./planung/neuschnitt-start.mjs", import.meta.url));
const ABLAGE = "auftrag-neuschnitt";
const EINGABE = "eingabe.json";
const ERGEBNIS = "ergebnis.json";
const ERSTER_VERSUCH = 1;
const ZWEITER_VERSUCH = 2;
const EXIT_TEAM_BEFUNDE = 4;
const PHASE_MIT_BEFUNDEN = "die Phase mit dem neuen Schnitt hat Befunde";
const CODEBLOCK = "```";

function abschnitt(titel, zeilen) {
  return ["", `## ${titel}`, "", ...zeilen, ""].join("\n");
}

function planOrt({ phase, phasendatei, root, plan }) {
  if (plan === undefined || !istPitchPhase(phase.phase)) return null;
  const datei = relative(root, resolve(root, phasendatei));
  const ordner = dirname(datei);
  const imRepo = !datei.startsWith("..") && !isAbsolute(datei);
  const vollstaendig = basename(datei) === PHASENDATEI && PFLICHT.every((name) => existsSync(join(root, ordner, name)));
  return imRepo && vollstaendig ? { datei, ordner } : null;
}

export function planbar(kontext) {
  return planOrt(kontext) !== null;
}

function generation(kennung) {
  return (kennung.match(NEUSCHNITT_TEIL) ?? []).length;
}

function istNachfolger(kennung, id) {
  const vorne = `${kennung}-n`;
  return typeof id === "string" && id.startsWith(vorne) && NUMMER.test(id.slice(vorne.length));
}

function zweckAbschnitt(gestoppt, arten) {
  const bloecke = [gestoppt.zweck ?? [], ...arten.map(zweckBlock)].filter((block) => block.length > 0);
  if (bloecke.length === 0) return [];
  return [abschnitt("Wozu die Prüfungen da sind", bloecke.flatMap((block, index) => (index === 0 ? block : ["", ...block])))];
}

function neuschnittPrompt({ phase, auftrag, root, plan }, ort, { gestoppt, befunde, arten = [] }) {
  const dokumente = DOKUMENTE.map((name) => join(ort.ordner, name)).filter((pfad) => existsSync(join(root, pfad)));
  const fertig = [...plan.fertig];
  const vorher = befunde.length > 0
    ? [abschnitt("Befunde zu deinem vorigen Neuschnitt", [CODEBLOCK, ...befunde, CODEBLOCK, "", "Die Phasendatei steht wieder wie vor diesem Neuschnitt."])]
    : [];
  return [
    abschnitt("Neuschnitt", [
      gestoppt.kopf,
      "",
      `Phasendatei: ${ort.datei}`,
      `Freigegebene Dokumente: ${dokumente.join(", ")}`,
      `Schon übernommen: ${fertig.length > 0 ? fertig.join(", ") : "keiner"}`,
      `Die neuen Aufträge heißen ${auftrag.id}-n1, ${auftrag.id}-n2 und so weiter.`,
      "Die Abnahmedatei und die Änderungsdateien der Szenarien bleiben, wie sie sind; die neuen Aufträge übernehmen sie, statt sie umzubenennen.",
    ]),
    testPrompt(phase, auftrag),
    ...zweckAbschnitt(gestoppt, arten),
    abschnitt("Verlauf", [CODEBLOCK, ...gestoppt.verlauf, ...(gestoppt.hinweise ?? []), CODEBLOCK]),
    ...vorher,
  ].join("\n");
}

function zuruecksetzen(root, stand) {
  git(["reset", "-q", "--hard", stand], { cwd: root });
  git(["clean", "-q", "-fd"], { cwd: root });
}

function vorgaengerNachSchnitt(vorher, schnitt) {
  return [...new Set((vorher ?? []).flatMap((id) => (id === schnitt.kennung ? schnitt.neue : [id])))].sort();
}

function unveraendertBefunde(alt, auftraege, schnitt) {
  return alt.auftraege
    .filter(({ id }) => id !== schnitt.kennung)
    .flatMap((vorher) => {
      const jetzt = auftraege.find(({ id }) => id === vorher.id);
      if (jetzt === undefined) return [`${vorher.id} fehlt; ein Neuschnitt ersetzt nur ${schnitt.kennung}.`];
      const soll = { ...vorher, abhaengigVon: vorgaengerNachSchnitt(vorher.abhaengigVon, schnitt) };
      const ist = { ...jetzt, abhaengigVon: [...new Set(jetzt.abhaengigVon ?? [])].sort() };
      return isDeepStrictEqual(soll, ist) ? [] : [`${vorher.id} hat sich geändert; ein Neuschnitt ersetzt nur ${schnitt.kennung}.`];
    });
}

export function saetze(nie) {
  if (Array.isArray(nie)) return nie;
  return nie && typeof nie === "object" ? Object.values(nie) : [];
}

function verbotBefunde(vorher, neue) {
  const weiter = new Set(neue.filter(brauchtRotenTest).flatMap(({ wasDarfNiePassieren }) => saetze(wasDarfNiePassieren)));
  return saetze(vorher.wasDarfNiePassieren)
    .filter((satz) => !weiter.has(satz))
    .map((satz) => `Kein neuer Auftrag mit eigenem Abnahmetest übernimmt aus ${vorher.id} wörtlich: ${satz}`);
}

function vorgaengerBefunde(vorher, neue) {
  const genannt = new Set(neue.flatMap(({ abhaengigVon }) => abhaengigVon ?? []));
  return (vorher.abhaengigVon ?? [])
    .filter((id) => !genannt.has(id))
    .map((id) => `${vorher.id} hing von ${id} ab; das muss auch ein neuer Auftrag in abhaengigVon nennen.`);
}

function entwurfBefunde(alt, neu, kennung) {
  const bereiche = new Set(alt.auftraege.filter(({ id }) => id !== kennung).map(({ bereich }) => bereichSchluessel(bereich)));
  return [...bereiche]
    .filter((bereich) => !isDeepStrictEqual(alt.entwurf?.[bereich], neu.entwurf?.[bereich]))
    .map((bereich) => `Der Entwurf für ${bereich} gehört auch anderen Aufträgen und bleibt, wie er ist.`);
}

function rahmen(phase) {
  return { ...phase, auftraege: undefined, entwurf: undefined };
}

function neueAlteTests(vorher, neue, root) {
  const genannt = new Set([...vorher.erwarteteDateien, vorher.abnahme]);
  const neuAufgenommen = (auftrag, datei) => istTestdatei(datei) && datei !== auftrag.abnahme && !genannt.has(datei) && existsSync(join(root, datei));
  return neue.filter(brauchtRotenTest).flatMap((auftrag) => auftrag.erwarteteDateien.filter((datei) => neuAufgenommen(auftrag, datei)).map((datei) => ({ id: auftrag.id, datei })));
}

function neueAuftraege(alt, neu) {
  const bekannt = new Set(alt.auftraege.map(({ id }) => id));
  return neu.auftraege.filter(({ id }) => !bekannt.has(id));
}

function freigabeBefunde({ phase: alt, auftrag: vorher, root }, neu) {
  const alte = neueAlteTests(vorher, neueAuftraege(alt, neu), root);
  if (alte.length === 0) return [];
  const issue = phasenIssue(alt.issue, root);
  return alte.flatMap(({ id, datei }) => {
    const problem = freigabeProblem(issue, datei);
    if (problem === null) return [];
    return [`${id}: ${datei} ist ein bestehender Test, den ${vorher.id} nicht nannte, und der Test-Agent dürfte ihn ändern. Ein Neuschnitt nimmt ihn nur mit Freigabe auf: Listenpunkt \`${datei}\` ${listHint()}, hier Issue #${alt.issue}. Ohne lesbare Freigabe lehnt er ab: ${problem}.`];
  });
}

function schnittBefunde(alt, neu, vorher) {
  const kennung = vorher.id;
  const neue = neueAuftraege(alt, neu);
  const schnitt = { kennung, neue: neue.map(({ id }) => id) };
  return [
    ...(neu.auftraege.some(({ id }) => id === kennung) ? [`${kennung} steht noch in der Phasendatei; der Neuschnitt ersetzt ihn.`] : []),
    ...(neue.length === 0 ? [`Der Neuschnitt nennt keinen neuen Auftrag statt ${kennung}.`] : []),
    ...neue.filter(({ id }) => !istNachfolger(kennung, id)).map(({ id }) => `${id}: neue Aufträge heißen ${kennung}-n1, ${kennung}-n2 und so weiter.`),
    ...unveraendertBefunde(alt, neu.auftraege, schnitt),
    ...verbotBefunde(vorher, neue),
    ...vorgaengerBefunde(vorher, neue),
    ...entwurfBefunde(alt, neu, kennung),
    ...(isDeepStrictEqual(rahmen(alt), rahmen(neu)) ? [] : ["Außer auftraege und entwurf bleibt die Phasendatei, wie sie ist."]),
  ];
}

function abdeckungBefunde(root, ordner) {
  const lauf = fuehreAus("abdeckung", [execPath, ABDECKUNG, ordner], { cwd: root, env });
  return lauf.exitCode === 0 ? [] : ohneZweck(lauf.ausgabe.split("\n")).filter((zeile) => zeile.trim() !== "");
}

function geschnittenePhase(kontext, ort) {
  const { phase, auftrag, root } = kontext;
  const fremd = offenePfade(root).filter((pfad) => pfad !== ort.datei);
  if (fremd.length > 0) return { befunde: [`Der Planer darf nur ${ort.datei} ändern, nicht ${fremd.join(", ")}.`], arten: [MELDUNG.NEUSCHNITT] };
  let neu;
  try {
    neu = ladePhase(join(root, ort.datei));
  } catch (fehler) {
    return { befunde: [`${ort.datei} ist nicht lesbar: ${fehler.message}`], arten: [MELDUNG.PHASENDATEI] };
  }
  const format = phasenBefunde(neu, root);
  if (format.length > 0) return { befunde: format, arten: [MELDUNG.PHASENDATEI] };
  const schnitt = [...schnittBefunde(phase, neu, auftrag), ...freigabeBefunde(kontext, neu)];
  const abdeckung = abdeckungBefunde(root, ort.ordner);
  const arten = [[MELDUNG.NEUSCHNITT, schnitt], [MELDUNG.ABDECKUNG, abdeckung]].filter(([, liste]) => liste.length > 0).map(([art]) => art);
  return arten.length > 0 ? { befunde: [...schnitt, ...abdeckung], arten } : { neu };
}

function nachfolger(neu, kennung) {
  return neu.auftraege.filter(({ id }) => istNachfolger(kennung, id)).map(({ id, bereich }) => ({ id, bereich }));
}

function commitNachricht({ phase, auftrag }, gestoppt, neu) {
  const neue = nachfolger(neu, auftrag.id).map(({ id }) => id);
  return [
    `Schneide den Auftrag ${auftrag.id} neu`,
    "",
    `Warum: ${gestoppt.kopf}`,
    `Der Planer ersetzt ihn durch ${neue.join(", ")}; pruefe und die Abdeckungsprüfung sind grün.`,
    "",
    `Auftrag: ${phase.phase}/${auftrag.id}`,
    ...(phase.paket ? [`Paket: ${phase.paket}`] : []),
    "",
  ].join("\n");
}

function uebernimm(kontext, ort, { gestoppt, neu }) {
  const nachricht = commitNachricht(kontext, gestoppt, neu);
  const pruefung = pruefeNachricht(nachricht, kontext.root);
  if (pruefung.exitCode !== 0) return { befunde: [`commitlint lehnt die Nachricht des Neuschnitts ab:\n${pruefung.ausgabe.trimEnd()}`], arten: [PRUEFUNG.COMMITLINT] };
  vormerken([ort.datei], kontext.root);
  const lauf = festhalten(nachricht, kontext.root);
  if (lauf.status === 0) return { neu };
  return { befunde: [`git commit des Neuschnitts endete mit Exit ${lauf.status}: ${lauf.stderr.trim()}`] };
}

function ohneSchnitt(antwort) {
  const frage = PITCH_AENDERN.exec(antwort)?.[1];
  const empfehlung = EMPFEHLUNG.exec(antwort)?.[1];
  if (frage !== undefined && empfehlung !== undefined) return { frage, empfehlung };
  if (frage !== undefined) return { befunde: ["Zu „Pitch ändern: …“ fehlt die Zeile „Empfehlung: …“."] };
  const passtNicht = PASST_NICHT.exec(antwort)?.[1];
  return passtNicht === undefined ? null : { passtNicht };
}

function auswerten(kontext, ort, { lauf, gestoppt }) {
  const antwort = ohneSchnitt(lauf.antwort ?? "");
  if (antwort !== null) return antwort;
  if (lauf.grund) return { befunde: [lauf.grund] };
  if (lauf.exitCode !== 0) return { befunde: [`Der Planer endete mit Exit ${lauf.exitCode}.`] };
  const geschnitten = geschnittenePhase(kontext, ort);
  return geschnitten.neu ? uebernimm(kontext, ort, { gestoppt, neu: geschnitten.neu }) : geschnitten;
}

function eingriffBefunde(root, stand) {
  return [
    ...(kopf(root) === stand.kopf ? [] : ["Der Planer darf nicht committen; der Lauf setzt auf den Stand vor ihm zurück."]),
    ...(fingerabdruck(root) === stand.belege ? [] : [`Der Planer hat ${BELEGE}/ verändert.`]),
  ];
}

function ablageDes({ phase, auftrag, root }) {
  return gemeinsamerOrdner(root, ABLAGE, phase.phase, auftrag.id);
}

function teamEingabe(kontext, ort, vorher) {
  const { root, auftrag, plan } = kontext;
  const { gestoppt } = vorher;
  return {
    root,
    ordner: ort.ordner,
    datei: ort.datei,
    auftragId: auftrag.id,
    fertig: [...plan.fertig],
    anlass: gestoppt.kopf,
    kopf: neuschnittPrompt(kontext, ort, vorher),
    verlauf: gestoppt.verlauf,
    hinweise: gestoppt.hinweise ?? [],
  };
}

function teamErgebnis(versuch, status) {
  try {
    return JSON.parse(readFileSync(join(versuch, ERGEBNIS), "utf8"));
  } catch {
    return { exitCode: status ?? 1, grund: `Der Neuschnitt des Teams endete ohne Ergebnis (Exit ${status}).`, sitzungen: [] };
  }
}

function planeMitTeam(kontext, ort, vorher) {
  const ablage = ablageDes(kontext);
  const nummer = vorher.befunde.length === 0 ? ERSTER_VERSUCH : ZWEITER_VERSUCH;
  if (nummer === ERSTER_VERSUCH) rmSync(ablage, { recursive: true, force: true });
  const versuch = join(ablage, `versuch-${nummer}`);
  mkdirSync(versuch, { recursive: true });
  writeFileSync(join(versuch, EINGABE), JSON.stringify(teamEingabe(kontext, ort, vorher)));
  const kind = spawnSync(execPath, [env.HERMES_NEUSCHNITT_START ?? NEUSCHNITT_START, versuch], { cwd: kontext.root, env, stdio: ["ignore", "inherit", "inherit"] });
  return teamErgebnis(versuch, kind.status);
}

function teamArten(lauf) {
  if (lauf.exitCode !== EXIT_TEAM_BEFUNDE) return [];
  return lauf.planung?.grund === PHASE_MIT_BEFUNDEN ? [MELDUNG.NEUSCHNITT, MELDUNG.PHASENDATEI, MELDUNG.ABDECKUNG] : [MELDUNG.NEUSCHNITT];
}

function planeNeu(kontext, ort, vorher) {
  const { root } = kontext;
  const stand = { kopf: kopf(root), belege: fingerabdruck(root) };
  const lauf = planeMitTeam(kontext, ort, vorher);
  let ergebnis = { befunde: ["Die Auswertung des Neuschnitts brach ab."] };
  try {
    const eingriff = eingriffBefunde(root, stand);
    ergebnis = eingriff.length > 0 ? { befunde: eingriff } : auswerten(kontext, ort, { lauf, gestoppt: vorher.gestoppt });
  } finally {
    if (!ergebnis.neu) zuruecksetzen(root, stand.kopf);
  }
  const arten = ergebnis.befunde && ergebnis.arten === undefined ? { arten: teamArten(lauf) } : {};
  return { ...ergebnis, ...arten, planung: lauf.planung, sitzungen: lauf.sitzungen ?? [] };
}

function pitchFrage({ phase, auftrag }, gestoppt, versuch) {
  const anlass = `Der Planer kann den Auftrag ${auftrag.id} der Phase ${phase.phase} nur neu schneiden, wenn sich der Pitch ändert.`;
  const notiz = `Pitch ändern: ${versuch.frage}\nEmpfehlung: ${versuch.empfehlung}\n\n(Volle Antwort des Planers: Sitzung ${versuch.sitzungen.at(-1).sitzung})`;
  return { ...gestoppt, kopf: `${anlass}\n\n${gestoppt.kopf}`, notiz, sitzungen: versuch.sitzungen };
}

function versuchsZeilen(versuch, nummer) {
  if (versuch.passtNicht !== undefined) return [`Neuschnitt ${nummer}: Zerlegung passt nicht: ${versuch.passtNicht}`];
  return [`Neuschnitt ${nummer}: abgelehnt`, ...versuch.befunde];
}

function ohneErfolgSatz(letzter) {
  return letzter.passtNicht === undefined
    ? "Der Planer hat den Auftrag nicht so neu geschnitten, dass pruefe und die Abdeckungsprüfung grün sind."
    : "Der Planer meldet, dass sich der Auftrag mit den freigegebenen Dokumenten nicht neu schneiden lässt.";
}

function ohneErfolg(gestoppt, versuche) {
  const satz = ohneErfolgSatz(versuche.at(-1));
  return { ...gestoppt, kopf: `${gestoppt.kopf}\n\n${satz}`, verlauf: [...gestoppt.verlauf, ...versuche.flatMap((versuch, index) => versuchsZeilen(versuch, index + 1))] };
}

function grenzeErreicht(gestoppt) {
  const satz = `Der Auftrag stammt schon aus einem Neuschnitt; höchstens ${NEUSCHNITTE_JE_AUFTRAG} Neuschnitt je Auftrag, danach entscheidet der Nutzer.`;
  return { ...gestoppt, kopf: `${gestoppt.kopf}\n\n${satz}` };
}

function endetDieVersuche(versuch) {
  return Boolean(versuch.neu) || [versuch.frage, versuch.passtNicht].some((feld) => feld !== undefined);
}

function versuche(kontext, ort, gestoppt) {
  const liste = [];
  while (liste.length < PLANUNG_VERSUCHE) {
    const vorher = liste.at(-1);
    const versuch = planeNeu(kontext, ort, { gestoppt, befunde: vorher?.befunde ?? [], arten: vorher?.arten ?? [] });
    liste.push(versuch);
    if (endetDieVersuche(versuch)) break;
  }
  return liste;
}

function belege(kontext, gestoppt, liste) {
  const { phase, auftrag, root } = kontext;
  const agenten = liste.flatMap(({ sitzungen }) => sitzungen);
  schreibeBeleg(root, {
    phase: phase.phase,
    auftrag: `${auftrag.id}-neuschnitt`,
    ergebnis: liste.at(-1).neu ? GRUEN : ROT,
    grund: gestoppt.kopf,
    bereich: auftrag.bereich,
    versuche: liste.map(({ frage, empfehlung, passtNicht, befunde, neu, planung }) => ({ frage, empfehlung, passtNicht, befunde, neu: neu && nachfolger(neu, auftrag.id), planung })),
    agenten,
    kosten: kostenDesAuftrags(root, agenten),
    zeit: new Date().toISOString(),
  });
}

export function schneideNeu(kontext, gestoppt) {
  const ort = planOrt(kontext);
  if (generation(kontext.auftrag.id) >= NEUSCHNITTE_JE_AUFTRAG) return { gestoppt: grenzeErreicht(gestoppt) };
  const liste = versuche(kontext, ort, gestoppt);
  belege(kontext, gestoppt, liste);
  const letzter = liste.at(-1);
  if (letzter.neu) {
    console.log(`Auftrag ${kontext.auftrag.id}: ${NEU_GESCHNITTEN}, weiter mit den Aufträgen des Neuschnitts.`);
    return { neu: letzter.neu };
  }
  if (letzter.frage !== undefined) return { gestoppt: pitchFrage(kontext, gestoppt, letzter) };
  return { gestoppt: ohneErfolg(gestoppt, liste) };
}
