import { createHash } from "node:crypto";
import { config } from "../config.js";
import { flushAnfang, startFrist } from "../utils/pg-pool.js";
import { messeSpeichern } from "../utils/betriebsmessung.js";
import * as ops from "./state-ops.js";
import { EIGENE_KENNUNG } from "./instanz-besitz.js";
import { tenantLanguage as tenantLanguageOf } from "./views.ts";
import { BOOTSTRAP_TENANT_ID, KYC_LEVEL } from "../begriffe/mandant.js";
import { ANRUF_ZUSTAENDE, anrufZustandVon } from "../begriffe/anruf-zustand.ts";
import { DEFAULT_PROVIDER } from "../begriffe/nummern-vergabe.js";
import { emptyPlatformTtsUsage, emptyCostCrossCheck } from "./leerzustaende.js";
import { migrate } from "../db/migrate.js";
import {
  hydratedCostCents,
  nutzungAuffrischen,
  nutzungBestaetigen,
  nutzungGeladen,
  nutzungSchreiben,
  nutzungVerwerfen,
  anrufReserveSpiegelFreigeben,
  reserveSpiegelFreigeben,
  reserveSpiegelOffen,
  reserveSpiegelVersuchen,
} from "./nutzung-pg.js";
import { backfillGreetingNotices } from "./greeting-notice-migration.js";
import { mitZeitgrenze } from "./webhook-zustellung.js";
import { macheAnrufpauseSql } from "./anrufpause-sql.js";
import { macheProfilSql } from "./profil-sql.js";
import { macheAnrufeSql, unbestaetigteZeilen } from "./anrufe.js";
import { macheAnrufExport } from "./anruf-export-sql.js";
import { macheAktiveAnrufeSql } from "./aktive-anrufe-sql.js";
import { macheAnrufNummernSql } from "./anruf-nummern-sql.js";
import { macheAnrufSucheSql } from "./anruf-suche-sql.js";
import { macheAnrufePosteingangSql } from "./posteingang-anrufe-sql.js";
import { macheAktionspunkteSql, ausstehendeSchreiben, inDatenbankMerken } from "./posteingang-sql.js";
import { macheRueckfrageSql } from "./rueckfrage-sql.js";
import { macheMandantSql, sperreSchreiben } from "./mandant-sql.js";
import {
  einstellungenSchreiben,
  innerhalbFrist,
  macheEinstellungenSchreiber,
  rowToSettings,
} from "./einstellungen-sql.js";

export { BOOTSTRAP_TENANT_ID };
export { macheSpeicherSperre } from "./sperre.js";

const ACTIVE_CALL_BY_ID_SQL = `SELECT * FROM call WHERE id = $1 AND status = $2`;
const SCHLUESSEL_SUCHEN_SQL = `SELECT call_id, tenant_id FROM anruf_schluessel WHERE art = $1 AND wert_hash = $2`;
const CALL_ZEILE_SQL = `SELECT * FROM call WHERE id = $1`;
const SCHLUESSEL_MANDANT_SQL = `SELECT tenant_id FROM anruf_schluessel WHERE call_id = $1 LIMIT 1`;
const SCHLUESSEL_ARTEN = { streamToken: "stream_token", twilioSid: "twilio_sid" };
const schluesselHash = (wert) => createHash("sha256").update(String(wert)).digest("hex");

async function schluesselZu(client, id) {
  const nachId = (await client.query(SCHLUESSEL_MANDANT_SQL, [id])).rows;
  if (nachId.length > 0) return { callId: id, tenantId: nachId[0].tenant_id };
  const nachSid = (await client.query(SCHLUESSEL_SUCHEN_SQL, [SCHLUESSEL_ARTEN.twilioSid, schluesselHash(id)])).rows;
  return nachSid.length > 0 ? { callId: nachSid[0].call_id, tenantId: nachSid[0].tenant_id } : null;
}

async function mitStartFrist(client, arbeit) {
  const { anheben, zuruecksetzen } = startFrist();
  await client.query(anheben.text, anheben.params);
  try {
    return await arbeit();
  } finally {
    await client.query(zuruecksetzen.text, zuruecksetzen.params);
  }
}

const einstellungenJeZustand = new WeakMap();

export function einstellungenNachladenVon(zustand, tenantId) {
  return einstellungenJeZustand.get(zustand).nachladen(tenantId);
}

const nutzungJeZustand = new WeakMap();

export function nutzungAuffrischenVon(zustand, tenantId) {
  return nutzungJeZustand.get(zustand)(tenantId);
}

const anrufpauseJeZustand = new WeakMap();

export { macheRueckfrageSql };

export function anrufpauseGelesenVon(zustand) {
  return anrufpauseJeZustand.get(zustand).lesen();
}

export function anrufpauseSetzen(speicher, an) {
  const { schreiben } = anrufpauseJeZustand.get(speicher.load());
  return ops.anrufpauseSetzen(speicher, an, schreiben);
}

const mandantJeZustand = new WeakMap();
const geschriebeneAnrufe = new WeakMap();

function anrufAbdruck(call, tenantId) {
  const zeilen = call.transcript.filter((zeile) => !unbestaetigteZeilen.has(zeile));
  return JSON.stringify([callRowValues(call, tenantId), zeilen]);
}

function anrufAlsGelesen(call) {
  geschriebeneAnrufe.set(call, anrufAbdruck(call, call.tenantId));
  return call;
}

const STAMMDATEN_SPALTEN = Object.freeze({
  ownerName: "owner_name",
  firstName: "first_name",
  country: "country",
  defaultLanguage: "default_language",
  timezone: "timezone",
  privateNumber: "private_number",
  newsletterConsent: "newsletter_consent",
  newsletterConsentAt: "newsletter_consent_at",
  newsletterRecipients: "newsletter_recipients",
  newsletterConfirmMailLog: "newsletter_confirm_mail_log",
});

function anbinden(zustand, { einstellungen, profil, anrufpause, mandant, nutzung }) {
  nutzungJeZustand.set(zustand, nutzung);
  einstellungenJeZustand.set(zustand, {
    nachladen: async (tenantId) => {
      const [lesbar] = await Promise.all([einstellungen.nachladen(tenantId), profil.nachladen(tenantId)]);
      return lesbar;
    },
  });
  anrufpauseJeZustand.set(zustand, anrufpause);
  mandantJeZustand.set(zustand, mandant);
}

export function mandantSperreGelesenVon(zustand, tenantId) {
  return mandantJeZustand.get(zustand).sperreLesen(tenantId);
}

export function makePgStore(runner, { prepareSchema = migrate, einstellungenFristMs } = {}) {
  let state = null;
  let flushChain = Promise.resolve();
  let lastFlushError = null;
  const gebunden = new Set();
  const eigene = new Set();

  function requireState() {
    if (!state) throw new Error("pg-Store nicht initialisiert - erst await store.init() aufrufen");
    return state;
  }

  async function init() {
    gebunden.clear();
    eigene.clear();
    state = await runner.withClient((client) =>
      mitStartFrist(client, () => aufbauen(client, prepareSchema)),
    );
    inDatenbankMerken([...state.actionItems, ...state.notifications]);
    const nutzung = (tenantId) => nutzungAuffrischen({ einreihen, state, tenantId });
    anbinden(state, { einstellungen, profil, anrufpause: macheAnrufpauseSql(optionen), mandant, nutzung });
    return state;
  }

  function save(preFlush) {
    const snapshot = requireState();
    flushChain = flushChain
      .then(() => messeSpeichern(() => runner.withClient((client) => flush(client, snapshot, { preFlush, gebunden }))))
      .then(
        () => {
          lastFlushError = null;
        },
        (err) => {
          lastFlushError = err;
          console.error("[pg] Flush fehlgeschlagen:", err.message);
        },
      );
    return flushChain;
  }

  function einreihen(arbeit) {
    const ergebnis = flushChain.then(() => runner.withClient(arbeit));
    flushChain = ergebnis.then(
      () => {},
      () => {},
    );
    return ergebnis;
  }

  const optionen = { einreihen, runner, requireState, fristMs: einstellungenFristMs };
  const einstellungen = macheEinstellungenSchreiber(optionen);
  const mandant = macheMandantSql({ ...optionen, stammdatenSpalten: STAMMDATEN_SPALTEN });
  const profil = macheProfilSql({ ...optionen, innerhalbFrist });

  async function drainFlushes() {
    let ref = flushChain;
    for (;;) {
      await ref;
      if (flushChain === ref) break;
      ref = flushChain;
    }
    if (lastFlushError) throw lastFlushError;
  }

  const suche = macheAnrufSuche({ runner, requireState, gebunden, eigene });

  const kontext = { requireState, save, runner, gebunden, eigene, ...suche, einstellungen, profil, mandant, einreihen, anrufe: macheAnrufeSql({ runner, einreihen, lese: suche.leseAnrufUngebunden, anhaengen: suche.leseAnruf }), anrufExport: macheAnrufExport({ runner, zeilenZuAnrufen }), aktiveAnrufe: macheAktiveAnrufeSql({ runner, zeilenZuAnrufen, eigene }), anrufNummern: macheAnrufNummernSql({ runner }), anrufSuche: macheAnrufSucheSql({ runner, zeilenZuAnrufen }), posteingangAnrufe: macheAnrufePosteingangSql({ runner, zeilenZuAnrufen }), posteingang: macheAktionspunkteSql({ runner, einreihen, save, leseCallUngebunden: suche.leseAnrufUngebunden }) };

  return {
    init,
    load: () => requireState(),
    save,
    drainFlushes,
    newId: ops.newId,
    ...anrufStatusMethoden(kontext),
    ...anrufBelegMethoden(kontext),
    ...rueckfrageRechercheMethoden(kontext),
    ...aktionKalenderMethoden(kontext),
    ...kostenBudgetMethoden(kontext),
    ...mandantBudgetMethoden(kontext),
    ...aboAbrechnungMethoden(kontext),
    ...mandantEinstellungenMethoden(kontext),
    ...verwaltungMethoden(kontext),
  };
}

async function anrufAusZeile(client, row) {
  const callId = row.id;
  const segRows = (
    await client.query(`SELECT * FROM transcript_segment WHERE call_id = $1 ORDER BY id ASC`, [callId])
  ).rows;
  const itemRows = (
    await client.query(`SELECT * FROM action_item WHERE call_id = $1 ORDER BY seq DESC`, [callId])
  ).rows;
  return rowToCall(row, groupTranscripts(segRows), groupActionItemIds(itemRows));
}

function anrufEinsetzen({ state, eigene }, gelesen) {
  const call = anrufAlsGelesen(gelesen);
  const raced = ops.getCall(state, call.id);
  if (raced && eigene.has(call.id)) return raced;
  if (raced) state.calls.splice(state.calls.indexOf(raced), 1, call);
  else state.calls.push(call);
  eigene.add(call.id);
  return call;
}

async function anrufAnhaengen({ client, state, eigene }, row) {
  return anrufEinsetzen({ state, eigene }, await anrufAusZeile(client, row));
}


function macheAnrufSuche({ runner, requireState, gebunden, eigene }) {
  async function uebernehmen(client, state, row) {
    const call = await anrufAnhaengen({ client, state, eigene }, row);
    gebunden.add(call.id);
    return call;
  }

  async function attachActiveCallRow(sql, lookupValue) {
    try {
      const state = requireState();
      return await runner.withClient(async (client) => {
        for (const tenant of state.tenants) {
          await setTenant(client, tenant.id);
          const rows = (await client.query(sql, [lookupValue, CALL_STATUS_ACTIVE])).rows;
          if (rows.length > 0) return await uebernehmen(client, state, rows[0]);
        }
        return null;
      });
    } catch (err) {
      console.error("[pg] attachActiveCall fehlgeschlagen:", err.message);
      throw err;
    }
  }

  async function attachActiveCallByKey(art, wert) {
    try {
      const state = requireState();
      return await runner.withClient(async (client) => {
        const keys = (await client.query(SCHLUESSEL_SUCHEN_SQL, [art, schluesselHash(wert)])).rows;
        for (const key of keys) {
          await setTenant(client, key.tenant_id);
          const rows = (await client.query(ACTIVE_CALL_BY_ID_SQL, [key.call_id, CALL_STATUS_ACTIVE])).rows;
          if (rows.length > 0) return await uebernehmen(client, state, rows[0]);
        }
        return null;
      });
    } catch (err) {
      console.error("[pg] attachActiveCall nach Schluessel fehlgeschlagen:", err.message);
      throw err;
    }
  }

  async function anrufLesen(client, id) {
    const schluessel = await schluesselZu(client, id);
    if (!schluessel) return null;
    await setTenant(client, schluessel.tenantId);
    const rows = (await client.query(CALL_ZEILE_SQL, [schluessel.callId])).rows;
    return rows.length > 0 ? await anrufAusZeile(client, rows[0]) : null;
  }

  async function kopieNeuLesen(id, bekannt, uebernehmen) {
    let gelesen;
    try {
      gelesen = await mitZeitgrenze(runner, { arbeit: (client) => anrufLesen(client, id) });
    } catch (err) {
      console.error("[pg] leseCall fehlgeschlagen, geladene Kopie bleibt:", err.message);
      return bekannt;
    }
    return gelesen ? uebernehmen(requireState(), gelesen) : bekannt;
  }

  async function leseAusDatenbank(id, uebernehmen) {
    const state = requireState();
    const bekannt = ops.getCall(state, id);
    if (bekannt && eigene.has(id)) return bekannt;
    if (bekannt) return kopieNeuLesen(id, bekannt, uebernehmen);
    try {
      const gelesen = await mitZeitgrenze(runner, { arbeit: (client) => anrufLesen(client, id), nurFrist: true });
      return gelesen ? uebernehmen(state, gelesen) : null;
    } catch (err) {
      console.error("[pg] leseCall fehlgeschlagen:", err.message);
      throw err;
    }
  }

  const leseAnruf = (id) => leseAusDatenbank(id, (state, gelesen) => anrufEinsetzen({ state, eigene }, gelesen));
  const leseAnrufUngebunden = (id) => leseAusDatenbank(id, (_state, gelesen) => gelesen);
  return { attachActiveCallRow, attachActiveCallByKey, leseAnruf, leseAnrufUngebunden };
}

async function loesen(gebunden, callId, schreiben) {
  const ergebnis = await schreiben;
  gebunden.delete(callId);
  return ergebnis;
}

function entbindeEntfernte(mengen, state) {
  for (const menge of mengen)
    for (const callId of menge) if (!ops.getCall(state, callId)) menge.delete(callId);
}

function anrufStatusMethoden({ requireState, save, gebunden, eigene, attachActiveCallRow, attachActiveCallByKey, leseAnruf, leseAnrufUngebunden, einreihen, anrufe, posteingang, posteingangAnrufe }) {
  return {
    createCall(input) {
      const call = ops.createCall(requireState(), { ...input, instanz: EIGENE_KENNUNG });
      gebunden.add(call.id);
      eigene.add(call.id);
      save();
      return call;
    },
    async persistCall(callId) {
      const state = requireState();
      const call = ops.getCall(state, callId);
      try {
        await einreihen(async (client) => {
          await setTenant(client, call.tenantId);
          await schreibeAnrufZeile(client, call.tenantId, call);
        });
      } catch (err) {
        state.calls.splice(state.calls.indexOf(call), 1);
        gebunden.delete(callId);
        eigene.delete(callId);
        throw err;
      }
    },
    getCall(id) {
      const treffer = ops.getCall(requireState(), id);
      return treffer && eigene.has(treffer.id) ? treffer : null;
    },
    anrufHierBewacht: (id) => gebunden.has(id),
    leseCall: leseAnruf,
    leseCallUngebunden: leseAnrufUngebunden,
    attachActiveCall: (wert, { schluessel } = {}) =>
      schluessel ? attachActiveCallByKey(SCHLUESSEL_ARTEN[schluessel], wert) : attachActiveCallRow(ACTIVE_CALL_BY_ID_SQL, wert),
    addTranscript: (callId, role, text) => anrufe.transkriptAnhaengen(requireState(), callId, { role, text }),
    purgeTranscript: (callId) => anrufe.transkriptLoeschen(requireState(), callId),
    markAnswered: (callId) => anrufe.markAnswered(requireState(), callId),
    trueUpAnsweredAt: (callId, answeredAtIso) => anrufe.trueUpAnsweredAt(requireState(), callId, answeredAtIso),
    recordAnsweredUnclearReason: (callId, reason) => anrufe.recordAnsweredUnclearReason(requireState(), callId, reason),
    recordElDetectorCounts: (callId, zaehlung) => anrufe.recordElDetectorCounts(requireState(), callId, zaehlung),
    endCallRecord: (callId, status = "completed") => loesen(gebunden, callId, anrufe.endCallRecord(requireState(), callId, status)),
    setCallEndedAt: (callId, status, endedAtIso) =>
      loesen(gebunden, callId, anrufe.setCallEndedAt(requireState(), callId, status, endedAtIso)),
    markSummarySmsSent: (callId) => anrufe.markSummarySmsSent(requireState(), callId),
    markSummaryMailSent: (callId) => anrufe.markSummaryMailSent(requireState(), callId),
    markNotPlacedMailSent: (callId) => anrufe.markNotPlacedMailSent(requireState(), callId),
    markBilled: (callId) => anrufe.markBilled(requireState(), callId),
    recordWebhookAnchors: (callId, anchors) => anrufe.recordWebhookAnchors(requireState(), callId, anchors),
    markInboxEntry: (callId, qualifies) => anrufe.markInboxEntry(requireState(), callId, qualifies),
    async takeInboxEntries(tenantId, options) {
      const { actionItems } = await posteingang.mandantLesen(tenantId);
      const offeneTexte = (callId) =>
        actionItems
          .filter((punkt) => punkt.callId === callId && !punkt.done)
          .reverse()
          .map((punkt) => punkt.text);
      const result = await posteingangAnrufe.abrufen(requireState(), tenantId, { ...options, offeneTexte, uhr: () => new Date() });
      if (result.marked) save();
      return result;
    },
    recordCallEstimatedCostCents: (callId, input) => anrufe.recordCallEstimatedCostCents(requireState(), callId, input),
    recordCallCostTruingResult: (callId, outcome) => anrufe.recordCallCostTruingResult(requireState(), callId, outcome),
  };
}

function anrufBelegMethoden({ requireState, save }) {
  return {
    ...kostenAbschlussMutatoren({ requireState, save }),
    recordFailureReason(callId, reason) {
      const { call, changed } = ops.recordFailureReason(requireState(), callId, reason);
      if (changed) save();
      return call;
    },
    recordElevenlabsConversationId(callId, conversationId) {
      const { call, changed } = ops.recordElevenlabsConversationId(
        requireState(),
        callId,
        conversationId,
      );
      if (changed) save();
      return call;
    },
    recordSipCallId(callId, sipCallId) {
      const { call, changed } = ops.recordSipCallId(requireState(), callId, sipCallId);
      if (changed) save();
      return call;
    },
    recordCostProfile(callId, profil) {
      const { call, changed } = ops.recordCostProfile(requireState(), callId, profil);
      if (changed) save();
      return call;
    },
    ...brueckenZustandMutatoren({ requireState, save }),
    ...inboundTrunkBelegMutatoren({ requireState, save }),
    recordCallCostEvidence(eingabe) {
      const { evidence, changed } = ops.recordCallCostEvidence(requireState(), eingabe);
      if (changed) save();
      return evidence;
    },
    callCostEvidence(callId) {
      return ops.callCostEvidence(requireState(), callId);
    },
    ...absenderWahrheitMutatoren({ requireState, save }),
    recordProviderCallResult(callId, result) {
      const { call, changed } = ops.recordProviderCallResult(requireState(), callId, result);
      if (changed) save();
      return call;
    },
    recordProviderCollectedFields(callId, fields) {
      const { call, changed } = ops.recordProviderCollectedFields(requireState(), callId, fields);
      if (changed) save();
      return call;
    },
    recordCalleeConfirmedTimezone(callId, confirmed) {
      const { call, changed } = ops.recordCalleeConfirmedTimezone(requireState(), callId, confirmed);
      if (changed) save();
      return call;
    },
  };
}

function rueckfrageRechercheMethoden({ requireState, save, anrufe }) {
  return {
    countCallerTurn(callId) {
      const { call, changed } = ops.countCallerTurn(requireState(), callId);
      if (changed) save();
      return call ? call.callerTurns : 0;
    },
    emitConsult(callId, questions) {
      const { call, changed } = ops.emitConsult(requireState(), callId, questions);
      if (changed) save();
      return call;
    },
    answerConsult(callId, input) {
      const result = ops.answerConsult(requireState(), callId, input);
      if (result.changed) save();
      return result;
    },
    markConsultAnswerDelivered(callId) {
      const result = ops.markConsultAnswerDelivered(requireState(), callId);
      if (result.changed) save();
      return result;
    },
    markConsultAskDelivered(callId, eventId) {
      const result = ops.markConsultAskDelivered(requireState(), callId, eventId);
      if (result.changed) save();
      return result;
    },
    ackConsult(callId, input) {
      const result = ops.ackConsult(requireState(), callId, input);
      if (result.changed) save();
      return result;
    },
    timeOutStagedConsult(callId, input) {
      const result = ops.timeOutStagedConsult(requireState(), callId, input);
      if (result.changed) save();
      return result;
    },
    expireOpenConsults(callId) {
      const { call, changed } = ops.expireOpenConsults(requireState(), callId);
      if (changed) save();
      return call;
    },
    pendingConsult: (callId, afterEventId) =>
      ops.pendingConsult(requireState(), callId, afterEventId),
    advanceInCallConsult(callId, input) {
      const { changed, wait } = ops.advanceInCallConsult(requireState(), callId, input);
      if (changed) save();
      return wait;
    },
    noteConsultPoll: (callId) => anrufe.noteConsultPoll(requireState(), callId),
    addLookupFacts(callId, facts) {
      const { changed, added } = ops.addLookupFacts(requireState(), callId, facts);
      if (changed) save();
      return added;
    },
    countCallLookup: (callId) => anrufe.countCallLookup(requireState(), callId),
    recordCallLookup(callId, query) {
      const { changed, seq } = ops.recordCallLookup(requireState(), callId, query);
      if (changed) save();
      return seq;
    },
    finishCallLookup(callId, seq, outcome) {
      const { changed } = ops.finishCallLookup(requireState(), callId, { seq, ...outcome });
      if (changed) save();
      return changed;
    },
    countNoSpeechTurn: (callId) => anrufe.countNoSpeechTurn(requireState(), callId),
    clearNoSpeechStreak: (callId) => anrufe.clearNoSpeechStreak(requireState(), callId),
    countOutboundCallsSince: (sinceIso, filters = {}) => anrufe.zaehleAusgehend(sinceIso, filters),
    counterpartyMemory: (tenantId, e164) => ops.counterpartyMemory(requireState(), tenantId, e164),
    counterpartyMemoryGelesen: (tenantId, e164) => anrufe.gedaechtnis(requireState(), tenantId, e164),
    findTenantByNumber: (e164) => ops.findTenantByNumber(requireState(), e164),
    numberRecordByE164: (e164) => ops.numberRecordByE164(requireState(), e164),
    resolveCallLanguage: (args) => ops.resolveCallLanguage(requireState(), args),
    tenantLanguage: (tenantId) => tenantLanguageOf(requireState(), tenantId),
  };
}

function aktionKalenderMethoden({ requireState, save, posteingang }) {
  return {
    async addActionItem(callId, text, type = "todo") {
      const state = requireState();
      const ausDatenbank = await posteingang.anlegen(state, callId, { text, type });
      if (ausDatenbank) return ausDatenbank;
      const result = ops.addActionItem(state, callId, text, type);
      if (!result.duplicate) save();
      return result;
    },
    async callActionItems(callId) {
      const state = requireState();
      const zeilen = await posteingang.lesen(state, callId);
      return zeilen ?? ops.callActionItems(state, callId);
    },
    callActionItemsGespiegelt: (callId) => ops.callActionItems(requireState(), callId),
    toggleActionItem(id) {
      const state = requireState();
      const item = ops.toggleActionItem(state, id);
      if (!item) return item;
      posteingang.umschalten(state, item)?.catch((err) => console.error("[pg] Umschalten des Aktionspunkts fehlgeschlagen:", err.message));
      save();
      return item;
    },

    getCalendar: (tenantId) => ops.getCalendar(requireState(), tenantId),
    addCalendarEvent(event) {
      const ev = ops.addCalendarEvent(requireState(), event);
      save();
      return ev;
    },
    findConflict: (tenantId, startIso, endIso) =>
      ops.findConflict(requireState(), tenantId, startIso, endIso),

    tenantContext: (tenantId) => ops.tenantContext(requireState(), "", tenantId),
  };
}

function kostenBudgetMethoden({ requireState, save, aktiveAnrufe, anrufNummern, anrufSuche }) {
  return {
    numberHasActiveCall: async (e164) =>
      ops.activeCallOnNumber(requireState(), e164) || anrufNummern.aktivBelegt(e164),
    trackUsage(tenantId, tokens, cfg) {
      const usage = ops.trackUsage(requireState(), tenantId, tokens, cfg, new Date().toISOString());
      save();
      return usage;
    },
    budgetExceeded: (tenantId, cfg) =>
      ops.budgetExceeded(requireState(), tenantId, cfg, new Date().toISOString()),
    liveBudgetExceeded: (tenantId, liveCents, cfg) =>
      ops.liveBudgetExceeded(requireState(), tenantId, liveCents, cfg, new Date().toISOString()),
    activeCallsFor: (tenantId) => aktiveAnrufe.zaehlung(requireState(), tenantId),
    activeCallsForSql: (tenantId) => aktiveAnrufe.fuer(requireState(), tenantId),
    aktiveAnrufeAlle: () => aktiveAnrufe.alle(requireState()),
    anderesAnrufMitKonversation: (callId, konversationId) =>
      anrufSuche.anderesMitKonversation(requireState(), callId, konversationId),
    anrufeDesMandanten: (tenantId) => anrufSuche.anrufeDesMandanten(requireState(), tenantId),
    reserveExceedsBudget: (tenantId, reserveCents, cfg) =>
      ops.reserveExceedsBudget(requireState(), tenantId, reserveCents, cfg, new Date().toISOString()),
    tenantBudgetSnapshot: (tenantId, cfg) =>
      ops.tenantBudgetSnapshot(requireState(), tenantId, cfg, new Date().toISOString()),
    addVoiceUsageCostCents(tenantId, costCents) {
      const usage = ops.addVoiceUsageCostCents(requireState(), tenantId, costCents, new Date().toISOString());
      save();
      return usage;
    },
    addResearchFeeCostCents(tenantId, costCents) {
      const usage = ops.addResearchFeeCostCents(requireState(), tenantId, costCents, new Date().toISOString());
      save();
      return usage;
    },
    applyCostCorrectionCents(tenantId, input) {
      const result = ops.applyCostCorrectionCents(requireState(), tenantId, input, new Date().toISOString());
      if (result.booked) save();
      return result;
    },
    usageOf: (tenantId) => ops.usageOf(requireState(), tenantId),

    tryReserveOutboundBudget: (tenantId, reserveCents, cfg) =>
      reserveSpiegelVersuchen(requireState(), { tenantId, reserveCents, cfg, nowIso: new Date().toISOString() }),
    releaseOutboundReserve: (call) => ops.releaseOutboundReserve(requireState(), call, anrufReserveSpiegelFreigeben),
    releaseOutboundReserveCents: (tenantId, cents) => reserveSpiegelFreigeben(requireState(), tenantId, cents),
    reservationOf: (tenantId) => reserveSpiegelOffen(requireState(), tenantId),
    claimPlatformSpendWarning: (cfg, nowIso) =>
      ops.claimPlatformSpendWarning(requireState(), cfg, nowIso),

    recordTtsCharacters(chars, nowIso) {
      const result = ops.recordTtsCharacters(requireState(), chars, config.billing, nowIso);
      if (result.changed) save();
      return result.warning;
    },
    platformTtsUsageView: (nowIso) => ops.platformTtsUsageView(requireState(), config.billing, nowIso),

    recordTenantTtsCharacters(tenantId, chars) {
      const result = ops.recordTenantTtsCharacters(requireState(), tenantId, chars);
      if (result.changed) save();
      return result;
    },

    recordRelayTtsCharacters(tenantId, chars, nowIso) {
      const result = ops.recordRelayTtsCharacters(requireState(), { tenantId, chars, cfg: config.billing, nowIso });
      if (result.changed) save();
      return result.warning;
    },

    markCostCrossCheckAttempted(monthKey) {
      const current = requireState();
      const before = current.costCrossCheck.lastCheckedMonthKey;
      ops.markCrossCheckAttempted(current, monthKey);
      if (current.costCrossCheck.lastCheckedMonthKey !== before) save();
    },
  };
}

function suspendierungSchreiben(mandant, tenantId, changed) {
  if (changed || mandant.nichtBestaetigt(tenantId, "suspendedAt"))
    return mandant.schreibenPflicht(tenantId, ["suspendedAt"]);
}

function mandantBudgetMethoden({ requireState, save, mandant }) {
  return {
    setTenantBudget(tenantId, amounts) {
      const row = ops.setTenantBudget(requireState(), tenantId, amounts);
      save();
      return row;
    },
    recordUsageEvent(input) {
      const event = ops.recordUsageEvent(requireState(), input);
      save();
      return event;
    },
    dailySmsCount: (tenantId, sinceIso) => ops.dailySmsCount(requireState(), tenantId, sinceIso),
    planMinutesExceeded: (tenantId, opts) => ops.planMinutesExceeded(requireState(), tenantId, opts),
    pendingMeterEvents: () => ops.pendingMeterEvents(requireState()),
    markMeterEventsSent(eventIds) {
      const sentCount = ops.markMeterEventsSent(requireState(), eventIds);
      if (sentCount) save();
      return sentCount;
    },

    setKycLevel(tenantId, level) {
      const tenant = ops.setKycLevel(requireState(), tenantId, level);
      mandant.schreiben(tenantId, ["kycLevel"]);
      return tenant;
    },
    kycReached: (tenantId, minLevel) => ops.kycReached(requireState(), tenantId, minLevel),

    tenantActiveSubscriber: (tenantId, minLevel) =>
      ops.tenantActiveSubscriber(requireState(), tenantId, minLevel),
    tenantInactive: (tenantId) => ops.tenantInactive(requireState(), tenantId),

    setSuspendedAtIfAbsent(tenantId) {
      const { changed } = ops.setSuspendedAtIfAbsent(requireState(), tenantId, new Date().toISOString());
      return suspendierungSchreiben(mandant, tenantId, changed);
    },
    clearSuspendedAt(tenantId) {
      const { changed } = ops.clearSuspendedAt(requireState(), tenantId);
      return suspendierungSchreiben(mandant, tenantId, changed);
    },

    stampBudgetPeriod(tenantId, periodStartIso) {
      const { changed } = ops.stampBudgetPeriod(requireState(), tenantId, periodStartIso);
      if (changed) save();
      return changed;
    },
    tenantSuspendedAt: (tenantId) => ops.tenantSuspendedAt(requireState(), tenantId),
  };
}

const ABO_SCHLUESSEL = [
  ["subscriptionId", "stripeSubscriptionId"],
  ["planSlug", "stripePlanSlug"],
  ["currentPeriodEnd", "stripeCurrentPeriodEnd"],
  ["currentPeriodStart", "stripeCurrentPeriodStart"],
  ["numberSetupFeeExempt", "stripeNumberSetupFeeExempt"],
  ["activationPending", "stripeActivationPending"],
  ["periodCreditRevoked", "stripePeriodCreditRevoked"],
  ["cancelAtPeriodEnd", "stripeCancelAtPeriodEnd"],
];

const STRIPE_SCHLUESSEL = [
  ["customerId", "stripeCustomerId"],
  ["paymentMethodId", "stripePaymentMethodId"],
  ["paymentMethodType", "stripePaymentMethodType"],
];

const AUFRAEUMEN_SCHLUESSEL = [
  ["numberReleasePending", "numberReleasePending"],
  ["workosDeletePending", "workosDeletePending"],
];

const KUENDIGUNGSMAIL_SCHLUESSEL = [
  ["pending", "cancellationMailPending"],
  ["receivedAt", "cancellationMailReceivedAt"],
];

function aboAbrechnungMethoden({ requireState, save, mandant }) {
  return {
    setTenantStripe(tenantId, patch = {}) {
      const tenant = ops.setTenantStripe(requireState(), tenantId, patch);
      const schluessel = STRIPE_SCHLUESSEL.filter(([feld]) => patch[feld] !== undefined);
      if (schluessel.length > 0) mandant.schreiben(tenantId, schluessel.map(([, key]) => key));
      return tenant;
    },
    tenantStripe: (tenantId) => ops.tenantStripe(requireState(), tenantId),

    setTenantSubscription(tenantId, patch) {
      const tenant = ops.setTenantSubscription(requireState(), tenantId, patch);
      ops.deriveTenantBudgetFromPlan(requireState(), tenantId, config.billing);
      save();
      const schluessel = ABO_SCHLUESSEL.filter(([feld]) => patch[feld] !== undefined);
      if (schluessel.length > 0) mandant.schreiben(tenantId, schluessel.map(([, key]) => key));
      return tenant;
    },
    tenantSubscription: (tenantId) => ops.tenantSubscription(requireState(), tenantId),
    findTenantBySubscription: (subscriptionId) =>
      ops.findTenantBySubscription(requireState(), subscriptionId),

    findTenantByCustomer: (customerId) => ops.findTenantByCustomer(requireState(), customerId),
    tenantExists: (tenantId) => ops.tenantExists(requireState(), tenantId),
    setBillingHold(tenantId, patch) {
      ops.setBillingHold(requireState(), tenantId, patch);
      return mandant.schreibenPflicht(tenantId, ["billingHold", "billingHoldDueAt"]);
    },
    clearBillingHold(tenantId) {
      ops.clearBillingHold(requireState(), tenantId);
      return mandant.schreibenPflicht(tenantId, ["billingHold", "billingHoldDueAt"]);
    },
    billingHoldActive: (tenantId) =>
      ops.billingHoldActive(requireState(), tenantId, new Date().toISOString()),

    setContractEndCleanupPending(tenantId, patch) {
      const tenant = ops.setContractEndCleanupPending(requireState(), tenantId, patch);
      save();
      const schluessel = AUFRAEUMEN_SCHLUESSEL.filter(([feld]) => patch?.[feld] !== undefined);
      if (schluessel.length > 0) mandant.schreiben(tenantId, schluessel.map(([, key]) => key));
      return tenant;
    },
    contractEndCleanupPending: (tenantId) =>
      ops.contractEndCleanupPending(requireState(), tenantId),
    tenantsPendingContractEndCleanup: () =>
      ops.tenantsPendingContractEndCleanup(requireState()),
    tenantIdpSubject: (tenantId) => ops.tenantIdpSubject(requireState(), tenantId),

    setCancellationMailPending(tenantId, patch) {
      const tenant = ops.setCancellationMailPending(requireState(), tenantId, patch);
      save();
      const schluessel = KUENDIGUNGSMAIL_SCHLUESSEL.filter(([feld]) => patch?.[feld] !== undefined);
      if (schluessel.length > 0) mandant.schreiben(tenantId, schluessel.map(([, key]) => key));
      return tenant;
    },
    cancellationMailPending: (tenantId) =>
      ops.cancellationMailPending(requireState(), tenantId),
    tenantsPendingCancellationMail: () =>
      ops.tenantsPendingCancellationMail(requireState()),
  };
}

const GEO_SCHLUESSEL = [
  ["country", "country"],
  ["defaultLanguage", "defaultLanguage"],
  ["timezone", "timezone"],
];

function mandantEinstellungenMethoden({ requireState, save, posteingang, mandant }) {
  return {
    stammdatenSchreiben: (tenantId, schluessel) => mandant.schreiben(tenantId, schluessel),

    setPrivateNumber(tenantId, raw) {
      const tenant = ops.setPrivateNumber(requireState(), tenantId, raw);
      save();
      mandant.schreiben(tenantId, ["privateNumber"]);
      return tenant;
    },
    tenantPrivateNumber: (tenantId) => ops.tenantPrivateNumber(requireState(), tenantId),
    tenantPrivateNumberLesen: (tenantId) => mandant.privateNumberLesen(tenantId),

    setTenantGeo(tenantId, patch) {
      const tenant = ops.setTenantGeo(requireState(), tenantId, patch);
      save();
      const schluessel = GEO_SCHLUESSEL.filter(([feld]) => patch[feld] !== undefined);
      if (schluessel.length > 0) mandant.schreiben(tenantId, schluessel.map(([, key]) => key));
      return tenant;
    },
    tenantGeo: (tenantId) => ops.tenantGeo(requireState(), tenantId),
    tenantTimezone: (tenantId) => ops.tenantTimezone(requireState(), tenantId),

    setNewsletterConsent(tenantId, consent) {
      const tenant = ops.setNewsletterConsent(requireState(), tenantId, consent);
      save();
      mandant.schreiben(tenantId, ["newsletterConsent", "newsletterConsentAt"]);
      return tenant;
    },
    tenantNewsletterConsent: (tenantId) => ops.tenantNewsletterConsent(requireState(), tenantId),

    tenantNewsletterRecipients: (tenantId) => ops.tenantNewsletterRecipients(requireState(), tenantId),
    confirmedNewsletterRecipients: (tenantId) =>
      ops.confirmedNewsletterRecipients(requireState(), tenantId),
    dailyNewsletterConfirmMailCount: (tenantId, sinceIso) =>
      ops.dailyNewsletterConfirmMailCount(requireState(), tenantId, sinceIso),
    addNewsletterRecipient(tenantId, recipientInput) {
      const recipient = ops.addNewsletterRecipient(requireState(), tenantId, recipientInput);
      save();
      mandant.schreiben(tenantId, ["newsletterRecipients", "newsletterConfirmMailLog"]);
      return recipient;
    },
    removeNewsletterRecipient(tenantId, email) {
      const changed = ops.removeNewsletterRecipient(requireState(), tenantId, email);
      if (!changed) return changed;
      save();
      mandant.schreiben(tenantId, ["newsletterRecipients"]);
      return changed;
    },
    confirmNewsletterRecipientByToken(tokenHash, nowIso) {
      const result = ops.confirmNewsletterRecipientByToken(requireState(), tokenHash, nowIso);
      if (!result) return result;
      save();
      mandant.schreiben(result.tenantId, ["newsletterRecipients"]);
      return result;
    },
    unsubscribeNewsletterRecipientByToken(token) {
      const result = ops.unsubscribeNewsletterRecipientByToken(requireState(), token);
      if (!result) return result;
      save();
      mandant.schreiben(result.tenantId, ["newsletterRecipients"]);
      return result;
    },

    addNotification(title, body, callId) {
      const state = requireState();
      const spiegeln = () => {
        ops.addNotification(state, title, body, callId);
        save();
      };
      if (!callId) return spiegeln();
      return posteingang.benachrichtigen(state, { title, body, callId }).then((angelegt) => {
        if (!angelegt) spiegeln();
      });
    },

    seedBootstrapNumber(e164, tenantId, provider) {
      ops.seedBootstrapNumber(requireState(), e164, tenantId, provider);
      return save();
    },

    bootstrapTenant(e164, tenantId, provider) {
      ops.bootstrapTenant(requireState(), e164, tenantId, provider);
      return save();
    },
  };
}

function verwaltungMethoden({ requireState, save, gebunden, eigene, runner, einstellungen, profil, anrufe, anrufExport, posteingang, mandant }) {
  return {
    async pruneOldData(
      days = config.privacy.retentionDays,
      diagnosticDays = config.privacy.diagnosticRetentionDays,
      evidenceDays = config.privacy.evidenceRetentionDays,
    ) {
      const fristen = {
        retentionDays: days,
        diagnosticRetentionDays: diagnosticDays,
        evidenceRetentionDays: evidenceDays,
      };
      const state = requireState();
      const ausDatenbank = await anrufe.aufbewahren(fristen);
      const removed = { ...ops.pruneOldData(state, fristen), ...ausDatenbank };
      entbindeEntfernte([gebunden, eigene], state);
      if (ops.hasPrunedSomething(removed)) save();
      return removed;
    },

    async eraseTenantData(tenantId) {
      const state = requireState();
      const geloescht = await anrufe.mandantLoeschen(tenantId);
      const removed = { ...ops.eraseTenantData(state, tenantId), ...geloescht };
      entbindeEntfernte([gebunden, eigene], state);
      if (removed.calls || removed.actionItems || removed.notifications || removed.privateNumber) save();
      if (removed.privateNumber) mandant.schreiben(tenantId, ["privateNumber"]);
      return removed;
    },
    exportTenantData: (tenantId) => ops.exportTenantData(requireState(), tenantId),
    zaehleAnrufeSeit: (tenantId, seitIso) => anrufExport.zaehleSeit(tenantId, seitIso),
    async exportTenantDataGelesen(tenantId, { anrufe, bericht } = {}) {
      if (bericht) return { calls: await anrufExport.berichte() };
      const gelesen = anrufe ? await anrufExport.neueste(tenantId, anrufe) : await anrufExport.lies(tenantId);
      const { actionItems, notifications } = await posteingang.mandantLesen(tenantId);
      const callIds = new Set(gelesen.map((call) => call.id));
      const auszug = ops.exportTenantData(requireState(), tenantId, gelesen);
      return {
        ...auszug,
        actionItems: actionItems.filter((punkt) => callIds.has(punkt.callId)),
        notifications: notifications.filter((meldung) => callIds.has(meldung.callId)),
      };
    },

    updateSettings(tenantId, patch) {
      const state = requireState();
      const vorher = { ...ops.settingsFor(state, tenantId) };
      const result = ops.updateSettings(state, tenantId, patch);
      const ohneStand = einstellungen.abschaltungenOhneStand(tenantId, patch);
      result.changed.push(...ohneStand.filter((schluessel) => !result.changed.includes(schluessel)));
      if (result.changed.length) {
        const geschrieben = einstellungen.schreiben(tenantId, { schluessel: result.changed, vorher });
        Object.defineProperty(result, "geschrieben", { value: geschrieben });
      }
      return result;
    },

    resolveProfile: (tenantId) => ops.resolveProfile(requireState(), tenantId),
    resolveTenant: (idpSubject) => ops.resolveTenant(requireState(), idpSubject),
    bindSubToTenant: (sub, tenantId) => ops.bindSubToTenant(requireState(), sub, tenantId),

    async ensureTenant(tenantId) {
      try {
        const state = requireState();
        return await runner.withClient(async (client) => {
          const statusRows = (
            await client.query(`SELECT status FROM tenant WHERE id = $1`, [tenantId])
          ).rows;
          if (statusRows.length === 0) return false;
          const present = ops.findTenant(state, tenantId);
          if (present) {
            present.status = statusRows[0].status;
            return true;
          }
          const full = (
            await client.query(`SELECT ${TENANT_COLUMNS} FROM tenant WHERE id = $1`, [tenantId])
          ).rows[0];
          const raced = ops.findTenant(state, tenantId);
          if (raced) {
            raced.status = full.status;
            return true;
          }
          state.tenants.push(rowToTenant(full));
          await hydrateTenant(client, state, tenantId);
          return true;
        });
      } catch (err) {
        console.error("[pg] ensureTenant fehlgeschlagen:", err.message);
        return false;
      }
    },
    listProfiles: () => ops.listProfiles(requireState()),
    setProfile(tenantId, patch) {
      const result = ops.setProfile(requireState(), tenantId, patch);
      profil.schreiben(tenantId, Object.fromEntries(result.changed.map((key) => [key, result.profile[key]])));
      return result;
    },
    deleteProfile(tenantId) {
      const ok = ops.deleteProfile(requireState(), tenantId);
      if (ok) profil.loeschen(tenantId);
      return ok;
    },
  };
}

async function aufbauen(client, prepareSchema) {
  await setTenant(client, BOOTSTRAP_TENANT_ID);
  await prepareSchema(client, BOOTSTRAP_TENANT_ID);
  const state = await hydrate(client);
  if (ops.seedBootstrapIdpSubject(state, config.auth.ownerIdpSubject, BOOTSTRAP_TENANT_ID))
    await sperreSchreiben(client, BOOTSTRAP_TENANT_ID, {
      idpSubject: ops.findTenant(state, BOOTSTRAP_TENANT_ID).idpSubject,
    });
  if (ops.seedBootstrapKyc(state, BOOTSTRAP_TENANT_ID))
    await sperreSchreiben(client, BOOTSTRAP_TENANT_ID, { kycLevel: KYC_LEVEL.ID_VERIFIED });
  for (const tenantId of backfillGreetingNotices(state)) {
    await setTenant(client, tenantId);
    await einstellungenSchreiben(client, tenantId, {
      settings: ops.settingsFor(state, tenantId),
      schluessel: ["greeting"],
    });
  }
  await setTenant(client, BOOTSTRAP_TENANT_ID);
  return state;
}

async function setTenant(client, tenantId) {
  await client.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantId]);
}

async function hydrateTenant(client, state, tenantId) {
  await setTenant(client, tenantId);
  await hydrateTenantInto(client, state, tenantId);
}

async function hydrate(client) {
  const state = ops.makeDefaultState();
  state.tenants = await hydrateTenants(client);
  for (const tenant of state.tenants) {
    await hydrateTenant(client, state, tenant.id);
  }
  state.profiles = await hydrateProfiles(client);
  state.platformTtsUsage = await hydratePlatformTtsUsage(client);
  ops.usageFor(state, ops.PLATFORM_TTS_COST_CENTER_ID).ttsCharacters =
    await hydratePlatformKostenstelleZeichen(client);
  state.costCrossCheck = await hydrateCostCrossCheck(client);
  state.anrufpause = await hydrateAnrufpause(client);
  state.platformNumberUse = await hydratePlatformNumberUse(client);
  state.outageAlerts = await hydrateOutageAlerts(client);
  await hydrateSubIndex(client, state);
  return state;
}

async function hydrateProfiles(client) {
  const rows = (await client.query(`SELECT tenant_id, data FROM profile`)).rows;
  return Object.fromEntries(rows.map((r) => [r.tenant_id, r.data]));
}

async function hydratePlatformTtsUsage(client) {
  const rows = (
    await client.query(`SELECT cycle_key, characters, warned_cycle FROM platform_tts_usage WHERE id = 1`)
  ).rows;
  if (rows.length === 0) return emptyPlatformTtsUsage();
  const r = rows[0];
  return { cycleKey: r.cycle_key, characters: Number(r.characters), warnedCycle: r.warned_cycle };
}

async function hydratePlatformKostenstelleZeichen(client) {
  const rows = (
    await client.query(`SELECT kostenstelle_zeichen FROM platform_tts_usage WHERE id = 1`)
  ).rows;
  return rows.length === 0 ? 0 : Number(rows[0].kostenstelle_zeichen);
}

async function hydrateCostCrossCheck(client) {
  const rows = (
    await client.query(`SELECT last_checked_month_key FROM cost_cross_check WHERE id = 1`)
  ).rows;
  if (rows.length === 0) return emptyCostCrossCheck();
  return { lastCheckedMonthKey: rows[0].last_checked_month_key };
}

async function hydrateAnrufpause(client) {
  const { rows } = await client.query(`SELECT an FROM platform_anrufpause WHERE id = 1`);
  return rows[0]?.an === true;
}

async function hydratePlatformNumberUse(client) {
  const rows = (
    await client.query(
      `SELECT id, e164, purpose, provider, tenant_id, provider_number_id, bound_at, released_at, note
         FROM platform_number_use ORDER BY bound_at`,
    )
  ).rows;
  return rows.map((row) => ({
    id: row.id, e164: row.e164, purpose: row.purpose, provider: row.provider,
    tenantId: row.tenant_id, providerNumberId: row.provider_number_id,
    boundAt: row.bound_at instanceof Date ? row.bound_at.toISOString() : row.bound_at,
    releasedAt: row.released_at instanceof Date ? row.released_at.toISOString() : (row.released_at ?? null),
    note: row.note,
  }));
}

async function hydrateOutageAlerts(client) {
  const rows = (
    await client.query(
      `SELECT id, code, first_seen_at, last_seen_at, last_attempt_at, reported_at,
              delivered_channels, closed_at
         FROM outage_alert ORDER BY first_seen_at`,
    )
  ).rows;
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    firstSeenAt: row.first_seen_at instanceof Date ? row.first_seen_at.toISOString() : row.first_seen_at,
    lastSeenAt: row.last_seen_at instanceof Date ? row.last_seen_at.toISOString() : row.last_seen_at,
    lastAttemptAt: row.last_attempt_at instanceof Date ? row.last_attempt_at.toISOString() : (row.last_attempt_at ?? null),
    reportedAt: row.reported_at instanceof Date ? row.reported_at.toISOString() : (row.reported_at ?? null),
    deliveredChannels: row.delivered_channels,
    closedAt: row.closed_at instanceof Date ? row.closed_at.toISOString() : (row.closed_at ?? null),
  }));
}

async function hydrateSubIndex(client, state) {
  const rows = (await client.query(`SELECT sub, tenant_id FROM account`)).rows;
  for (const r of rows) ops.bindSubToTenant(state, r.sub, r.tenant_id);
}

const TENANT_COLUMNS =
  "id, status, owner_name, first_name, idp_subject, kyc_level, stripe_customer_id, " +
  "stripe_payment_method_id, stripe_payment_method_type, stripe_subscription_id, stripe_plan_slug, " +
  "stripe_current_period_end, stripe_current_period_start, stripe_number_setup_fee_exempt, " +
  "country, default_language, timezone, private_number, number_provision_skip_reason, number_provision_skip_at, " +
  "suspended_at, stripe_activation_pending, stripe_billing_hold, stripe_billing_hold_due_at, " +
  "stripe_period_credit_revoked, stripe_cancel_at_period_end, " +
  "number_release_pending, workos_delete_pending, " +
  "cancellation_mail_pending, cancellation_mail_received_at, " +
  "newsletter_consent, newsletter_consent_at, " +
  "newsletter_recipients, newsletter_confirm_mail_log";

function rowToTenant(r) {
  const tenant = { id: r.id, status: r.status };
  if (r.owner_name != null) tenant.ownerName = r.owner_name;
  if (r.first_name != null) tenant.firstName = r.first_name;
  if (r.idp_subject != null) tenant.idpSubject = r.idp_subject;
  if (r.kyc_level != null) tenant.kycLevel = r.kyc_level;
  if (r.stripe_customer_id != null) tenant.stripeCustomerId = r.stripe_customer_id;
  if (r.stripe_payment_method_id != null) tenant.stripePaymentMethodId = r.stripe_payment_method_id;
  if (r.stripe_payment_method_type != null)
    tenant.stripePaymentMethodType = r.stripe_payment_method_type;
  if (r.stripe_subscription_id != null) tenant.stripeSubscriptionId = r.stripe_subscription_id;
  if (r.stripe_plan_slug != null) tenant.stripePlanSlug = r.stripe_plan_slug;
  if (r.stripe_current_period_end != null)
    tenant.stripeCurrentPeriodEnd = Number(r.stripe_current_period_end);
  if (r.stripe_current_period_start != null)
    tenant.stripeCurrentPeriodStart = Number(r.stripe_current_period_start);
  if (r.stripe_number_setup_fee_exempt != null)
    tenant.stripeNumberSetupFeeExempt = r.stripe_number_setup_fee_exempt;
  if (r.country != null) tenant.country = r.country;
  if (r.default_language != null) tenant.defaultLanguage = r.default_language;
  if (r.timezone != null) tenant.timezone = r.timezone;
  if (r.private_number != null) tenant.privateNumber = r.private_number;
  if (r.number_provision_skip_reason != null)
    tenant.numberProvisionSkipReason = r.number_provision_skip_reason;
  if (r.number_provision_skip_at != null) tenant.numberProvisionSkipAt = r.number_provision_skip_at;
  if (r.suspended_at != null) tenant.suspendedAt = r.suspended_at;
  if (r.stripe_activation_pending != null) tenant.stripeActivationPending = r.stripe_activation_pending;
  if (r.stripe_billing_hold != null) tenant.billingHold = r.stripe_billing_hold;
  if (r.stripe_billing_hold_due_at != null) tenant.billingHoldDueAt = r.stripe_billing_hold_due_at;
  if (r.stripe_period_credit_revoked != null)
    tenant.stripePeriodCreditRevoked = r.stripe_period_credit_revoked;
  if (r.stripe_cancel_at_period_end != null)
    tenant.stripeCancelAtPeriodEnd = r.stripe_cancel_at_period_end;
  if (r.number_release_pending != null) tenant.numberReleasePending = r.number_release_pending;
  if (r.workos_delete_pending != null) tenant.workosDeletePending = r.workos_delete_pending;
  if (r.cancellation_mail_pending != null) tenant.cancellationMailPending = r.cancellation_mail_pending;
  if (r.cancellation_mail_received_at != null)
    tenant.cancellationMailReceivedAt = r.cancellation_mail_received_at;
  if (r.newsletter_consent != null) tenant.newsletterConsent = r.newsletter_consent;
  if (r.newsletter_consent_at != null) tenant.newsletterConsentAt = r.newsletter_consent_at;
  if (r.newsletter_recipients != null) tenant.newsletterRecipients = r.newsletter_recipients;
  if (r.newsletter_confirm_mail_log != null)
    tenant.newsletterConfirmMailLog = r.newsletter_confirm_mail_log;
  return tenant;
}

async function hydrateTenants(client) {
  const rows = (await client.query(`SELECT ${TENANT_COLUMNS} FROM tenant`)).rows;
  return rows.map(rowToTenant);
}

async function hydrateCallCostEvidence(client, tenantId) {
  const rows = (
    await client.query(
      `SELECT id, tenant_id, call_id, traeger, reife, betrag_mikro_cents, waehrung, quelle,
              beleg_ref, versuche, gemessen_at, abstand_zum_gespraechsende_s, detail,
              nachreifbar
         FROM call_cost_evidence WHERE tenant_id = $1 ORDER BY id ASC`,
      [tenantId],
    )
  ).rows;
  return rows.map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    callId: row.call_id,
    traeger: row.traeger,
    reife: row.reife,
    betragMikroCents:
      row.betrag_mikro_cents === null || row.betrag_mikro_cents === undefined
        ? null
        : Number(row.betrag_mikro_cents),
    waehrung: row.waehrung ?? null,
    quelle: row.quelle ?? null,
    belegRef: row.beleg_ref ?? null,
    versuche: Number(row.versuche),
    gemessenAt: row.gemessen_at ?? null,
    abstandZumGespraechsendeS: row.abstand_zum_gespraechsende_s ?? null,
    detail: row.detail ?? null,
    nachreifbar: row.nachreifbar,
  }));
}

async function loadTenantRows(client, tenantId) {
  const settingsRows = (
    await client.query(`SELECT * FROM settings WHERE tenant_id = $1`, [tenantId])
  ).rows;
  const itemRows = (
    await client.query(`SELECT * FROM action_item WHERE tenant_id = $1 ORDER BY seq DESC`, [
      tenantId,
    ])
  ).rows;
  const calRows = (
    await client.query(`SELECT * FROM calendar_event WHERE tenant_id = $1 ORDER BY seq ASC`, [
      tenantId,
    ])
  ).rows;
  const usageRows = (await client.query(`SELECT * FROM usage WHERE tenant_id = $1`, [tenantId]))
    .rows;
  const notifRows = (
    await client.query(`SELECT * FROM notification WHERE tenant_id = $1 ORDER BY seq DESC`, [
      tenantId,
    ])
  ).rows;
  const numberRows = (
    await client.query(
      `SELECT id, e164, tenant_id, provider, status, provider_number_id, payment_intent_id, country, language, monthly_cost_cents, provider_agent_phone_number_id, el_inbound_trunk_belegt_at, el_inbound_trunk_zugang_fp FROM number WHERE tenant_id = $1`,
      [tenantId],
    )
  ).rows;
  const jobRows = (
    await client.query(
      `SELECT id, tenant_id, number_id, kind, status, idempotency_key, attempts, last_error, created_at
       FROM provisioning_job WHERE tenant_id = $1`,
      [tenantId],
    )
  ).rows;
  const budgetRows = (
    await client.query(
      `SELECT tenant_id, budget_cents, hard_cap_cents FROM tenant_budget WHERE tenant_id = $1`,
      [tenantId],
    )
  ).rows;
  const ueRows = (
    await client.query(
      `SELECT id, tenant_id, call_id, number_id, kind, quantity, cost_cents, cost_micro_cents, occurred_at, stripe_meter_sent
       FROM usage_event WHERE tenant_id = $1 ORDER BY id ASC`,
      [tenantId],
    )
  ).rows;
  return {
    settingsRows,
    itemRows,
    calRows,
    usageRows,
    notifRows,
    numberRows,
    jobRows,
    budgetRows,
    ueRows,
  };
}

async function pruefeAnrufZustaende(client, tenantId) {
  const unbekannt = (
    await client.query(`SELECT id, status FROM call WHERE tenant_id = $1 AND status <> ALL($2) LIMIT 1`, [
      tenantId,
      [...ANRUF_ZUSTAENDE],
    ])
  ).rows;
  unbekannt.forEach(pruefeAnrufZustand);
}

async function hydrateTenantInto(client, state, tenantId) {
  const rows = await loadTenantRows(client, tenantId);
  await pruefeAnrufZustaende(client, tenantId);
  if (rows.settingsRows.length) {
    Object.assign(state.settings, { [tenantId]: rowToSettings(rows.settingsRows[0]) });
  }
  if (rows.usageRows.length) {
    Object.assign(state.usage, { [tenantId]: rowToUsage(rows.usageRows[0]) });
    nutzungGeladen(state, tenantId, state.usage[tenantId]);
  }
  Object.assign(state.calendar, { [tenantId]: rows.calRows.map(rowToCalendarEvent) });
  state.actionItems.push(...rows.itemRows.map(rowToActionItem));
  state.notifications.push(...rows.notifRows.map(rowToNotification));
  state.numbers.push(...rows.numberRows.map(rowToNumber));
  state.provisioningJobs.push(...rows.jobRows.map(rowToProvisioningJob));
  state.tenantBudgets.push(...rows.budgetRows.map(rowToTenantBudget));
  state.usageEvents.push(...rows.ueRows.map(rowToUsageEvent));
  state.callCostEvidence.push(...(await hydrateCallCostEvidence(client, tenantId)));
}

function zeilenZuAnrufen(callRows, segRows, itemRows) {
  const segmentsByCall = groupTranscripts(segRows);
  const itemIdsByCall = groupActionItemIds(itemRows);
  return callRows.map((zeile) => rowToCall(zeile, segmentsByCall, itemIdsByCall));
}

function groupTranscripts(segRows) {
  const byCall = new Map();
  for (const r of segRows) {
    if (!byCall.has(r.call_id)) byCall.set(r.call_id, []);
    byCall.get(r.call_id).push({ role: r.role, text: r.text, at: r.at });
  }
  return byCall;
}

function groupActionItemIds(itemRows) {
  const byCall = new Map();
  for (let i = itemRows.length - 1; i >= 0; i--) {
    const r = itemRows[i];
    if (r.call_id == null) continue;
    if (!byCall.has(r.call_id)) byCall.set(r.call_id, []);
    byCall.get(r.call_id).push(r.id);
  }
  return byCall;
}

function hydratedMicroCents(raw) {
  return raw === null || raw === undefined ? null : Number(raw);
}

function absenderWahrheitFelder(r) {
  return {
    fromActualE164: r.from_actual_e164 ?? null,
    fromSource: r.from_source ?? null,
    fromRegistrationSource: r.from_registration_source ?? null,
  };
}
function absenderWahrheitWerte(call) {
  return [call.fromActualE164 ?? null, call.fromSource ?? null, call.fromRegistrationSource ?? null];
}

function elDetektorFelder(zeile) {
  return { elDetectorCounts: zeile.el_detector_counts ?? null };
}
function elDetektorWerte(call) {
  return [call.elDetectorCounts ? JSON.stringify(call.elDetectorCounts) : null];
}

function absenderWahrheitMutatoren({ requireState, save }) {
  return {
    recordFromRegistrationSource(callId, quelle) {
      const { call, changed } = ops.recordFromRegistrationSource(requireState(), callId, quelle);
      if (changed) save();
      return call;
    },
    recordActualSender(callId, herkunft) {
      const { call, changed } = ops.recordActualSender(requireState(), callId, herkunft);
      if (changed) save();
      return call;
    },
  };
}

function kostenAbschlussMutatoren({ requireState, save }) {
  return {
    schliesseKostenAbgleich(callId, eingabe) {
      const { call, changed } = ops.schliesseKostenAbgleich(requireState(), callId, eingabe);
      if (changed) save();
      return call;
    },
    oeffneKostenAbgleichErneut(callId) {
      const { call, changed } = ops.oeffneKostenAbgleichErneut(requireState(), callId);
      if (changed) save();
      return call;
    },
  };
}

function isoZeitpunktOderNull(wert) {
  return wert instanceof Date ? wert.toISOString() : (wert ?? null);
}
function brueckenZustandFelder(zeile) {
  return {
    elBoundAt: isoZeitpunktOderNull(zeile.el_bound_at),
    elFallbackAt: isoZeitpunktOderNull(zeile.el_fallback_at),
    elNachlaufStartedAt: isoZeitpunktOderNull(zeile.el_nachlauf_started_at),
  };
}
function brueckenZustandWerte(call) {
  return [call.elBoundAt ?? null, call.elFallbackAt ?? null, call.elNachlaufStartedAt ?? null];
}
function brueckenKennungFelder(zeile) {
  return {
    bridgedAt: isoZeitpunktOderNull(zeile.bridged_at),
    elCallControlId: zeile.el_call_control_id ?? null,
  };
}
function brueckenKennungWerte(call) {
  return [call.bridgedAt ?? null, call.elCallControlId ?? null];
}
function inboundTrunkBelegFelder(zeile) {
  const belegtAt = isoZeitpunktOderNull(zeile.el_inbound_trunk_belegt_at);
  if (belegtAt === null) return {};
  return { elInboundTrunkBelegtAt: belegtAt, elInboundTrunkZugangFp: zeile.el_inbound_trunk_zugang_fp ?? null };
}
function inboundTrunkBelegWerte(nummer) {
  return [nummer.elInboundTrunkBelegtAt ?? null, nummer.elInboundTrunkZugangFp ?? null];
}
function mitSpeichernBeiAenderung(save) {
  return (ergebnis) => {
    if (ergebnis.changed) save();
    return ergebnis;
  };
}
function brueckenZustandMutatoren({ requireState, save }) {
  const speichereBeiAenderung = mitSpeichernBeiAenderung(save);
  return {
    bindInboundElConversation(callId, bindung) {
      return speichereBeiAenderung(ops.bindInboundElConversation(requireState(), callId, bindung));
    },
    markInboundElFallback(callId, nowIso) {
      return speichereBeiAenderung(ops.markInboundElFallback(requireState(), callId, nowIso));
    },
    markInboundElNachlaufStarted(callId, nowIso) {
      return speichereBeiAenderung(ops.markInboundElNachlaufStarted(requireState(), callId, nowIso));
    },
  };
}
function inboundTrunkBelegMutatoren({ requireState, save }) {
  const speichereBeiAenderung = mitSpeichernBeiAenderung(save);
  return {
    markNumberElInboundTrunkBelegt(numberId, beleg) {
      return speichereBeiAenderung(ops.markNumberElInboundTrunkBelegt(requireState(), numberId, beleg));
    },
    clearNumberElInboundTrunkBeleg(numberId) {
      return speichereBeiAenderung(ops.clearNumberElInboundTrunkBeleg(requireState(), numberId));
    },
  };
}

function anrufStammFelder(zeile) {
  return {
    id: zeile.id,
    tenantId: zeile.tenant_id,
    streamToken: zeile.stream_token,
    twilioSid: zeile.twilio_sid,
    direction: zeile.direction,
    from: zeile.from_e164,
    to: zeile.to_e164,
    goal: zeile.goal,
    openingLine: zeile.opening_line ?? null,
    openingLineSha256: zeile.opening_line_sha256 ?? null,
    briefing: zeile.briefing,
    constraints: zeile.constraints,
    context: zeile.context ?? null,
    mandate: zeile.mandate ?? null,
    callerName: zeile.caller_name,
    language: zeile.language,
    maxDurationS: zeile.max_duration_s,
    requestedBy: zeile.requested_by,
    provider: zeile.provider,
    status: zeile.status,
  };
}

function anrufVerlaufFelder(zeile) {
  return {
    startedAt: zeile.started_at,
    answeredAt: zeile.answered_at,
    answeredUnclearReason: zeile.answered_unclear_reason ?? null,
    appointmentDate: zeile.appointment_date ?? null,
    appointmentTime: zeile.appointment_time ?? null,
    amount: zeile.amount ?? null,
    currency: zeile.currency ?? null,
    calleeConfirmedTimezone: zeile.callee_confirmed_timezone ?? null,
    calleeConfirmedTimezoneOrigin: zeile.callee_confirmed_timezone_origin ?? null,
    calleeConfirmedTimezoneAt: zeile.callee_confirmed_timezone_at ?? null,
  };
}

function anrufAbschlussFelder(zeile) {
  return {
    summary: zeile.summary,
    objectiveAchieved: deserializeObjective(zeile.objective_achieved),
    summarySmsSentAt: zeile.summary_sms_sent_at ?? null,
    summaryMailSentAt: zeile.summary_mail_sent_at ?? null,
    notPlacedMailSentAt: zeile.not_placed_mail_sent_at ?? null,
    failureReason: zeile.failure_reason ?? null,
    billedAt: zeile.billed_at ?? null,
    callControlId: zeile.call_control_id ?? null,
    assistantId: zeile.assistant_id ?? null,
    diagnostic: zeile.diagnostic === true,
    calleeIsOwner: zeile.callee_is_owner === true,
    callerIsOwner: zeile.caller_is_owner === true,
    inboxEntryAt: zeile.inbox_entry_at ?? null,
    inboxSeenAt: zeile.inbox_seen_at ?? null,
  };
}

function anrufKostenFelder(zeile) {
  return {
    estimatedCostCents: zeile.estimated_cost_cents ?? null,
    estimatedCostSpendMonthKey: zeile.estimated_cost_spend_month_key ?? null,
    estimatedCostPeriodKey: zeile.estimated_cost_period_key ?? null,
    actualCostMicroCents: hydratedMicroCents(zeile.actual_cost_micro_cents),
    costTruedAt: zeile.cost_trued_at ?? null,
    costTruedSource: zeile.cost_trued_source ?? null,
    costTruingAttempts: zeile.cost_truing_attempts ?? 0,
  };
}

function anrufKennungenFelder(zeile) {
  return {
    telnyxConversationId: zeile.telnyx_conversation_id ?? null,
    elevenlabsConversationId: zeile.elevenlabs_conversation_id ?? null,
    sipCallId: zeile.sip_call_id ?? null,
    instanz: zeile.instanz ?? null,
    costProfile: zeile.cost_profile ?? null,
    callerTurns: zeile.caller_turns ?? 0,
    result: zeile.result ?? null,
    consults: zeile.consults ?? null,
    lookupLog: zeile.lookup_log ?? null,
    noSpeechStreak: Number(zeile.no_speech_streak),
    lookups: Number(zeile.lookups),
    consultPolledAtMs: Number(zeile.consult_polled_at_ms),
  };
}

function pruefeAnrufZustand(zeile) {
  if (anrufZustandVon(zeile.status) === null) {
    throw new Error(`Anruf ${zeile.id}: unbekannter Zustand "${zeile.status}"`);
  }
}

function rowToCall(zeile, segmentsByCall, itemIdsByCall) {
  pruefeAnrufZustand(zeile);
  return {
    ...anrufStammFelder(zeile),
    ...anrufVerlaufFelder(zeile),
    endedAt: zeile.ended_at,
    transcript: segmentsByCall.get(zeile.id) || [],
    ...anrufAbschlussFelder(zeile),
    ...anrufKostenFelder(zeile),
    ...anrufKennungenFelder(zeile),
    actionItemIds: itemIdsByCall.get(zeile.id) || [],
    webhookAnchors: zeile.webhook_anchors ?? [],
    ...absenderWahrheitFelder(zeile),
    ...elDetektorFelder(zeile),
    ...brueckenZustandFelder(zeile),
    ...brueckenKennungFelder(zeile),
  };
}

function rowToActionItem(r) {
  return {
    id: r.id,
    callId: r.call_id,
    text: r.text,
    type: r.type,
    done: r.done,
    createdAt: r.created_at,
  };
}

function rowToCalendarEvent(r) {
  return { id: r.id, title: r.title, start: r.starts_at, end: r.ends_at };
}

function rowToUsage(r) {
  return {
    inputTokens: Number(r.input_tokens),
    outputTokens: Number(r.output_tokens),
    costCents: hydratedCostCents(r.cost_eur),
    costMicroCentsRem: 0,
    calls: Number(r.calls),
    spendMonthKey: r.spend_month_key ?? null,
    spendMonthCostCents: Number(r.spend_month_cost_cents ?? 0),
    costCorrectionMicroCentsRem: Number(r.cost_correction_micro_cents_rem ?? 0),
    ttsCharacters: Number(r.tts_characters ?? 0),
    budgetPeriodKey: r.budget_period_key ?? null,
    budgetPeriodBaselineCents: Number(r.budget_period_baseline_cents ?? 0),
  };
}

function rowToNotification(r) {
  return { id: r.id, title: r.title, body: r.body, callId: r.call_id, at: r.at };
}

async function flush(client, state, { preFlush, gebunden }) {
  const [beginn, frist] = flushAnfang();
  await client.query(beginn.text);
  try {
    await client.query(frist.text, frist.params);
    if (preFlush) await preFlush(client);
    const geschrieben = [];
    const abdruecke = [];
    await flushTenants(client, state.tenants);
    await flushPlatformNumberUse(client, state.platformNumberUse);
    await flushOutageAlerts(client, state.outageAlerts);
    for (const tenant of state.tenants) {
      await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenant.id]);
      await flushTenantScope(client, state, { tenantId: tenant.id, geschrieben, abdruecke, gebunden });
    }
    await flushPlatformTtsUsage(client, state);
    await flushCostCrossCheck(client, state.costCrossCheck);
    await client.query("COMMIT");
    inDatenbankMerken(geschrieben);
    for (const [call, abdruck] of abdruecke) geschriebeneAnrufe.set(call, abdruck);
    nutzungBestaetigen(state);
  } catch (err) {
    nutzungVerwerfen(state);
    await client.query("ROLLBACK");
    throw err;
  }
}

async function flushTenantScope(client, state, { tenantId, geschrieben, abdruecke, gebunden }) {
  const { calls, callIds } = ops.tenantCallScope(state, tenantId);
  await flushCalls(client, { tenantId, calls, abdruecke, gebunden });
  geschrieben.push(
    ...(await ausstehendeSchreiben(client, tenantId, {
      punkte: state.actionItems.filter((item) => callIds.has(item.callId)),
      meldungen: notificationsForTenant(state, tenantId, callIds),
    })),
  );
  await flushCalendar(client, tenantId, ops.calendarFor(state, tenantId));
  await nutzungSchreiben(client, state, tenantId);
  await flushNumbers(client, tenantId, state.numbers);
  await flushProvisioningJobs(client, tenantId, state.provisioningJobs);
  await flushTenantBudgets(client, tenantId, state.tenantBudgets);
  await flushUsageEvents(client, tenantId, state.usageEvents);
  await flushCallCostEvidence(client, tenantId, state.callCostEvidence);
}

async function flushTenants(client, tenants) {
  for (const t of tenants) {
    await client.query(
      `INSERT INTO tenant (id, status, owner_name, first_name, idp_subject, kyc_level, stripe_customer_id, stripe_payment_method_id, stripe_payment_method_type, stripe_subscription_id, stripe_plan_slug, stripe_current_period_end, stripe_current_period_start, stripe_number_setup_fee_exempt, country, default_language, timezone, private_number, number_provision_skip_reason, number_provision_skip_at, suspended_at, stripe_activation_pending, stripe_billing_hold, stripe_billing_hold_due_at, stripe_period_credit_revoked, stripe_cancel_at_period_end, number_release_pending, workos_delete_pending, cancellation_mail_pending, cancellation_mail_received_at, newsletter_consent, newsletter_consent_at, newsletter_recipients, newsletter_confirm_mail_log)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34)
       ON CONFLICT (id) DO UPDATE SET id=EXCLUDED.id`,
      [
        t.id,
        t.status,
        t.ownerName ?? null,
        t.firstName ?? null,
        t.idpSubject ?? null,
        t.kycLevel ?? null,
        t.stripeCustomerId ?? null,
        t.stripePaymentMethodId ?? null,
        t.stripePaymentMethodType ?? null,
        t.stripeSubscriptionId ?? null,
        t.stripePlanSlug ?? null,
        t.stripeCurrentPeriodEnd ?? null,
        t.stripeCurrentPeriodStart ?? null,
        t.stripeNumberSetupFeeExempt ?? null,
        t.country ?? null,
        t.defaultLanguage ?? null,
        t.timezone ?? null,
        t.privateNumber ?? null,
        t.numberProvisionSkipReason ?? null,
        t.numberProvisionSkipAt ?? null,
        t.suspendedAt ?? null,
        t.stripeActivationPending ?? null,
        t.billingHold ?? null,
        t.billingHoldDueAt ?? null,
        t.stripePeriodCreditRevoked ?? null,
        t.stripeCancelAtPeriodEnd ?? null,
        t.numberReleasePending ?? null,
        t.workosDeletePending ?? null,
        t.cancellationMailPending ?? null,
        t.cancellationMailReceivedAt ?? null,
        t.newsletterConsent ?? null,
        t.newsletterConsentAt ?? null,
        t.newsletterRecipients ? JSON.stringify(t.newsletterRecipients) : null,
        t.newsletterConfirmMailLog ? JSON.stringify(t.newsletterConfirmMailLog) : null,
      ],
    );
  }
}

function notificationsForTenant(state, tenantId, callIds) {
  return state.notifications.filter(
    (notification) =>
      callIds.has(notification.callId) ||
      (notification.callId == null && tenantId === BOOTSTRAP_TENANT_ID),
  );
}

function anrufStammWerte(call, tenantId) {
  return [
    call.id,
    tenantId,
    call.streamToken,
    call.twilioSid,
    call.direction,
    call.from,
    call.to,
    call.goal,
    call.briefing,
    call.constraints,
    call.callerName,
    call.language,
    call.maxDurationS,
    call.requestedBy,
    call.status,
    call.startedAt,
    call.answeredAt,
    call.endedAt,
    call.summary,
    serializeObjective(call.objectiveAchieved),
    call.provider || DEFAULT_PROVIDER,
    call.summarySmsSentAt ?? null,
    call.context ? JSON.stringify(call.context) : null,
    call.failureReason ?? null,
    call.billedAt ?? null,
    call.callControlId ?? null,
    call.assistantId ?? null,
  ];
}

function anrufMandatKostenWerte(call) {
  return [
    call.diagnostic === true,
    call.mandate ? JSON.stringify(call.mandate) : null,
    call.estimatedCostCents ?? null,
    call.actualCostMicroCents ?? null,
    call.costTruedAt ?? null,
    call.costTruedSource ?? null,
    call.costTruingAttempts ?? 0,
  ];
}

function anrufKennungenErgebnisWerte(call) {
  return [
    call.telnyxConversationId ?? null,
    call.callerTurns ?? 0,
    call.result ? JSON.stringify(call.result) : null,
    call.consults ? JSON.stringify(call.consults) : null,
    call.estimatedCostSpendMonthKey ?? null,
    call.estimatedCostPeriodKey ?? null,
    call.elevenlabsConversationId ?? null,
    call.answeredUnclearReason ?? null,
  ];
}

function anrufTerminWerte(call) {
  return [
    call.appointmentDate ?? null,
    call.appointmentTime ?? null,
    call.amount ?? null,
    call.currency ?? null,
    call.calleeConfirmedTimezone ?? null,
    call.calleeConfirmedTimezoneOrigin ?? null,
    call.calleeConfirmedTimezoneAt ?? null,
    call.sipCallId ?? null,
  ];
}

function anrufPosteingangWerte(call) {
  return [
    call.openingLine ?? null,
    call.openingLineSha256 ?? null,
    call.lookupLog ? JSON.stringify(call.lookupLog) : null,
    call.summaryMailSentAt ?? null,
    call.calleeIsOwner === true,
    call.inboxEntryAt ?? null,
    call.inboxSeenAt ?? null,
  ];
}

function callRowValues(call, tenantId) {
  return [
    ...anrufStammWerte(call, tenantId),
    ...anrufMandatKostenWerte(call),
    ...anrufKennungenErgebnisWerte(call),
    ...anrufTerminWerte(call),
    ...anrufPosteingangWerte(call),
    ...absenderWahrheitWerte(call),
    call.costProfile ?? null,
    ...elDetektorWerte(call),
    call.webhookAnchors?.length ? JSON.stringify(call.webhookAnchors) : null,
    ...brueckenZustandWerte(call),
    call.callerIsOwner === true,
    call.notPlacedMailSentAt ?? null,
    ...brueckenKennungWerte(call),
    call.instanz ?? null,
    call.noSpeechStreak ?? 0,
    call.lookups ?? 0,
    call.consultPolledAtMs ?? 0,
  ];
}

async function flushCalls(client, { tenantId, calls, abdruecke, gebunden }) {
  for (const c of calls) {
    const abdruck = anrufAbdruck(c, tenantId);
    if (!gebunden.has(c.id) && geschriebeneAnrufe.get(c) === abdruck) continue;
    await schreibeAnrufZeile(client, tenantId, c);
    await flushTranscript(client, tenantId, c);
    abdruecke.push([c, abdruck]);
  }
}

async function schreibeAnrufZeile(client, tenantId, call) {
  await client.query(
      `INSERT INTO call
         (id, tenant_id, stream_token, twilio_sid, direction, from_e164, to_e164, goal,
          briefing, constraints, caller_name, language, max_duration_s, requested_by,
          status, started_at, answered_at, ended_at, summary, objective_achieved, provider,
          summary_sms_sent_at, context, failure_reason, billed_at,
          call_control_id, assistant_id, diagnostic, mandate,
          estimated_cost_cents, actual_cost_micro_cents, cost_trued_at,
          cost_trued_source, cost_truing_attempts, telnyx_conversation_id, caller_turns, result,
          consults, estimated_cost_spend_month_key, estimated_cost_period_key,
          elevenlabs_conversation_id, answered_unclear_reason,
          appointment_date, appointment_time, amount, currency,
          callee_confirmed_timezone, callee_confirmed_timezone_origin,
          callee_confirmed_timezone_at, sip_call_id, opening_line, opening_line_sha256,
          lookup_log, summary_mail_sent_at, callee_is_owner, inbox_entry_at, inbox_seen_at,
          from_actual_e164, from_source, from_registration_source, cost_profile,
          el_detector_counts, webhook_anchors, el_bound_at, el_fallback_at, el_nachlauf_started_at,
          caller_is_owner, not_placed_mail_sent_at, bridged_at, el_call_control_id, instanz,
          no_speech_streak, lookups, consult_polled_at_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49,$50,$51,$52,$53,$54,$55,$56,$57,$58,$59,$60,$61,$62,$63,$64,$65,$66,$67,$68,$69,$70,$71,$72,$73,$74)
       ON CONFLICT (id) DO UPDATE SET
         twilio_sid=EXCLUDED.twilio_sid,
         status=CASE WHEN call.status = 'active' THEN EXCLUDED.status ELSE call.status END,
         answered_at=EXCLUDED.answered_at,
         ended_at=CASE WHEN call.status = 'active' THEN EXCLUDED.ended_at ELSE call.ended_at END,
         summary=EXCLUDED.summary,
         objective_achieved=EXCLUDED.objective_achieved, provider=EXCLUDED.provider,
         summary_sms_sent_at=COALESCE(call.summary_sms_sent_at, EXCLUDED.summary_sms_sent_at), failure_reason=EXCLUDED.failure_reason,
         billed_at=COALESCE(call.billed_at, EXCLUDED.billed_at),
         call_control_id=EXCLUDED.call_control_id, assistant_id=EXCLUDED.assistant_id,
         estimated_cost_cents=COALESCE(EXCLUDED.estimated_cost_cents, call.estimated_cost_cents),
         actual_cost_micro_cents=COALESCE(EXCLUDED.actual_cost_micro_cents, call.actual_cost_micro_cents),
         cost_trued_at=COALESCE(EXCLUDED.cost_trued_at, call.cost_trued_at),
         cost_trued_source=COALESCE(EXCLUDED.cost_trued_source, call.cost_trued_source),
         cost_truing_attempts=EXCLUDED.cost_truing_attempts,
         telnyx_conversation_id=EXCLUDED.telnyx_conversation_id,
         caller_turns=EXCLUDED.caller_turns, result=EXCLUDED.result,
         consults=EXCLUDED.consults, context=EXCLUDED.context,
         estimated_cost_spend_month_key=EXCLUDED.estimated_cost_spend_month_key,
         estimated_cost_period_key=EXCLUDED.estimated_cost_period_key,
         elevenlabs_conversation_id=EXCLUDED.elevenlabs_conversation_id,
         answered_unclear_reason=EXCLUDED.answered_unclear_reason,
         appointment_date=EXCLUDED.appointment_date, appointment_time=EXCLUDED.appointment_time,
         amount=EXCLUDED.amount, currency=EXCLUDED.currency,
         callee_confirmed_timezone=EXCLUDED.callee_confirmed_timezone,
         callee_confirmed_timezone_origin=EXCLUDED.callee_confirmed_timezone_origin,
         callee_confirmed_timezone_at=EXCLUDED.callee_confirmed_timezone_at,
         sip_call_id=EXCLUDED.sip_call_id, lookup_log=EXCLUDED.lookup_log,
         summary_mail_sent_at=COALESCE(call.summary_mail_sent_at, EXCLUDED.summary_mail_sent_at),
         not_placed_mail_sent_at=COALESCE(call.not_placed_mail_sent_at, EXCLUDED.not_placed_mail_sent_at),
         inbox_entry_at=EXCLUDED.inbox_entry_at, inbox_seen_at=EXCLUDED.inbox_seen_at,
         from_actual_e164=EXCLUDED.from_actual_e164, from_source=EXCLUDED.from_source,
         from_registration_source=EXCLUDED.from_registration_source,
         cost_profile=EXCLUDED.cost_profile,
         el_detector_counts=EXCLUDED.el_detector_counts,
         webhook_anchors=EXCLUDED.webhook_anchors,
         el_bound_at=EXCLUDED.el_bound_at, el_fallback_at=EXCLUDED.el_fallback_at,
         el_nachlauf_started_at=COALESCE(call.el_nachlauf_started_at, EXCLUDED.el_nachlauf_started_at),
         bridged_at=EXCLUDED.bridged_at, el_call_control_id=COALESCE(EXCLUDED.el_call_control_id, call.el_call_control_id)`,
      callRowValues(call, tenantId),
    );
}

async function flushTranscript(client, tenantId, call) {
  const zeilen = call.transcript.filter((zeile) => !unbestaetigteZeilen.has(zeile));
  if (zeilen.length === 0) {
    await client.query(`DELETE FROM transcript_segment WHERE tenant_id=$1 AND call_id=$2`, [
      tenantId,
      call.id,
    ]);
    return;
  }
  const persisted = (
    await client.query(
      `SELECT id, role, text FROM transcript_segment WHERE call_id=$1 ORDER BY id ASC`,
      [call.id],
    )
  ).rows;
  let gemeinsam = 0;
  while (
    gemeinsam < persisted.length &&
    gemeinsam < zeilen.length &&
    persisted[gemeinsam].role === zeilen[gemeinsam].role &&
    persisted[gemeinsam].text === zeilen[gemeinsam].text
  )
    gemeinsam += 1;
  if (gemeinsam < persisted.length)
    await client.query(
      `DELETE FROM transcript_segment WHERE tenant_id=$1 AND call_id=$2 AND id = ANY($3)`,
      [tenantId, call.id, persisted.slice(gemeinsam).map((r) => r.id)],
    );
  for (let i = gemeinsam; i < zeilen.length; i++) {
    const seg = zeilen[i];
    await client.query(
      `INSERT INTO transcript_segment (call_id, tenant_id, role, text, at) VALUES ($1,$2,$3,$4,$5)`,
      [call.id, tenantId, seg.role, seg.text, seg.at],
    );
  }
}

async function flushCalendar(client, tenantId, events) {
  await deleteMissing(
    client,
    "calendar_event",
    tenantId,
    events.map((e) => e.id),
  );
  for (const ev of events) {
    await client.query(
      `INSERT INTO calendar_event (id, tenant_id, title, starts_at, ends_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, starts_at=EXCLUDED.starts_at, ends_at=EXCLUDED.ends_at`,
      [ev.id, tenantId, ev.title, ev.start, ev.end],
    );
  }
}

async function flushPlatformTtsUsage(client, state) {
  const row = state.platformTtsUsage;
  const kostenstelleZeichen = ops.usageFor(state, ops.PLATFORM_TTS_COST_CENTER_ID).ttsCharacters;
  await client.query(
    `INSERT INTO platform_tts_usage (id, cycle_key, characters, warned_cycle, kostenstelle_zeichen)
       VALUES (1,$1,$2,$3,$4)
     ON CONFLICT (id) DO UPDATE SET cycle_key=EXCLUDED.cycle_key, characters=EXCLUDED.characters,
       warned_cycle=EXCLUDED.warned_cycle, kostenstelle_zeichen=EXCLUDED.kostenstelle_zeichen`,
    [row.cycleKey, row.characters, row.warnedCycle, kostenstelleZeichen],
  );
}

async function flushCostCrossCheck(client, row) {
  await client.query(
    `INSERT INTO cost_cross_check (id, last_checked_month_key) VALUES (1,$1)
     ON CONFLICT (id) DO UPDATE SET last_checked_month_key=EXCLUDED.last_checked_month_key`,
    [row.lastCheckedMonthKey],
  );
}

async function flushPlatformNumberUse(client, bindings) {
  await deleteMissingPlatformNumberUse(client, bindings.map((binding) => binding.id));
  for (const binding of bindings) {
    await client.query(
      `INSERT INTO platform_number_use
         (id, e164, purpose, provider, tenant_id, provider_number_id, bound_at, released_at, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET
         e164=EXCLUDED.e164, purpose=EXCLUDED.purpose, provider=EXCLUDED.provider,
         tenant_id=EXCLUDED.tenant_id, provider_number_id=EXCLUDED.provider_number_id,
         released_at=EXCLUDED.released_at, note=EXCLUDED.note`,
      [binding.id, binding.e164, binding.purpose, binding.provider, binding.tenantId ?? null,
       binding.providerNumberId ?? null, binding.boundAt, binding.releasedAt ?? null, binding.note ?? null],
    );
  }
}

async function deleteMissingPlatformNumberUse(client, keepIds) {
  if (keepIds.length === 0) {
    await client.query(`DELETE FROM platform_number_use`);
    return;
  }
  await client.query(`DELETE FROM platform_number_use WHERE id <> ALL($1::text[])`, [keepIds]);
}

async function flushOutageAlerts(client, alerts) {
  await deleteMissingOutageAlerts(client, alerts.map((alert) => alert.id));
  for (const alert of alerts) {
    await client.query(
      `INSERT INTO outage_alert
         (id, code, first_seen_at, last_seen_at, last_attempt_at, reported_at,
          delivered_channels, closed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET
         last_seen_at=EXCLUDED.last_seen_at, last_attempt_at=EXCLUDED.last_attempt_at,
         reported_at=EXCLUDED.reported_at, delivered_channels=EXCLUDED.delivered_channels,
         closed_at=EXCLUDED.closed_at`,
      [alert.id, alert.code, alert.firstSeenAt, alert.lastSeenAt, alert.lastAttemptAt ?? null,
       alert.reportedAt ?? null, alert.deliveredChannels ?? null, alert.closedAt ?? null],
    );
  }
}

async function deleteMissingOutageAlerts(client, keepIds) {
  if (keepIds.length === 0) {
    await client.query(`DELETE FROM outage_alert`);
    return;
  }
  await client.query(`DELETE FROM outage_alert WHERE id <> ALL($1::text[])`, [keepIds]);
}

async function flushOwnScoped({ client, tenantId, table, rows, insertRow }) {
  const own = rows.filter((r) => r.tenantId === tenantId);
  await deleteMissing(
    client,
    table,
    tenantId,
    own.map((r) => r.id),
  );
  for (const row of own) {
    await insertRow(row);
  }
}

function rowToNumber(r) {
  return {
    id: r.id, e164: r.e164, tenantId: r.tenant_id, provider: r.provider, status: r.status,
    providerNumberId: r.provider_number_id,
    paymentIntentId: r.payment_intent_id ?? null,
    country: r.country ?? null,
    language: r.language ?? null,
    providerAgentPhoneNumberId: r.provider_agent_phone_number_id ?? null,
    ...inboundTrunkBelegFelder(r),
    ...(r.monthly_cost_cents === null || r.monthly_cost_cents === undefined
      ? {} : { monthlyCostCents: r.monthly_cost_cents }),
  };
}

function rowToProvisioningJob(zeile) {
  return {
    id: zeile.id,
    tenantId: zeile.tenant_id,
    numberId: zeile.number_id,
    kind: zeile.kind,
    status: zeile.status,
    idempotencyKey: zeile.idempotency_key,
    attempts: zeile.attempts,
    lastError: zeile.last_error ?? null,
    createdAt:
      zeile.created_at instanceof Date ? zeile.created_at.toISOString() : zeile.created_at,
  };
}

function rowToTenantBudget(zeile) {
  return {
    tenantId: zeile.tenant_id,
    budgetCents: Number(zeile.budget_cents),
    hardCapCents: Number(zeile.hard_cap_cents),
  };
}

function rowToUsageEvent(zeile) {
  return {
    id: zeile.id,
    tenantId: zeile.tenant_id,
    callId: zeile.call_id,
    numberId: zeile.number_id ?? null,
    kind: zeile.kind,
    quantity: Number(zeile.quantity),
    costCents: Number(zeile.cost_cents),
    costMicroCents:
      zeile.cost_micro_cents === null || zeile.cost_micro_cents === undefined
        ? null
        : Number(zeile.cost_micro_cents),
    occurredAt: zeile.occurred_at,
    stripeMeterSent: zeile.stripe_meter_sent,
  };
}

async function flushNumbers(client, tenantId, numbers) {
  await flushOwnScoped({
    client,
    tenantId,
    table: "number",
    rows: numbers,
    insertRow: (n) =>
      client.query(
        `INSERT INTO number (id, tenant_id, e164, provider, status, provider_number_id, payment_intent_id, country, language, monthly_cost_cents, provider_agent_phone_number_id, el_inbound_trunk_belegt_at, el_inbound_trunk_zugang_fp)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (id) DO UPDATE SET
           e164=EXCLUDED.e164, provider=EXCLUDED.provider,
           status=EXCLUDED.status, provider_number_id=EXCLUDED.provider_number_id,
           payment_intent_id=EXCLUDED.payment_intent_id,
           country=EXCLUDED.country, language=EXCLUDED.language,
           monthly_cost_cents=EXCLUDED.monthly_cost_cents,
           provider_agent_phone_number_id=EXCLUDED.provider_agent_phone_number_id,
           el_inbound_trunk_belegt_at=EXCLUDED.el_inbound_trunk_belegt_at,
           el_inbound_trunk_zugang_fp=EXCLUDED.el_inbound_trunk_zugang_fp`,
        [
          n.id,
          tenantId,
          n.e164 ?? null,
          n.provider || DEFAULT_PROVIDER,
          n.status,
          n.providerNumberId ?? null,
          n.paymentIntentId ?? null,
          n.country ?? null,
          n.language ?? null,
          n.monthlyCostCents ?? null,
          n.providerAgentPhoneNumberId ?? null,
          ...inboundTrunkBelegWerte(n),
        ],
      ),
  });
}

async function flushProvisioningJobs(client, tenantId, jobs) {
  await flushOwnScoped({
    client,
    tenantId,
    table: "provisioning_job",
    rows: jobs,
    insertRow: (j) =>
      client.query(
        `INSERT INTO provisioning_job (id, tenant_id, number_id, kind, status, idempotency_key, attempts, last_error, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (id) DO UPDATE SET
           status=EXCLUDED.status, attempts=EXCLUDED.attempts, last_error=EXCLUDED.last_error`,
        [
          j.id,
          tenantId,
          j.numberId,
          j.kind,
          j.status,
          j.idempotencyKey,
          j.attempts,
          j.lastError ?? null,
          j.createdAt,
        ],
      ),
  });
}

async function flushTenantBudgets(client, tenantId, budgets) {
  const own = budgets.filter((b) => b.tenantId === tenantId);
  for (const b of own) {
    await client.query(
      `INSERT INTO tenant_budget (tenant_id, budget_cents, hard_cap_cents)
       VALUES ($1,$2,$3)
       ON CONFLICT (tenant_id) DO UPDATE SET
         budget_cents=EXCLUDED.budget_cents, hard_cap_cents=EXCLUDED.hard_cap_cents`,
      [tenantId, b.budgetCents, b.hardCapCents],
    );
  }
}

async function flushUsageEvents(client, tenantId, events) {
  await flushOwnScoped({
    client,
    tenantId,
    table: "usage_event",
    rows: events,
    insertRow: (e) =>
      client.query(
        `INSERT INTO usage_event (id, tenant_id, call_id, number_id, kind, quantity, cost_cents, cost_micro_cents, occurred_at, stripe_meter_sent)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (id) DO UPDATE SET stripe_meter_sent=EXCLUDED.stripe_meter_sent`,
        [
          e.id,
          tenantId,
          e.callId,
          e.numberId ?? null,
          e.kind,
          e.quantity,
          e.costCents,
          e.costMicroCents ?? null,
          e.occurredAt,
          e.stripeMeterSent,
        ],
      ),
  });
}

async function flushCallCostEvidence(client, tenantId, zeilen) {
  await flushOwnScoped({
    client,
    tenantId,
    table: "call_cost_evidence",
    rows: zeilen,
    insertRow: (zeile) =>
      client.query(
        `INSERT INTO call_cost_evidence
           (id, tenant_id, call_id, traeger, reife, betrag_mikro_cents, waehrung, quelle,
            beleg_ref, versuche, gemessen_at, abstand_zum_gespraechsende_s, detail,
            nachreifbar)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (id) DO UPDATE SET
           reife=EXCLUDED.reife, betrag_mikro_cents=EXCLUDED.betrag_mikro_cents,
           waehrung=EXCLUDED.waehrung, quelle=EXCLUDED.quelle,
           beleg_ref=EXCLUDED.beleg_ref, versuche=EXCLUDED.versuche,
           gemessen_at=EXCLUDED.gemessen_at,
           abstand_zum_gespraechsende_s=EXCLUDED.abstand_zum_gespraechsende_s,
           detail=EXCLUDED.detail, nachreifbar=EXCLUDED.nachreifbar`,
        [
          zeile.id,
          tenantId,
          zeile.callId,
          zeile.traeger,
          zeile.reife,
          zeile.betragMikroCents ?? null,
          zeile.waehrung ?? null,
          zeile.quelle ?? null,
          zeile.belegRef ?? null,
          zeile.versuche,
          zeile.gemessenAt ?? null,
          zeile.abstandZumGespraechsendeS ?? null,
          zeile.detail ? JSON.stringify(zeile.detail) : null,
          zeile.nachreifbar,
        ],
      ),
  });
}

function serializeObjective(value) {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : String(value);
}

function deserializeObjective(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

async function deleteMissing(client, table, tenantId, keepIds) {
  await deleteMissingByText({ client, table, column: "id", tenantId, keepValues: keepIds });
}

async function deleteMissingByText({ client, table, column, tenantId, keepValues }) {
  if (keepValues.length === 0) {
    await client.query(`DELETE FROM ${table} WHERE tenant_id=$1`, [tenantId]);
    return;
  }
  await client.query(`DELETE FROM ${table} WHERE tenant_id=$1 AND ${column} <> ALL($2::text[])`, [
    tenantId,
    keepValues,
  ]);
}

const CALL_STATUS_ACTIVE = "active";
