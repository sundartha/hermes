import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { ergebnisZustand } from "../../src/telephony/ergebnis-zustand.ts";
import { isoVor } from "../_iel-inbound-harness.js";
import { makeJsonMessage, text } from "../anthropic-sse-fixtures.js";
import { starteAnbieterServer } from "../gemeinsam/anbieter-attrappe.mjs";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { seedCall, seedState, startServer, waitForStoreState } from "../helpers.js";

const FRIST_MS = 15000;
const ANRUF_VOR_S = 5;
const HTTP_OK = 200;
const TENANT = "t_4059_meldung";
const ZIEL = "+4915112345678";
const ANRUFER = "+4915187654321";
const ANGENOMMEN_UM = "2026-01-01T00:00:00.000Z";
const BEENDET_UM = "2026-01-01T00:05:00.000Z";

const AGENT = { role: "agent", text: "Guten Tag, ich rufe wegen eines Termins an." };
const ansage = (text) => ({ role: "caller", text });
const NUR_AGENT = [AGENT];
const AUF_BAND = [AGENT, ansage("Sie sind mit der Mailbox verbunden.")];
const ABSAGE = [AGENT, ansage("Nein, das vergeben wir nicht.")];
const ZUSAGE = [AGENT, ansage("Ja, Dienstag passt.")];

const MAILBOX_MODELL = { mailbox_only: true };
const ABLEHNUNG_MODELL = { declined: true };
const ZUSAGE_MODELL = { objective_achieved: true, confirmed_by_counterparty: true, confirmation_quote: "Dienstag passt" };

const SUMME = "Kurz.";
const KOPF = { de: `Anruf bei ${ZIEL}`, fr: `Appel vers ${ZIEL}`, en: `Call to ${ZIEL}` };

const SATZ = {
  de: {
    menue: "Nicht erledigt: Erreicht wurde nur eine Menü-Ansage, keine Person.",
    mailbox: "Nicht erledigt: Erreicht wurde nur eine Mailbox, keine Person.",
    ablehnung: "Nicht erledigt: Die Gegenseite hat abgelehnt.",
  },
  fr: {
    menue: "Non effectué : seul un menu vocal a été atteint, aucune personne.",
    mailbox: "Non effectué : seule une messagerie vocale a été atteinte, aucune personne.",
    ablehnung: "Non effectué : votre interlocuteur a refusé.",
  },
  en: {
    menue: "Not done: only an automated menu was reached, no person.",
    mailbox: "Not done: only a voicemail box was reached, no person.",
    ablehnung: "Not done: the other side declined.",
  },
};

const NUR_MENUE = ["not_done", "menu-only"];
const NUR_MAILBOX = ["not_done", "mailbox"];
const ABGELEHNT = ["not_done", "declined"];

const jeSprache = (sprache) => ({
  [`menue_${sprache}`]: { sprache, transcript: NUR_AGENT, satz: SATZ[sprache].menue, zustand: NUR_MENUE },
  [`mailbox_${sprache}`]: {
    sprache,
    transcript: AUF_BAND,
    modell: MAILBOX_MODELL,
    satz: SATZ[sprache].mailbox,
    zustand: NUR_MAILBOX,
  },
  [`ablehnung_${sprache}`]: {
    sprache,
    transcript: ABSAGE,
    modell: ABLEHNUNG_MODELL,
    satz: SATZ[sprache].ablehnung,
    zustand: ABGELEHNT,
  },
});

const FAELLE = {
  ...jeSprache("de"),
  ...jeSprache("fr"),
  ...jeSprache("en"),
  fremdsprache: { sprache: "es", kopf: KOPF.en, transcript: NUR_AGENT, satz: SATZ.en.menue, zustand: NUR_MENUE },
  mailboxTrotzZusage: {
    transcript: ZUSAGE,
    modell: { ...ZUSAGE_MODELL, ...MAILBOX_MODELL },
    satz: SATZ.de.mailbox,
    zustand: NUR_MAILBOX,
  },
  mailboxOhneAnsage: { transcript: NUR_AGENT, modell: MAILBOX_MODELL, satz: SATZ.de.mailbox, zustand: NUR_MAILBOX },
  ohneModellText: { transcript: NUR_AGENT, summary: null, satz: SATZ.de.menue, zustand: NUR_MENUE },
  bestaetigt: {
    transcript: ZUSAGE,
    modell: ZUSAGE_MODELL,
    summary: "Termin [Dienstag] steht.",
    satz: null,
    zustand: ["done_confirmed", null],
  },
  mailboxAlsText: { transcript: AUF_BAND, modell: { mailbox_only: "true" }, satz: null, zustand: ["unconfirmed", null] },
  eingehend: { direction: "inbound", transcript: NUR_AGENT, kopf: `Anruf von ${ANRUFER}`, satz: null, zustand: NUR_MENUE },
};

const ABBRUCH = "abbruchImMenue";

const modellAntwort = makeJsonMessage("msg_4059");

const marke = (name) => `Auftrag ${name}.`;

function anrufZu(name, fall) {
  return seedCall({
    id: `call_${name}`,
    tenantId: TENANT,
    goal: marke(name),
    direction: fall.direction ?? "outbound",
    language: fall.sprache ?? "de",
    from: ANRUFER,
    to: ZIEL,
    status: "completed",
    answeredAt: ANGENOMMEN_UM,
    endedAt: BEENDET_UM,
    transcript: fall.transcript.map((zeile) => ({ ...zeile, at: ANGENOMMEN_UM })),
  });
}

let modell;
let srv;
let stand;

before(async () => {
  modell = await starteAnbieterServer(({ body, res, vermerke }) => {
    vermerke(String(JSON.parse(body).system));
    const name = Object.keys(FAELLE).find((key) => body.includes(marke(key)));
    const fall = FAELLE[name] ?? {};
    const summary = fall.summary === null ? {} : { summary: fall.summary ?? SUMME };
    const antwort = JSON.stringify({ ...summary, actionItems: [], ...fall.modell });
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(modellAntwort([text(antwort)])));
  });
  const abbruch = {
    ...anrufZu(ABBRUCH, { transcript: NUR_AGENT }),
    status: "active",
    answeredAt: isoVor(ANRUF_VOR_S),
    endedAt: null,
  };
  const calls = [...Object.entries(FAELLE).map(([name, fall]) => anrufZu(name, fall)), abbruch];
  srv = await startServer({
    env: {
      ANTHROPIC_BASE_URL: modell.url,
      ANTHROPIC_API_KEY: "test-4059-key",
    },
    seed: seedState({
      tenants: [{ id: TENANT, status: "active", ownerName: "Jonas Beispiel" }],
      settings: { allowSummaries: true },
      calls,
    }),
  });
  for (const call of calls) {
    const status = call.id === abbruch.id ? "failed" : "completed";
    const antwort = await abrufMitFrist(`${srv.localUrl}/voice/status?callId=${call.id}`, {
      method: "POST",
      body: new URLSearchParams({ CallStatus: status }),
    });
    assert.equal(antwort.status, HTTP_OK);
  }
  stand = await waitForStoreState(srv, (s) => calls.every((c) => s.notifications.some((m) => m.callId === c.id)), FRIST_MS);
});

after(async () => {
  await srv?.stop();
  await modell?.close();
});

const anrufVon = (name) => stand.calls.find((c) => c.id === `call_${name}`);
const hinweisVon = (name) => stand.notifications.find((n) => n.callId === `call_${name}`);

function erwarteteZusammenfassung(fall) {
  const summary = fall.summary === null ? null : (fall.summary ?? SUMME);
  return [summary, fall.satz].filter(Boolean).join(" ");
}

for (const [name, fall] of Object.entries(FAELLE)) {
  test(`Anrufmeldung 4059: ${name}`, () => {
    const kopf = fall.kopf ?? KOPF[fall.sprache ?? "de"];
    const zusammenfassung = erwarteteZusammenfassung(fall);
    assert.equal(anrufVon(name).summary, zusammenfassung);
    assert.equal(hinweisVon(name).body, `${kopf}: ${zusammenfassung}`);
    const ergebnis = ergebnisZustand({ ...anrufVon(name), transcript: fall.transcript });
    assert.deepEqual([ergebnis.result_state, ergebnis.result_reason], fall.zustand);
  });
}

test("Anrufmeldung 4059: nicht zustande gekommener Anruf im Menue nennt den Grund in der Benachrichtigung", () => {
  assert.equal(
    hinweisVon(ABBRUCH).body,
    `${ZIEL} (Status: failed, Grund: die Verbindung kam nicht zustande) ${SATZ.de.menue}`,
  );
});

test("Anrufmeldung 4059: der Auswertungsauftrag fragt, ob nur eine Mailbox erreicht wurde", () => {
  assert.ok(modell.anfragen.length > 0);
  for (const auftrag of modell.anfragen) assert.ok(auftrag.includes('"mailbox_only" (true nur, wenn'), auftrag);
});
