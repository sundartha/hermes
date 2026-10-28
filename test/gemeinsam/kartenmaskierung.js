import { before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, mcpPost, toolCall, readToolResult, seedCall, seedState } from "../helpers.js";
import { PASSWORT_BEISPIEL } from "./erfundene-geheimnisse.js";

export const AGENT = "agent";
export const COUNTERPARTY = "counterparty";

const PIN = "PIN: 4711";
const PIN_KENNWORT = "PIN: ";
const PIN_WERT = "4711";
export const PASSWORT_KENNWORT = "password: ";
const PASSWORT =PASSWORT_KENNWORT + PASSWORT_BEISPIEL;

const RUNTIME_BUDGET_MS = 2000;
const HOECHSTE_KARTENZIFFERN = 19;
const KARTENANFANG = /^[2-6]/;
const MASKEN = /\*{4}\d{0,4}|\[restricted-credential\]|\[restricted-government-id\]/g;

export const MEGABYTE_CHARS = 1000000;

export function einzeln(ziffern, trenner = " ") {
  return ziffern.split("").join(trenner);
}

export function luhnGueltig(ziffern) {
  let summe = 0;
  for (const [position, zeichen] of [...ziffern].reverse().entries()) {
    let wert = Number(zeichen);
    if (position % 2 === 1) {
      wert *= 2;
      if (wert > 9) wert -= 9;
    }
    summe += wert;
  }
  return summe % 10 === 0;
}

export function hatLuhnFensterMitKartenanfang(ziffern, mindestLaenge) {
  for (let start = 0; start < ziffern.length; start += 1) {
    for (let laenge = mindestLaenge; laenge <= HOECHSTE_KARTENZIFFERN; laenge += 1) {
      const fenster = ziffern.slice(start, start + laenge);
      if (fenster.length === laenge && KARTENANFANG.test(fenster) && luhnGueltig(fenster)) return true;
    }
  }
  return false;
}

export function fuelltext(laenge) {
  let text = "";
  while (laenge - text.length >= 9) text += "Termin ";
  return text + "a".repeat(laenge - text.length - 1) + " ";
}

export function textMitAngabeAb(stelle, angabe, nachtext) {
  return fuelltext(stelle) + angabe + nachtext;
}

export function stellen(von, bis) {
  return Array.from({ length: bis - von + 1 }, (_, index) => von + index);
}

export function ohneMasken(text) {
  return text.replace(MASKEN, "");
}

export function geheimnisseAnDerGrenze(von, bis, anrufMitAngabeAb) {
  const geheimnisse = [
    { angabe: PIN, kennwort: PIN_KENNWORT, wert: PIN_WERT },
    { angabe: PASSWORT, kennwort: PASSWORT_KENNWORT, wert: PASSWORT_BEISPIEL },
  ];
  return geheimnisse.flatMap((geheimnis) =>
    stellen(von, bis).flatMap((stelle) => [
      { ...geheimnis, ...anrufMitAngabeAb(stelle, geheimnis.angabe) },
      { ...geheimnis, ...anrufMitAngabeAb(stelle - geheimnis.kennwort.length, geheimnis.angabe) },
    ]),
  );
}

export function abgeschlossenerAnruf(felder) {
  return seedCall({
    status: "completed",
    answeredAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    ...felder,
  });
}

export function anrufeJeGruppe(praefix, gruppen, zielNummer) {
  return Object.fromEntries(
    Object.entries(gruppen).map(([gruppe, zeilen]) => [
      gruppe,
      zeilen.map(([role, text], index) =>
        abgeschlossenerAnruf({
          id: `${praefix}_${gruppe}_${index}`,
          direction: "outbound",
          to: zielNummer,
          transcript: [{ role, text }],
          summary: text,
          objectiveAchieved: true,
          inboxEntryAt: new Date().toISOString(),
          from: zielNummer,
        }),
      ),
    ]),
  );
}

export function anrufeJeZeile(praefix, zeilen) {
  return zeilen.map(([role, text], index) =>
    abgeschlossenerAnruf({ id: `${praefix}_${index}`, transcript: [{ role, text }] }),
  );
}

export function bestaetigungsServerOptionen(anrufe, bestaetigungsGeheimnis) {
  return {
    env: {
      FAKE_ORIGINATE: "true",
      ALLOWED_COUNTRY_CODES: "*",
      MCP_UI_ENABLED: "true",
      CALL_CONFIRMATION_SECRET: bestaetigungsGeheimnis,
    },
    seed: seedState({ calls: Object.values(anrufe).flat() }),
  };
}

export function starteServer(optionen) {
  const server = {};
  before(async () => {
    Object.assign(server, await startServer(optionen()));
  });
  after(async () => {
    await server.stop();
  });
  return server;
}

export async function rufeWerkzeug(server, name, args) {
  return readToolResult(await mcpPost(`${server.localUrl}/mcp`, null, toolCall(name, args)));
}

export async function ausgabezeilen(server, callId) {
  const result = await rufeWerkzeug(server, "get_call_status", { call_id: callId });
  return result.structuredContent.last_transcript_lines;
}

export async function einzigeAusgabezeile(server, callId) {
  const lines = await ausgabezeilen(server, callId);
  assert.equal(lines.length, 1);
  return lines[0];
}

export function pruefeMaskiert(zeileZuIndex, offset, liste) {
  return async () => {
    for (const [position, [, text, erwartet]] of liste.entries()) {
      const line = await zeileZuIndex(offset + position);
      assert.ok(line.endsWith(erwartet), `Kartennummer im Klartext: ${line} (Eingabe: ${text})`);
    }
  };
}

export async function pruefeNummerNichtGanzImKlartext(anrufe, felderVon, { ziffern, gruppiert, meldung }) {
  for (const anruf of anrufe) {
    for (const feld of await felderVon(anruf)) {
      assert.ok(!feld.replace(/\D/g, "").includes(ziffern), meldung);
      assert.ok(!feld.includes(gruppiert), meldung);
    }
  }
}

export function assertUnveraendertInnerhalbDerGrenze(maskiere, text) {
  const started = Date.now();
  const masked = maskiere(text);
  assert.ok(Date.now() - started < RUNTIME_BUDGET_MS, "kein exponentielles Verhalten");
  assert.equal(masked, text);
}
