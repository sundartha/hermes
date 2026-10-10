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
import { hoertest } from "./deploy-weg/hoertest.mjs";
import { anrufpause } from "./deploy-weg/anrufpause.mjs";
import { staging } from "./deploy-weg/staging.mjs";
import { VORHER, zurueckrollen } from "./deploy-weg/zurueckrollen.mjs";

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

const ARGUMENTE = new Map([
  ["--commit", commitLesen],
  ["--produktion", commitLesen],
  ["--teile", teileLesen],
  ["--frisch-geweckt", jaNeinLesen],
  ["--ziel", zielLesen],
  ["--an", jaNeinLesen],
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
      ausfuehren: ({ einstellungen, werte, ausgabe }) =>
        hoertest({
          einstellungen,
          commit: werte.get("--commit"),
          teile: werte.get("--teile"),
          ausgabe,
        }),
    },
  ],
  [
    "deploy",
    {
      argumente: ["--commit", "--produktion", "--frisch-geweckt"],
      ausfuehren: ({ einstellungen, werte, ausgabe }) =>
        deploy({
          einstellungen,
          commit: werte.get("--commit"),
          produktion: werte.get("--produktion"),
          frischGeweckt: werte.get("--frisch-geweckt"),
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
    "anrufpause",
    {
      argumente: ["--an"],
      ausfuehren: ({ einstellungen, werte, ausgabe }) =>
        anrufpause({ einstellungen, an: werte.get("--an"), ausgabe }),
    },
  ],
]);

function argumenteLesen(rest, erlaubt) {
  if (rest.length !== erlaubt.length * PAAR) return null;
  const werte = new Map();
  for (let i = 0; i < rest.length; i += PAAR) {
    const name = rest[i];
    if (!erlaubt.includes(name) || werte.has(name)) return null;
    const wert = ARGUMENTE.get(name)(rest[i + 1]);
    if (wert === null) return null;
    werte.set(name, wert);
  }
  return werte;
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
  const werte = eintrag === undefined ? null : argumenteLesen(rest, eintrag.argumente);
  if (werte === null) {
    ausgabe.melde("aufruf");
    return false;
  }
  const einstellungen = einstellungenLesen(befehl, env, ausgabe);
  return eintrag.ausfuehren({ einstellungen, werte, ausgabe });
}

async function hauptprogramm() {
  const ausgabe = ausgabeAnlegen();
  let ok = false;
  try {
    ok = (await ausfuehren(ausgabe)) === true;
  } catch (fehler) {
    fehlerMelden(ausgabe, fehler);
  }
  ausgabe.melde("ergebnis", { ok });
  return ok ? EXIT_OK : EXIT_ROT;
}

process.on("unhandledRejection", () => {
  process.exitCode = EXIT_ROT;
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
