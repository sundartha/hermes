import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { makeJsonMessage, text } from "../anthropic-sse-fixtures.js";
import { starteAnbieterServer } from "../gemeinsam/anbieter-attrappe.mjs";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { mcpPost, readToolResult, seedCall, seedState, startServer, toolCall, waitForStoreState } from "../helpers.js";

const FRIST_MS = 15000;
const TENANT = seedCall().tenantId;
const KURZ = "Kurz.";

const ANTWORT = "Weber am Apparat, Dienstag passt.";
const AGENT = { role: "agent", text: "Guten Tag, Jonas hat mich um einen Termin gebeten." };
const ZUSAGE = [AGENT, { role: "caller", text: ANTWORT }];

const TERMIN = { appointment_task: true, appointment_at: "2026-12-08T10:00", confirmed_by: "Weber" };
const BESTAETIGT = { objective_achieved: true, confirmed_by_counterparty: true, confirmation_quote: "Dienstag passt" };

const OFFEN = {
  de: "Zum Termin wurde nichts bestätigt. Nächster Schritt: den Stand direkt bei der Gegenseite klären.",
  fr: "Rien n'a été confirmé pour le rendez-vous. Prochaine étape : vérifier la situation directement auprès de votre interlocuteur.",
  en: "Nothing was confirmed about the appointment. Next step: check the status directly with the other side.",
};

const bestaetigt = (modell, satz, weitere = {}) => ({ modell: { ...BESTAETIGT, ...TERMIN, ...modell }, satz, ...weitere });
const OHNE_ANGABEN = { appointment_at: null, confirmed_by: null };
const MIT_WEBER_DE = "Bestätigt von Weber. Datum des Termins: 08.12.2026. Uhrzeit: 10:00.";
const OHNE_NAMEN_DE = "Bestätigt von der Gegenseite. Datum des Termins: 08.12.2026. Uhrzeit: 10:00.";

const FAELLE = {
  bestaetigtDe: bestaetigt({}, MIT_WEBER_DE),
  bestaetigtFr: bestaetigt({}, "Confirmé par Weber. Date du rendez-vous : 08/12/2026. Heure : 10:00.", { sprache: "fr" }),
  bestaetigtEn: bestaetigt({}, "Confirmed by Weber. Appointment date: 2026-12-08. Time: 10:00.", { sprache: "en" }),
  ohneAngabenDe: bestaetigt(OHNE_ANGABEN, "Bestätigt von der Gegenseite. Datum des Termins: nicht genannt. Uhrzeit: nicht genannt."),
  ohneAngabenFr: bestaetigt(OHNE_ANGABEN, "Confirmé par votre interlocuteur. Date du rendez-vous : non précisée. Heure : non précisée.", {
    sprache: "fr",
  }),
  ohneAngabenEn: bestaetigt(OHNE_ANGABEN, "Confirmed by the other side. Appointment date: not stated. Time: not stated.", {
    sprache: "en",
  }),
  nurDatum: bestaetigt(
    { appointment_at: "2026-12-08" },
    "Bestätigt von Weber. Datum des Termins: 08.12.2026. Uhrzeit: nicht genannt.",
  ),
  unmoeglichesDatum: bestaetigt(
    { appointment_at: "2026-02-30T10:00" },
    "Bestätigt von Weber. Datum des Termins: nicht genannt. Uhrzeit: nicht genannt.",
  ),
  mitZeitzone: bestaetigt(
    { appointment_at: "2026-12-08T23:30-05:00" },
    "Bestätigt von Weber. Datum des Termins: 08.12.2026. Uhrzeit: 23:30.",
  ),
  nameMitLeerraum: bestaetigt({ confirmed_by: "  Weber  " }, MIT_WEBER_DE),
  erfundenerName: bestaetigt({ confirmed_by: "Schulz" }, OHNE_NAMEN_DE),
  nameNurVomAssistenten: bestaetigt({ confirmed_by: "Jonas" }, OHNE_NAMEN_DE),
  offenDe: { modell: { objective_achieved: true, ...TERMIN }, satz: OFFEN.de },
  offenFr: { modell: { objective_achieved: true, ...TERMIN }, satz: OFFEN.fr, sprache: "fr" },
  offenEn: { modell: { objective_achieved: true, ...TERMIN }, satz: OFFEN.en, sprache: "en" },
  nurMenue: {
    transcript: [AGENT],
    modell: TERMIN,
    satz: `Nicht erledigt: Erreicht wurde nur eine Menü-Ansage, keine Person. ${OFFEN.de}`,
  },
  abgelehnt: {
    modell: { ...BESTAETIGT, ...TERMIN, declined: true },
    satz: `Nicht erledigt: Die Gegenseite hat abgelehnt. ${OFFEN.de}`,
  },
  keinTerminauftrag: bestaetigt({ appointment_task: false }, null),
  karteOhneUrteil: { modell: { outcome: "Auskunft erhalten." }, satz: null },
  terminAlsText: bestaetigt({ appointment_task: "true" }, null),
  eingehend: bestaetigt({}, null, { direction: "inbound" }),
};

const marke = (name) => `Auftrag ${name}.`;
const kennung = (name) => `call_4059_termin_${name}`;
const erwartet = (fall) => [KURZ, fall.satz].filter(Boolean).join(" ");

let modell;
let srv;
let stand;

function antworteWieModell({ body, res, vermerke }) {
  vermerke(String(JSON.parse(body).system));
  const name = Object.keys(FAELLE).find((key) => body.includes(marke(key)));
  const antwort = JSON.stringify({ summary: KURZ, actionItems: [], ...FAELLE[name]?.modell });
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(makeJsonMessage("msg_4059_termin")([text(antwort)])));
}

const abgeschlossen = ([name, fall]) =>
  seedCall({
    id: kennung(name),
    goal: marke(name),
    direction: fall.direction ?? "outbound",
    language: fall.sprache ?? "de",
    status: "completed",
    answeredAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:05:00.000Z",
    transcript: (fall.transcript ?? ZUSAGE).map((zeile) => ({ ...zeile, at: "2026-01-01T00:00:00.000Z" })),
  });

before(async () => {
  modell = await starteAnbieterServer((anfrage) => antworteWieModell(anfrage));
  const calls = Object.entries(FAELLE).map(abgeschlossen);
  srv = await startServer({
    env: { ANTHROPIC_BASE_URL: modell.url, ANTHROPIC_API_KEY: "test-4059-key" },
    seed: seedState({
      tenants: [{ id: TENANT, status: "active", ownerName: "Jonas Beispiel" }],
      settings: { allowSummaries: true },
      calls,
    }),
  });
  for (const call of calls) {
    await abrufMitFrist(`${srv.localUrl}/voice/status?callId=${call.id}`, {
      method: "POST",
      body: new URLSearchParams({ CallStatus: "completed" }),
    });
  }
  stand = await waitForStoreState(srv, (s) => calls.every((c) => s.notifications.some((m) => m.callId === c.id)), FRIST_MS);
});

after(async () => {
  await srv?.stop();
  await modell?.close();
});

for (const [name, fall] of Object.entries(FAELLE)) {
  test(`Terminsatz 4059: ${name}`, () => {
    const call = stand.calls.find((c) => c.id === kennung(name));
    const hinweis = stand.notifications.find((n) => n.callId === call.id);
    assert.equal(call.summary, erwartet(fall));
    assert.ok(hinweis.body.endsWith(`: ${erwartet(fall)}`), hinweis.body);
  });
}

test("Terminsatz 4059: get_call_result liefert die Zusammenfassung mit Datum, Uhrzeit und Bestaetiger", async () => {
  const antwort = await mcpPost(`${srv.localUrl}/mcp`, null, toolCall("get_call_result", { call_id: kennung("bestaetigtDe") }));
  const { structuredContent } = await readToolResult(antwort);
  assert.equal(structuredContent.result_state, "done_confirmed");
  assert.equal(structuredContent.result_summary, `${KURZ} ${MIT_WEBER_DE}`);
});

test("Terminsatz 4059: der Auswertungsauftrag fragt Terminauftrag, Zeitpunkt und bestaetigende Person ab", () => {
  assert.ok(modell.anfragen.length > 0);
  for (const auftrag of modell.anfragen) {
    assert.ok(auftrag.includes('"appointment_task" (true nur, wenn der Auftrag einen Termin betrifft'), auftrag);
    assert.ok(auftrag.includes('"appointment_at" (Datum und Uhrzeit'), auftrag);
    assert.ok(auftrag.includes('"confirmed_by" (Name der bestaetigenden Person'), auftrag);
  }
});
