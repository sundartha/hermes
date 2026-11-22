import { readFileSync } from "node:fs";
import { argv, env } from "node:process";

import {
  Abbruch,
  ausgabeAnlegen,
  AusgabeVerweigert,
  COMMIT_MUSTER,
  TEIL_MUSTER,
} from "./deploy-weg/ausgabe.mjs";
import { deploy } from "./deploy-weg/deploy.mjs";
import { einstellungenLesen } from "./deploy-weg/einstellungen.mjs";
import { entscheiden } from "./deploy-weg/entscheiden.mjs";
import {
  alarmprobe,
  heartbeatMelden,
  hoertestIssueAnlegenOderErsetzen,
  monatspruefung,
} from "./deploy-weg/hoertest.mjs";
import { anrufpause } from "./deploy-weg/anrufpause.mjs";
import { staging } from "./deploy-weg/staging.mjs";
import { updateNachkontrolle, VORHER, zurueckrollen } from "./deploy-weg/zurueckrollen.mjs";

const EXIT_OK = 0;
const EXIT_ROT = 1;
const ERSTES_ARGUMENT = 2;
const PAAR = 2;
const HOECHSTENS_TEILE = 50;
const ENDE_FRIST_MS = 5000;

function commitLesen(wert) {
  return COMMIT_MUSTER.test(wert) ? wert : null;
}

function zielLesen(wert) {
  return wert === VORHER ? wert : commitLesen(wert);
}

function teileLesen(wert) {
  if (wert === "") return [];
  const teile = wert.split(",");
  const gueltig = teile.length <= HOECHSTENS_TEILE && teile.every((teil) => TEIL_MUSTER.test(teil));
  return gueltig ? teile : null;
}

const JA_NEIN = new Map([
  ["ja", true],
  ["nein", false],
]);

function jaNeinLesen(wert) {
  return JA_NEIN.get(wert) ?? null;
}

function anlassLesen(wert) {
  return wert === "nachtlauf" || wert === "probe" || wert === "staginglauf" ? wert : null;
}

const ZEITPUNKT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function zeitpunktLesen(wert) {
  return ZEITPUNKT.test(wert) ? wert : null;
}

const GRUND_MUSTER = /^probe_uebersprungen_[a-z0-9_]+_fehlt$/;

function grundLesen(wert) {
  return GRUND_MUSTER.test(wert) ? wert : null;
}

const ARGUMENTE = new Map([
  ["--name", anlassLesen],
  ["--commit", commitLesen],
  ["--produktion", commitLesen],
  ["--teile", teileLesen],
  ["--ziel", zielLesen],
  ["--an", jaNeinLesen],
  ["--anlass", anlassLesen],
  ["--seit", zeitpunktLesen],
  ["--grund", grundLesen],
]);

function ereignisLesen(einstellungen) {
  try {
    const nutzlast = JSON.parse(readFileSync(einstellungen.ereignisPfad, "utf8"));
    return { name: einstellungen.ereignisName, nutzlast };
  } catch {
    return { name: einstellungen.ereignisName, nutzlast: null };
  }
}

async function entscheidenAusfuehren({ einstellungen, ausgabe }) {
  const ereignis = ereignisLesen(einstellungen);
  const ergebnis = await entscheiden({ einstellungen, ereignis, ausgabe });
  return ergebnis.ok;
}

const BEFEHLE = new Map([
  [
    "staging",
    {
      argumente: ["--commit"],
      ausfuehren: ({ einstellungen, werte, ausgabe }) =>
        staging({ einstellungen, commit: werte.get("--commit"), ausgabe }),
    },
  ],
  ["entscheiden", { argumente: [], ausfuehren: entscheidenAusfuehren }],
  [
    "hoertest",
    {
      argumente: ["--commit", "--teile"],
      freiwillig: ["--anlass", "--seit", "--grund"],
      ausfuehren: async ({ einstellungen, werte, ausgabe }) => {
        await hoertestIssueAnlegenOderErsetzen({
          einstellungen,
          anlass: werte.get("--anlass"),
          commit: werte.get("--commit"),
          teile: werte.get("--teile"),
          seit: werte.get("--seit"),
          grund: werte.get("--grund"),
          ausgabe,
        });
        return true;
      },
    },
  ],
  [
    "deploy",
    {
      argumente: ["--commit", "--produktion"],
      ausfuehren: ({ einstellungen, werte, ausgabe }) =>
        deploy({
          einstellungen,
          commit: werte.get("--commit"),
          produktion: werte.get("--produktion"),
          ausgabe,
        }),
    },
  ],
  [
    "zurueckrollen",
    {
      argumente: ["--ziel"],
      ausfuehren: ({ einstellungen, werte, ausgabe }) =>
        zurueckrollen({ einstellungen, ziel: werte.get("--ziel"), ausgabe }),
    },
  ],
  [
    "nachkontrolle",
    {
      argumente: ["--commit"],
      ausfuehren: ({ einstellungen, werte, ausgabe }) =>
        updateNachkontrolle({ einstellungen, commit: werte.get("--commit"), ausgabe }),
    },
  ],
  ["alarmprobe", { argumente: [], ausfuehren: alarmprobe }],
  ["pruefung", { argumente: [], ausfuehren: monatspruefung }],
  ["heartbeat", { argumente: ["--name"], ausfuehren: heartbeatMelden }],
  [
    "anrufpause",
    {
      argumente: ["--an"],
      ausfuehren: ({ einstellungen, werte, ausgabe }) =>
        anrufpause({ einstellungen, an: werte.get("--an"), ausgabe }),
    },
  ],
]);

function argumenteLesen(rest, { argumente, freiwillig = [] }) {
  if (rest.length % PAAR !== 0) return null;
  const werte = new Map();
  for (let i = 0; i < rest.length; i += PAAR) {
    const name = rest[i];
    if (![...argumente, ...freiwillig].includes(name) || werte.has(name)) return null;
    const wert = ARGUMENTE.get(name)(rest[i + 1]);
    if (wert === null) return null;
    werte.set(name, wert);
  }
  return argumente.every((name) => werte.has(name)) ? werte : null;
}

function fehlerZeile(fehler) {
  if (fehler instanceof AusgabeVerweigert) return ["ausgabe_verweigert", {}];
  if (!(fehler instanceof Abbruch)) return ["unerwartet", {}];
  if (fehler.http === null) return ["abbruch", { schritt: fehler.schritt }];
  return ["abbruch_http", { schritt: fehler.schritt, http: fehler.http }];
}

function fehlerMelden(ausgabe, fehler) {
  try {
    ausgabe.melde(...fehlerZeile(fehler));
  } catch {
    ausgabe.melde("ausgabe_verweigert");
  }
}

async function ausfuehren(ausgabe) {
  const [befehl, ...rest] = argv.slice(ERSTES_ARGUMENT);
  const eintrag = BEFEHLE.get(befehl);
  const werte = eintrag === undefined ? null : argumenteLesen(rest, eintrag);
  if (werte === null) {
    ausgabe.melde("aufruf");
    return false;
  }
  const einstellungen = einstellungenLesen(befehl, env, ausgabe);
  return eintrag.ausfuehren({ einstellungen, werte, ausgabe });
}

const ausgabe = ausgabeAnlegen();
const ablehnung = { gesehen: false };

async function hauptprogramm() {
  let ok = false;
  try {
    ok = (await ausfuehren(ausgabe)) === true;
  } catch (fehler) {
    fehlerMelden(ausgabe, fehler);
  }
  ok = ok && !ablehnung.gesehen;
  ausgabe.melde("ergebnis", { ok });
  return ok ? EXIT_OK : EXIT_ROT;
}

process.on("unhandledRejection", (grund) => {
  ablehnung.gesehen = true;
  process.exitCode = EXIT_ROT;
  fehlerMelden(ausgabe, grund);
});

hauptprogramm().then(
  (code) => {
    process.exitCode = code;
    setTimeout(() => process.exit(), ENDE_FRIST_MS).unref();
  },
  () => {
    process.exitCode = EXIT_ROT;
  },
);
