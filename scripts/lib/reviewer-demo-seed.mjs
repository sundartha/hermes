import { MS_PER_HOUR } from "../../src/utils/timer.js";
import { BOOTSTRAP_TENANT_ID } from "../../src/store/defaults.js";

const INBOUND = "inbound";
const ENDED_STATUS = "completed";
const ACTION_ITEM_TYPE = "todo";
const HOURS_PER_DAY = 24;
const SEED_END_MARGIN_MS = HOURS_PER_DAY * MS_PER_HOUR;

export const REVIEWER_SEED_CALLS = Object.freeze([
  Object.freeze({
    from: "+12025550142",
    summary:
      "A caller from a dental practice asked to move a check-up appointment from Tuesday to Thursday afternoon.",
    actionItems: Object.freeze(["Confirm the new dental check-up time for Thursday afternoon."]),
  }),
  Object.freeze({
    from: "+12025550187",
    summary:
      "A bike repair shop called to say the repair is finished and the bike can be picked up until 6 pm.",
    actionItems: Object.freeze(["Pick up the bike from the repair shop before 6 pm."]),
  }),
  Object.freeze({
    from: "+12025550163",
    summary:
      "A neighbor called about the shared garden cleanup on Saturday morning and asked whether you can join.",
    actionItems: Object.freeze([
      "Reply to the neighbor about joining the garden cleanup on Saturday.",
      "Bring gardening gloves to the cleanup.",
    ]),
  }),
]);

function assertSeedableTenant(store, tenantId) {
  if (typeof tenantId !== "string" || tenantId.trim() === "") {
    throw new Error("Mandanten-Kennung fehlt.");
  }
  if (tenantId === BOOTSTRAP_TENANT_ID) {
    throw new Error("Der Betreiber-Mandant bekommt keine Beispieldaten.");
  }
  if (!store.tenantExists(tenantId)) {
    throw new Error("Mandant unbekannt - das Skript legt keinen Mandanten an.");
  }
}

function findSeedCall(calls, entry) {
  return calls.find(
    (call) =>
      call.direction === INBOUND && call.from === entry.from && call.summary === entry.summary,
  );
}

export function planReviewerSeed(store, tenantId) {
  assertSeedableTenant(store, tenantId);
  const { calls, actionItems } = store.exportTenantData(tenantId);
  const openTexts = new Set(actionItems.filter((item) => !item.done).map((item) => item.text));
  return REVIEWER_SEED_CALLS.map((entry) => ({
    entry,
    callId: findSeedCall(calls, entry)?.id ?? null,
    missingItems: entry.actionItems.filter((text) => !openTexts.has(text)),
  })).filter((step) => step.callId === null || step.missingItems.length > 0);
}

export function reviewerSeedEndedAtIso({ nowMs, belegFensterMs, heartbeatFensterH }) {
  const fensterMs = Math.max(belegFensterMs, heartbeatFensterH * MS_PER_HOUR);
  if (!Number.isFinite(nowMs) || !Number.isFinite(fensterMs) || fensterMs <= 0) {
    throw new Error("Fensterlaengen der Kosten-Beobachtung fehlen.");
  }
  return new Date(nowMs - fensterMs - SEED_END_MARGIN_MS).toISOString();
}

function assertEndedAtIso(endedAtIso) {
  if (typeof endedAtIso !== "string" || !Number.isFinite(Date.parse(endedAtIso))) {
    throw new Error("Ende-Zeitpunkt der Seed-Anrufe fehlt (reviewerSeedEndedAtIso).");
  }
}

function createEndedInboundCall(store, { tenantId, entry, endedAtIso }) {
  const call = store.createCall({ direction: INBOUND, from: entry.from, to: null, tenantId });
  store.recordProviderCallResult(call.id, { summary: entry.summary, objectiveAchieved: null });
  store.setCallEndedAt(call.id, ENDED_STATUS, endedAtIso);
  return call.id;
}

function addMissingItems(store, callId, texts) {
  return texts.filter((text) => !store.addActionItem(callId, text, ACTION_ITEM_TYPE).duplicate)
    .length;
}

export function applyReviewerSeed(store, tenantId, endedAtIso) {
  assertEndedAtIso(endedAtIso);
  const counts = { callsCreated: 0, itemsCreated: 0 };
  for (const step of planReviewerSeed(store, tenantId)) {
    const callId =
      step.callId ?? createEndedInboundCall(store, { tenantId, entry: step.entry, endedAtIso });
    if (step.callId === null) counts.callsCreated += 1;
    counts.itemsCreated += addMissingItems(store, callId, step.missingItems);
  }
  return counts;
}

export async function applyReviewerSeedAndPersist(store, tenantId, endedAtIso) {
  const counts = applyReviewerSeed(store, tenantId, endedAtIso);
  await store.save();
  await store.drainFlushes();
  return counts;
}

export function countSeedCallsInsideCostWindow(store, tenantId, endedAtIso) {
  assertEndedAtIso(endedAtIso);
  assertSeedableTenant(store, tenantId);
  const { calls } = store.exportTenantData(tenantId);
  const windowStartMs = Date.parse(endedAtIso);
  return REVIEWER_SEED_CALLS.map((entry) => findSeedCall(calls, entry)).filter(
    (call) => call !== undefined && Date.parse(call.endedAt) > windowStartMs,
  ).length;
}
