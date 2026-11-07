import http from "node:http";
import crypto from "node:crypto";

import { echtWarten } from "../echt-warten.js";

const HTTP_ACCEPTED = 202;
const NACHFRAGE_TAKT_MS = 50;
const ZUFALLS_BYTES = 24;
export const MELDE_FRIST_MS = 2000;

function alsJson(roh) {
  try {
    return JSON.parse(roh);
  } catch {
    return { unlesbar: roh };
  }
}

export function geheimerPfad() {
  return `/integrations/webhook/geheim${crypto.randomBytes(ZUFALLS_BYTES).toString("hex")}`;
}

export async function starteBetterStackAttrappe({ status = HTTP_ACCEPTED, antwortetNicht = false, koerper = "" } = {}) {
  const verhalten = { status, antwortetNicht, koerper };
  const anfragen = [];
  const abbrueche = [];
  const verbindungen = new Set();
  const server = http.createServer((req, res) => {
    let roh = "";
    req.on("data", (teil) => (roh += teil));
    req.on("end", () => {
      anfragen.push({ methode: req.method, pfad: req.url, art: req.headers["content-type"], koerper: alsJson(roh) });
      if (verhalten.antwortetNicht) return;
      res.writeHead(verhalten.status, { "content-type": "application/json" });
      res.end(verhalten.koerper);
    });
    res.on("close", () => {
      if (!res.writableEnded) abbrueche.push(Date.now());
    });
  });
  server.on("connection", (verbindung) => {
    verbindungen.add(verbindung);
    verbindung.on("close", () => verbindungen.delete(verbindung));
  });
  await new Promise((bereit) => server.listen(0, "127.0.0.1", bereit));
  const pfad = geheimerPfad();
  return {
    url: `http://127.0.0.1:${server.address().port}${pfad}`,
    pfad,
    anfragen,
    abbrueche,
    verhalten,
    leeren() {
      anfragen.length = 0;
      abbrueche.length = 0;
    },
    close: async () => {
      for (const verbindung of verbindungen) verbindung.destroy();
      await new Promise((geschlossen) => server.close(geschlossen));
    },
  };
}

export async function warteBis(bedingung, fristMs = MELDE_FRIST_MS) {
  const ende = Date.now() + fristMs;
  while (!bedingung() && Date.now() < ende) await echtWarten(NACHFRAGE_TAKT_MS);
  return bedingung();
}

export async function warteAufMeldungen(attrappe, anzahl = 1, fristMs = MELDE_FRIST_MS) {
  await warteBis(() => attrappe.anfragen.length >= anzahl, fristMs);
  return attrappe.anfragen.map((anfrage) => anfrage.koerper);
}

export function konsoleMitschreiben() {
  const zeilen = [];
  const echt = { log: console.log, warn: console.warn, error: console.error };
  for (const art of Object.keys(echt)) {
    console[art] = (...teile) => {
      zeilen.push(teile.map((teil) => (teil instanceof Error ? `${teil.name}: ${teil.message}` : String(teil))).join(" "));
      echt[art](...teile);
    };
  }
  return {
    zeilen,
    beenden() {
      Object.assign(console, echt);
    },
  };
}
