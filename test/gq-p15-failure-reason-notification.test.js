// GQ-P15 (F4): "Der Grund eines Fehlanrufs steht in der Benachrichtigung". Vor dieser
// Phase war die passive Notification (statusBody) nur aus dem status gebaut - "no-answer"
// und "busy" (Cap und Budget-Erschoepfung sogar beide "completed") erzeugten identischen
// Text. Diese Suite pinnt den Fix auf zwei Ebenen: Block A die i18n-Faktorei
// (makeStatusBody/FAILURE_REASON_TEXTS), Block B den echten Produktionspfad (makeCallFinish).
import { test } from "node:test";
import assert from "node:assert/strict";
import { LOCALES, SUPPORTED_LANGUAGES } from "../src/i18n/locales.js";
import { callFailureReason, failureReasonBase } from "../src/telephony/failure-reason.js";
import { CAP_FAILURE_REASON, BUDGET_FAILURE_REASON } from "../src/telephony/call-lifecycle.js";
import { FAILURE_REASON_TEXTS } from "../src/i18n/failure-reason-texts.js";
import { makeCallFinish } from "../src/telephony/call-finish.js";
import { seedCall } from "./helpers.js";

const TARGET = "+4915112345678";
// Golden Master: der heutige Wortlaut, byte-genau abgeschrieben (nicht aus dem Bundle
// abgeleitet - sonst pinnt der Test nichts).
const BESTAND_BODY = Object.freeze({
  de: `${TARGET} (Status: no-answer)`,
  fr: `${TARGET} (statut : no-answer)`,
  en: `${TARGET} (status: no-answer)`,
});

// ---------------- Block A - i18n-Ebene ----------------

for (const lang of SUPPORTED_LANGUAGES) {
  test(`GQ-P15-A1 ${lang}: ohne Grund byte-identisch zum Bestand`, () => {
    const statusBody = LOCALES[lang].postCall.statusBody;
    assert.equal(statusBody(TARGET, "no-answer"), BESTAND_BODY[lang]);
    assert.equal(statusBody(TARGET, "no-answer", null), BESTAND_BODY[lang]);
    assert.equal(statusBody(TARGET, "no-answer", undefined), BESTAND_BODY[lang]);
  });

  test(`GQ-P15-A2 ${lang}: bekanntes Token traegt Label + Sprach-Phrase`, () => {
    const statusBody = LOCALES[lang].postCall.statusBody;
    const { reasonLabel, phrases } = FAILURE_REASON_TEXTS[lang];
    const body = statusBody(TARGET, "no-answer", "no-answer");
    assert.ok(body.includes(reasonLabel), `${lang}: Body traegt nicht das reasonLabel`);
    assert.ok(body.includes(phrases["no-answer"]), `${lang}: Body traegt nicht die Phrase`);
    assert.notEqual(phrases["no-answer"], "no-answer");
    if (lang !== "en") {
      assert.notEqual(phrases["no-answer"], FAILURE_REASON_TEXTS.en.phrases["no-answer"]);
    }
  });

  test(`GQ-P15-A3 ${lang}: no-answer vs. busy erzeugen verschiedene, unterscheidbare Bodies`, () => {
    const statusBody = LOCALES[lang].postCall.statusBody;
    const noAnswerBody = statusBody(TARGET, "no-answer", "no-answer");
    const busyBody = statusBody(TARGET, "busy", "busy");
    assert.notEqual(noAnswerBody, busyBody);
    assert.notEqual(noAnswerBody, BESTAND_BODY[lang]);
    assert.notEqual(busyBody, BESTAND_BODY[lang]);
  });

  test(`GQ-P15-A4 ${lang}: fremdes/gefaehrliches Token faellt auf Bestandstext zurueck`, () => {
    const statusBody = LOCALES[lang].postCall.statusBody;
    for (const token of ["wormhole-collapse", "constructor", "toString"]) {
      const body = statusBody(TARGET, "no-answer", token);
      assert.equal(body, BESTAND_BODY[lang]);
      assert.ok(!body.includes(token), `${lang}: Body enthaelt das rohe Token "${token}"`);
    }
  });

  test(`GQ-P15-A5 ${lang}: SIP-Detail (failed:603) erscheint nicht im Nutzertext`, () => {
    const statusBody = LOCALES[lang].postCall.statusBody;
    const body = statusBody(TARGET, "failed", "failed:603");
    assert.ok(body.includes(FAILURE_REASON_TEXTS[lang].phrases.failed));
    assert.ok(!body.includes("603"), `${lang}: Body enthaelt das SIP-Detail 603`);
  });
}

// Drift-Guard: die Token-Menge wird aus den ECHTEN Quellen erzeugt, nicht abgeschrieben.
test("GQ-P15-A6: jedes real erzeugte Basis-Token hat in allen Sprachen eine Phrase", () => {
  const lifecycleEvents = [
    { status: "no-answer", diagnostics: {} },
    { status: "busy", diagnostics: {} },
    { status: "canceled", diagnostics: {} },
    { status: "failed", diagnostics: {} },
    { status: "failed", diagnostics: { sipHangupCause: "603" } },
  ];
  const baseTokens = new Set(
    lifecycleEvents
      .map((event) => failureReasonBase(callFailureReason(event)))
      .concat([CAP_FAILURE_REASON, BUDGET_FAILURE_REASON]),
  );

  for (const token of baseTokens) {
    const perLangPhrases = SUPPORTED_LANGUAGES.map((lang) => {
      const phrase = FAILURE_REASON_TEXTS[lang].phrases[token];
      assert.ok(
        typeof phrase === "string" && phrase.length > 0,
        `Token "${token}" hat keine Phrase in Sprache "${lang}"`,
      );
      return phrase;
    });
    assert.equal(
      new Set(perLangPhrases).size,
      perLangPhrases.length,
      `Token "${token}": Phrasen sind nicht paarweise verschieden (${perLangPhrases.join(" | ")})`,
    );
  }
});

// ---------------- Block B - Produktionspfad (makeCallFinish, offline) ----------------

function throwing(label) {
  return () => {
    throw new Error(`${label} haette im passiven Fruehe-Return-Zweig nicht laufen duerfen`);
  };
}

function makeHarness(notifyCapture) {
  const config = { billing: { paymentEnabled: false, smsCostCents: 0 }, privacy: {} };
  const store = {
    withStoreLock: (fn) => fn(),
    releaseOutboundReserve: async () => {},
    save: () => {},
    addNotification: (title, body, callId) => notifyCapture.push({ title, body, callId }),
    markBilled: () => {},
  };
  const metering = { recordVoiceMinuteMeter: () => {}, reconcileVoiceBudget: () => {} };
  return makeCallFinish({
    store,
    config,
    metering,
    messaging: throwing("messaging"),
    summarizeCall: throwing("summarizeCall"),
    planSummarySms: throwing("planSummarySms"),
    audit: throwing("audit"),
  });
}

test("GQ-P15-B1: Call mit failureReason -> Notification nennt den Grund", async () => {
  const notifyCapture = [];
  const callFinish = makeHarness(notifyCapture);
  const call = seedCall({ status: "no-answer", transcript: [], failureReason: "no-answer" });

  await callFinish.finishCall(call);

  assert.equal(notifyCapture.length, 1);
  assert.equal(notifyCapture[0].title, LOCALES.de.postCall.failedTitle);
  const expected = LOCALES.de.postCall.statusBody(call.to, "no-answer", "no-answer");
  assert.equal(notifyCapture[0].body, expected);
  assert.ok(notifyCapture[0].body.includes(FAILURE_REASON_TEXTS.de.phrases["no-answer"]));
});

test("GQ-P15-B2: Call ohne failureReason -> Body byte-identisch zum Bestand (Golden Master)", async () => {
  const notifyCapture = [];
  const callFinish = makeHarness(notifyCapture);
  const call = seedCall({ status: "no-answer", transcript: [] });

  await callFinish.finishCall(call);

  assert.equal(notifyCapture[0].body, BESTAND_BODY.de);
});

test("GQ-P15-B3: Cap- und Budget-Terminalisierung erzeugen unterscheidbare Bodies", async () => {
  const capCapture = [];
  const budgetCapture = [];
  const capCall = seedCall({
    id: "call_cap",
    status: "completed",
    transcript: [],
    failureReason: CAP_FAILURE_REASON,
  });
  const budgetCall = seedCall({
    id: "call_budget",
    status: "completed",
    transcript: [],
    failureReason: BUDGET_FAILURE_REASON,
  });

  await makeHarness(capCapture).finishCall(capCall);
  await makeHarness(budgetCapture).finishCall(budgetCall);

  assert.equal(capCapture.length, 1);
  assert.equal(budgetCapture.length, 1);
  assert.notEqual(capCapture[0].body, budgetCapture[0].body);
  // Heutiger Zustand (vor dem Fix): beide waeren "... (Status: completed)" - identisch.
  const bestandCompletedBody = `${capCall.to} (Status: completed)`;
  assert.notEqual(capCapture[0].body, bestandCompletedBody);
  assert.notEqual(budgetCapture[0].body, bestandCompletedBody);
});
