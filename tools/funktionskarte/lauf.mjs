import { execFile } from "node:child_process";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";

import { ROUTE_KIND, TOOL_KIND, WEBHOOK_KIND } from "../flaechen.mjs";

const HERMES_CTL = fileURLToPath(new URL("../hermes-ctl.mjs", import.meta.url));
const BEFEHL_FRIST_MS = 90000;
const AUSZUG_ZEICHEN = 300;
const PLATZHALTER = /\{\{([\w.]+)\}\}/g;
const GANZER_PLATZHALTER = /^\{\{([\w.]+)\}\}$/;
const ROUTEN_ARTEN = new Set([ROUTE_KIND, WEBHOOK_KIND]);
const ERSTER_FEHLERSTATUS = 400;
const PARAMETER_ZEICHEN = ":";
const BELIEBIGER_REST = "*";

function hermesCtl(sitzung, argumente) {
  const texte = argumente.map((wert) => (typeof wert === "string" ? wert : JSON.stringify(wert)));
  return new Promise((fertig) => {
    execFile(
      process.execPath,
      [HERMES_CTL, ...texte, "--sitzung", sitzung],
      { timeout: BEFEHL_FRIST_MS },
      (fehler, stdout) => {
        const zeile = stdout.split("\n").find((text) => text.startsWith("{"));
        let ausgabe;
        try {
          ausgabe = JSON.parse(zeile ?? "");
        } catch {
          ausgabe = { ok: false, fehler: `keine JSON-Ausgabe: ${stdout.slice(0, AUSZUG_ZEICHEN)}` };
        }
        fertig({ exit: fehler?.code ?? 0, ausgabe });
      },
    );
  });
}

const wertAn = (objekt, pfad) =>
  pfad
    .split(".")
    .reduce(
      (wert, teil) =>
        wert !== null && typeof wert === "object" && Object.hasOwn(wert, teil)
          ? wert[teil]
          : undefined,
      objekt,
    );

function einsetzen(wert, gemerkt) {
  if (typeof wert === "string") {
    const ganz = GANZER_PLATZHALTER.exec(wert);
    if (ganz) return wertAn(gemerkt, ganz[1]);
    return wert.replace(PLATZHALTER, (_text, pfad) => String(wertAn(gemerkt, pfad)));
  }
  if (Array.isArray(wert)) return wert.map((teil) => einsetzen(teil, gemerkt));
  if (wert !== null && typeof wert === "object") {
    return Object.fromEntries(
      Object.entries(wert).map(([schluessel, teil]) => [schluessel, einsetzen(teil, gemerkt)]),
    );
  }
  return wert;
}

function fehlendePlatzhalter(wert, gemerkt) {
  const pfade = [...JSON.stringify(wert ?? null).matchAll(PLATZHALTER)].map(([, pfad]) => pfad);
  return pfade
    .filter((pfad) => wertAn(gemerkt, pfad) === undefined)
    .map((pfad) => `Platzhalter {{${pfad}}} nennt nichts, was ein früherer Schritt gemerkt hat`);
}

function artVon(wert) {
  if (wert === null) return "null";
  return Array.isArray(wert) ? "array" : typeof wert;
}

function erwartungVerfehlt(ausgabe, erwartung) {
  const ist = wertAn(ausgabe, erwartung.pfad);
  if (ist === undefined) return `${erwartung.pfad} fehlt in der Antwort`;
  if (Object.hasOwn(erwartung, "gleich")) {
    if (JSON.stringify(ist) === JSON.stringify(erwartung.gleich)) return undefined;
    return `${erwartung.pfad} ist ${JSON.stringify(ist)}, erwartet ${JSON.stringify(erwartung.gleich)}`;
  }
  if (Object.hasOwn(erwartung, "enthaelt")) {
    const { enthaelt } = erwartung;
    if (typeof enthaelt !== "string" || enthaelt === "") {
      return `${erwartung.pfad}: „enthaelt“ braucht nach dem Einsetzen einen nicht leeren Text`;
    }
    if (typeof ist === "string" && ist.includes(enthaelt)) return undefined;
    return `${erwartung.pfad} ist ${JSON.stringify(ist)}, enthält nicht ${JSON.stringify(enthaelt)}`;
  }
  const art = artVon(ist);
  return art === erwartung.typ
    ? undefined
    : `${erwartung.pfad} hat Typ ${art}, erwartet ${erwartung.typ}`;
}

function routenMuster(flaechen) {
  return flaechen
    .filter(({ art }) => ROUTEN_ARTEN.has(art))
    .map(({ flaeche, path }) => ({
      flaeche,
      methode: flaeche.split(" ")[0],
      teile: path.split("/"),
    }));
}

function routePasst(musterTeile, pfad) {
  const teile = pfad.split("/");
  for (const [index, teil] of musterTeile.entries()) {
    if (index >= teile.length) return false;
    if (teil === BELIEBIGER_REST) return true;
    const passt = teil.startsWith(PARAMETER_ZEICHEN) ? teile[index] !== "" : teil === teile[index];
    if (!passt) return false;
  }
  return musterTeile.length === teile.length;
}

function pfadBeiHermes(adresse, url) {
  if (typeof adresse !== "string" || !URL.canParse(adresse)) return undefined;
  const ziel = new URL(adresse);
  return ziel.origin === new URL(url).origin ? ziel.pathname : undefined;
}

function prueftFehlerstatus(schritt) {
  return (schritt.erwarte ?? []).some(
    (erwartung) => erwartung.pfad === "status" && typeof erwartung.gleich === "number",
  );
}

function getroffeneFlaechen(aufrufe, schritt, { url, muster, werkzeuge }) {
  const getroffen = new Set();
  const fehlerstatusGeprueft = prueftFehlerstatus(schritt);
  for (const aufruf of aufrufe ?? []) {
    if (aufruf.werkzeug !== undefined) {
      if (!aufruf.abgelehnt && werkzeuge.has(aufruf.werkzeug)) getroffen.add(aufruf.werkzeug);
      continue;
    }
    const pfad = pfadBeiHermes(aufruf.adresse, url);
    if (pfad === undefined) continue;
    if (!(aufruf.status < ERSTER_FEHLERSTATUS) && !fehlerstatusGeprueft) continue;
    const route = muster.find(
      (kandidat) => kandidat.methode === aufruf.methode && routePasst(kandidat.teile, pfad),
    );
    if (route) getroffen.add(route.flaeche);
  }
  return getroffen;
}

function schrittUrteil(schritt, { exit, ausgabe }, gemerkt) {
  if (exit !== 0 || ausgabe.ok !== true) {
    return [
      `hermes-ctl endete mit ${exit}: ${ausgabe.fehler ?? JSON.stringify(ausgabe).slice(0, AUSZUG_ZEICHEN)}`,
    ];
  }
  return einsetzen(schritt.erwarte, gemerkt)
    .map((erwartung) => erwartungVerfehlt(ausgabe, erwartung))
    .filter(Boolean);
}

async function schritteSpielen(karte, sitzung, kontext) {
  const gemerkt = {};
  const hintergrund = new Map();
  const abgedeckt = new Set();
  const befunde = [];
  for (const [index, schritt] of karte.rezept.schritte.entries()) {
    const nummer = index + 1;
    const fehlend = fehlendePlatzhalter([schritt.befehl, schritt.erwarte], gemerkt);
    if (fehlend.length > 0) {
      befunde.push(...fehlend.map((text) => `${karte.pfad} Schritt ${nummer}: ${text}`));
      break;
    }
    if (schritt.hintergrund !== undefined) {
      hintergrund.set(schritt.hintergrund, hermesCtl(sitzung, einsetzen(schritt.befehl, gemerkt)));
      continue;
    }
    const lauf = await (schritt.abwarten === undefined
      ? hermesCtl(sitzung, einsetzen(schritt.befehl, gemerkt))
      : hintergrund.get(schritt.abwarten));
    const verfehlt = schrittUrteil(schritt, lauf, gemerkt);
    if (verfehlt.length > 0) {
      befunde.push(...verfehlt.map((text) => `${karte.pfad} Schritt ${nummer}: ${text}`));
      break;
    }
    if (schritt.merke !== undefined) gemerkt[schritt.merke] = lauf.ausgabe;
    for (const flaeche of getroffeneFlaechen(lauf.ausgabe.aufrufe, schritt, kontext))
      abgedeckt.add(flaeche);
  }
  await Promise.all(hintergrund.values());
  return { abgedeckt, befunde };
}

async function karteSpielen(karte, flaechen) {
  const sitzung = `karte-${basename(karte.pfad, ".md")}-${process.pid}`;
  const beginn = performance.now();
  const start = await hermesCtl(sitzung, ["start"]);
  try {
    if (start.ausgabe.ok !== true) {
      return {
        blockiert: [`${karte.pfad}: hermes-ctl start scheiterte: ${start.ausgabe.fehler}`],
        befunde: [],
      };
    }
    const kontext = {
      url: start.ausgabe.url,
      muster: routenMuster(flaechen),
      werkzeuge: new Set(
        flaechen.filter(({ art }) => art === TOOL_KIND).map(({ flaeche }) => flaeche),
      ),
    };
    const { abgedeckt, befunde } = await schritteSpielen(karte, sitzung, kontext);
    const nichtGeprueft = karte.rezept.flaechen.filter((flaeche) => !abgedeckt.has(flaeche));
    if (befunde.length === 0) {
      befunde.push(
        ...nichtGeprueft.map(
          (flaeche) => `${karte.pfad}: kein Schritt ruft ${flaeche} auf und prüft die Antwort.`,
        ),
      );
    }
    return { blockiert: [], befunde, ms: Math.round(performance.now() - beginn) };
  } finally {
    await hermesCtl(sitzung, ["stopp"]);
  }
}

export async function kartenSpielen(karten, flaechen) {
  const ergebnisse = [];
  for (const karte of karten) {
    ergebnisse.push({ pfad: karte.pfad, ...(await karteSpielen(karte, flaechen)) });
  }
  return ergebnisse;
}
