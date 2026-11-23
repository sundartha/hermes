import assert from "node:assert/strict";

import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { anrufAnBis, mitZweiHermesAufPostgres, neueAnrufe } from "./hermes-mit-postgres.js";

const HTTP_OK = 200;
const ENDSTAND = "cancelled";

export const ZIEL_DER_ANRUFE = neueAnrufe().ziel();

export async function mitZweiSchreibern(t, lauf) {
  await mitZweiHermesAufPostgres(t, { env: {} }, async (umgebung) => {
    const anrufe = neueAnrufe();
    const gestartet = (anruf) => Boolean(anruf.konversation);
    const platziere = async (instanz, to) => {
      const antwort = await anrufe.rufeAn(instanz, { to });
      assert.equal(antwort.status, HTTP_OK);
      const { callId } = await antwort.json();
      await anrufAnBis(umgebung.sql, { ziel: to, genug: gestartet });
      return callId;
    };
    await lauf({ ...umgebung, platziere });
  });
}

const holeVon = (instanz, pfad) => abrufMitFrist(`${instanz.localUrl}${pfad}`);

export async function beendeAufAnderer(instanz, callId) {
  const antwort = await abrufMitFrist(`${instanz.localUrl}/api/calls/${callId}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(antwort.status, HTTP_OK);
  assert.equal((await antwort.json()).status, ENDSTAND);
}

export async function anrufVon(instanz, callId) {
  const antwort = await holeVon(instanz, `/api/calls/${callId}`);
  return { status: antwort.status, anruf: await antwort.json() };
}
