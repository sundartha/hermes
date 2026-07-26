// GAP-23 des i18n-Launch-Testkatalogs (tasks/i18n-tests/11-luecken-und-e2e.md, Welle W2,
// Block B5). ZWEI SOLL-Tests (rot vor Fix, R2): (a) eine Kennzahl "no-answer-Quote je
// Absender-DID" existiert und stoppt den Nachschub; (b) eine Nummer erreicht 'active' NICHT
// ohne abgeschlossenen Registrierungsschritt (fail-closed wie das KYC-Gate).
// Gemessen gibt es weder das eine noch das andere: failureReason wird klassifiziert
// (src/telephony/failure-reason.js), aber nirgends je DID aggregiert, und die
// Aktivierungskette requested->provisioning->active kennt keinen Registrierungs-Zustand.
// Die Quote rechnet der TEST - genau das ist der Befund: es gibt keine Produktionsstelle,
// die sie rechnen koennte.
//
// Rein offline: state-ops ueber einem In-Memory-State, kein Netz, kein Spawn, kein pglite,
// kein Provisioner (F.I.R.S.T.). Es wird nie eine Nummer gekauft oder freigegeben.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeDefaultState,
  registerTenant,
  requestNumber,
  beginProvisioning,
  activateNumber,
  findNumber,
} from "../src/store/state-ops.js";
import { NUMBER_STATUS } from "../src/store/defaults.js";

const TENANT_ID = "t_user1";
const KAUF_LAND = "US";
const US_DID = "+12025550123";
const DE_ZIEL = "+4917012345678";
const PROVIDER_NUMBER_ID = "ext_1";
const OUTBOUND = "outbound";
// Caps bewusst gross: eine Ablehnung darf NUR an der Reputation liegen, nie am Cap.
const GENEROESE_CAPS = { maxNumbers: 9, maxNumbersPerTenant: 9 };
// Messfenster + Quote: absichtlich der Entartungsfall (100 %), damit JEDE denkbare
// Schwelle des spaeteren Fixes greift - der Test schreibt keine Schwelle vor.
const MESSFENSTER_ANRUFE = 20;
const NO_ANSWER = "no-answer";

// Die Kennzahl der ID, im Test formuliert: Anteil der Anrufe EINER Absender-DID ohne
// Abheben. Reine Ableitung aus dem Bestands-Datenmodell (call.from + call.failureReason).
function noAnswerQuote(s, fromNumber) {
  const legs = s.calls.filter((c) => c.from === fromNumber);
  if (!legs.length) return 0;
  return legs.filter((c) => c.failureReason === NO_ANSWER).length / legs.length;
}

// Tenant + EINE Nummer bis unmittelbar VOR die Aktivierung (requested -> provisioning):
// genau der Zustand, in dem ein Registrierungs-Gate sitzen muesste. Liefert {s, numberId}.
function seedNumberBeforeActivation() {
  const s = makeDefaultState();
  registerTenant(s, TENANT_ID);
  const { number } = requestNumber(s, { tenantId: TENANT_ID, country: KAUF_LAND, ...GENEROESE_CAPS });
  beginProvisioning(s, number.id);
  return { s, numberId: number.id };
}

// Aktive US-DID plus `anrufe` Ausgangsversuche, die alle ohne Abheben endeten.
function seedRufgeschaedigteDid(anrufe) {
  const { s, numberId } = seedNumberBeforeActivation();
  activateNumber(s, numberId, { e164: US_DID, providerNumberId: PROVIDER_NUMBER_ID });
  for (let i = 0; i < anrufe; i++) {
    s.calls.push({
      id: `call_${i}`,
      direction: OUTBOUND,
      from: US_DID,
      to: DE_ZIEL,
      status: NO_ANSWER,
      failureReason: NO_ANSWER,
    });
  }
  return { s, numberId };
}

test("GAP-23 (SOLL, rot) - eine Absender-DID mit katastrophaler no-answer-Quote stoppt den Nummern-Nachschub", () => {
  const { s } = seedRufgeschaedigteDid(MESSFENSTER_ANRUFE);

  assert.equal(noAnswerQuote(s, US_DID), 1, "Vorbedingung: jede Messung dieser DID ist ein no-answer");
  const nachschub = requestNumber(s, { tenantId: TENANT_ID, country: KAUF_LAND, ...GENEROESE_CAPS });
  assert.equal(
    nachschub.ok,
    false,
    "die Plattform kauft der ruf-geschaedigten DID die naechste Nummer nach, ohne die Quote je gelesen zu haben",
  );
});

test("GAP-23 (SOLL, rot) - ohne abgeschlossene Registrierung erreicht eine Nummer den Status 'active' nicht", () => {
  const { s, numberId } = seedNumberBeforeActivation();

  try {
    activateNumber(s, numberId, { e164: US_DID, providerNumberId: PROVIDER_NUMBER_ID });
  } catch {
    // fail-closed per Throw ist die zweite zulaessige Soll-Variante (Muster GAP-09)
  }
  assert.notEqual(
    findNumber(s, numberId).status,
    NUMBER_STATUS.ACTIVE,
    "eine Nummer ohne Registrierungsschritt routet heute sofort - kein Gate zwischen Kauf und Betrieb",
  );
});
