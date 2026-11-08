import { spawn } from "node:child_process";

const ALS_EIGENE_PROZESSGRUPPE = { detached: true };
const PROZESS_SCHON_BEENDET = "ESRCH";
export const ABBRUCH_NACHFRIST_MS = 10_000;
const UNBEKANNT = "unbekannt";
const REIHENFOLGE = ["patch", "actions", "minor", "major", "node-hauptversion", "sicherheit"];
const VERSION = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/;
const VORABVERSION = /\d-[0-9A-Za-z]/;
const VERSIONEN = /\d+(?:\.\d+)?(?:\.\d+)?/g;
const TITEL_BUMP = /bump\s+(\S+)\s+from\s+(\S+)\s+to\s+(\S+)/i;
const ACTIONS_BRANCH = "dependabot/github_actions/";

function laeuftNoch(kind) {
  return kind.exitCode === null && kind.signalCode === null;
}

function signalisiere(kind, signal) {
  if (!laeuftNoch(kind)) return;
  try {
    process.kill(-kind.pid, signal);
  } catch (fehler) {
    if (fehler.code !== PROZESS_SCHON_BEENDET) throw fehler;
  }
}

export function starteLauf(argumente, optionen, laeufe) {
  const kind = spawn(process.execPath, argumente, { ...optionen, ...ALS_EIGENE_PROZESSGRUPPE });
  laeufe.add(kind);
  return new Promise((fertig) => kind.on("exit", (code) => fertig(laeufe.delete(kind) && code === 0)));
}

export function beendeRestlaeufe(laeufe) {
  for (const kind of laeufe) {
    signalisiere(kind, "SIGTERM");
    setTimeout(() => signalisiere(kind, "SIGKILL"), ABBRUCH_NACHFRIST_MS).unref();
  }
}

function zerlegen(version) {
  const treffer = VERSION.exec(String(version ?? "").trim());
  if (!treffer) return null;
  return { haupt: Number(treffer[1]), minor: Number(treffer[2] ?? 0), patch: Number(treffer[3] ?? 0) };
}

function sprung(alt, neu) {
  const vorher = zerlegen(alt);
  const nachher = zerlegen(neu);
  if (!vorher || !nachher) return "major";
  if (vorher.haupt !== nachher.haupt) return "major";
  if (vorher.minor !== nachher.minor) return "minor";
  return vorher.patch === nachher.patch ? null : "patch";
}

function artEinesPakets(paket) {
  const stufe = sprung(paket.alt, paket.neu);
  if (stufe === null) return null;
  return stufe === "major" || paket.oekosystem !== "actions" ? stufe : "actions";
}

function nodeVersionen(angabe) {
  return String(angabe ?? "").match(VERSIONEN) ?? [];
}

function artEinerNodeAenderung(aenderung) {
  const vorher = nodeVersionen(aenderung?.alt);
  const nachher = nodeVersionen(aenderung?.neu);
  if ([aenderung?.alt, aenderung?.neu].some((angabe) => VORABVERSION.test(String(angabe ?? "")))) return "node-hauptversion";
  if (vorher.length === 0 || nachher.length !== vorher.length) return "node-hauptversion";
  const haupt = (version) => zerlegen(version).haupt;
  if (vorher.some((version, i) => haupt(version) !== haupt(nachher[i]))) return "node-hauptversion";
  const stufen = vorher.map((version, i) => sprung(version, nachher[i]));
  return hoechste(stufen) === UNBEKANNT ? null : hoechste(stufen);
}

function istObjekt(wert) {
  return typeof wert === "object" && wert !== null;
}

function ausTitel({ titel, branch }) {
  const treffer = TITEL_BUMP.exec(String(titel ?? ""));
  if (!treffer) return [];
  const oekosystem = String(branch ?? "").startsWith(ACTIONS_BRANCH) ? "actions" : "npm";
  return [{ name: treffer[1], alt: treffer[2], neu: treffer[3], oekosystem }];
}

function hoechste(arten) {
  const vorhanden = arten.filter(Boolean);
  if (vorhanden.length === 0) return UNBEKANNT;
  return vorhanden.reduce((stand, art) => (REIHENFOLGE.indexOf(art) > REIHENFOLGE.indexOf(stand) ? art : stand));
}

export function updateArtBestimmen(roh) {
  const eingabe = istObjekt(roh) ? roh : {};
  const pakete = Array.isArray(eingabe.pakete) && eingabe.pakete.length > 0 ? eingabe.pakete : ausTitel(eingabe);
  const node = Array.isArray(eingabe.node) ? eingabe.node : [];
  const art = hoechste([
    ...pakete.filter(istObjekt).map(artEinesPakets),
    ...node.filter(istObjekt).map(artEinerNodeAenderung),
  ]);
  return eingabe.sicherheit === true && art !== UNBEKANNT ? "sicherheit" : art;
}
