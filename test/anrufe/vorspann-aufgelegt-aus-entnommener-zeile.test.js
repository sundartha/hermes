import assert from "node:assert/strict";
import test from "node:test";

import { makeVorspannAblauf } from "../../src/elevenlabs/vorspann-ablauf.js";
import { makeSpeicherVorspannZustand } from "../../src/store/vorspann-zustand.js";
import { CALL_CONTROL_EREIGNIS } from "../../src/telephony/call-control-ereignis.ts";

const CALLEE = "cc_callee_6086";
const EL = "cc_el_6086";
const CALL = { id: "call_6086", tenantId: "tenant_6086", provider: "telnyx", status: "active", elCallControlId: EL };
const BRUECKE_MS = 1;

async function ablaufMitAnderemSchreiber({ aufgelegt, zwischen, abgehoben = true }) {
  const zeilen = makeSpeicherVorspannZustand();
  const ref = { tenantId: CALL.tenantId, callId: CALL.id };
  await zeilen.anlegen({ ...ref, token: "tok_6086", text: "Hallo" });
  await zeilen.setzeCallee({ ...ref, calleeId: CALLEE });
  await zeilen.beanspruecheMarke({ ...ref, marke: "BRUECKE", ms: BRUECKE_MS });
  if (abgehoben) await zeilen.beanspruecheAbgehoben(ref);
  for (const bein of aufgelegt) await zeilen.legeAufgelegtAn({ ...ref, bein });
  const vorspannZustand = {
    ...zeilen,
    lade: async (anfrage) => {
      const kopie = await zeilen.lade(anfrage);
      await zwischen(zeilen, ref);
      return kopie;
    },
  };
  const aufgelegtBeine = [];
  const ablauf = makeVorspannAblauf({
    voiceControl: () => ({ endCallViaCallControl: async (bein) => aufgelegtBeine.push(bein) }),
    store: { leseCall: async () => CALL, save: () => {}, endCallRecord: () => {}, recordFailureReason: () => {} },
    config: {},
    ttsStore: { release: () => {} },
    vorspannZustand,
    inboundBridges: {},
    ausgehendGesperrt: async () => false,
    terminateAndBillCall: async ({ hangUp }) => hangUp?.(),
    awaitAndPersistInboundElResult: async () => {},
    billThunk: () => async () => {},
    finishCall: async () => {},
    now: () => BRUECKE_MS,
  });
  return { ablauf, aufgelegtBeine };
}

const aufgelegtEreignis = (bein) => ({ ereignis: CALL_CONTROL_EREIGNIS.AUFGELEGT, callControlId: bein });

const FAELLE = [
  { name: "Callee legt auf, EL-Bein wurde nach gescheitertem Auflegen von anderer Instanz herausgenommen: EL-Bein wird aufgelegt", vorher: [EL], bein: CALLEE, erwartet: [EL] },
  { name: "EL-Bein legt auf, Callee-Bein wurde nach gescheitertem Auflegen von anderer Instanz herausgenommen: Callee-Bein wird aufgelegt", vorher: [CALLEE], bein: EL, erwartet: [CALLEE] },
];

for (const { name, vorher, bein, erwartet } of FAELLE) {
  test(name, async () => {
    const { ablauf, aufgelegtBeine } = await ablaufMitAnderemSchreiber({
      aufgelegt: vorher,
      zwischen: async (zeilen, ref) => zeilen.nimmAufgelegtWeg({ ...ref, bein: vorher[0] }),
    });
    await ablauf.behandle({ call: CALL, ereignis: aufgelegtEreignis(bein), zugang: {} });
    assert.deepEqual(aufgelegtBeine, erwartet);
  });

  test(`Ohne Zwischenaenderung wird das andere, schon aufgelegte Bein nicht noch einmal aufgelegt (${bein})`, async () => {
    const { ablauf, aufgelegtBeine } = await ablaufMitAnderemSchreiber({ aufgelegt: vorher, zwischen: async () => {} });
    await ablauf.behandle({ call: CALL, ereignis: aufgelegtEreignis(bein), zugang: {} });
    assert.deepEqual(aufgelegtBeine, []);
  });
}

test("Klingelfrist: EL-Bein, das eine andere Instanz nach gescheitertem Auflegen herausgenommen hat, wird mit dem Callee-Bein aufgelegt", async () => {
  const { ablauf, aufgelegtBeine } = await ablaufMitAnderemSchreiber({
    aufgelegt: [EL],
    abgehoben: false,
    zwischen: async (zeilen, ref) => zeilen.nimmAufgelegtWeg({ ...ref, bein: EL }),
  });
  await ablauf.beiFrist({ callId: CALL.id, frist: "klingel" });
  assert.deepEqual(aufgelegtBeine, [CALLEE, EL]);
});

test("Klingelfrist ohne Zwischenaenderung: schon aufgelegtes EL-Bein wird nicht noch einmal aufgelegt", async () => {
  const { ablauf, aufgelegtBeine } = await ablaufMitAnderemSchreiber({ aufgelegt: [EL], abgehoben: false, zwischen: async () => {} });
  await ablauf.beiFrist({ callId: CALL.id, frist: "klingel" });
  assert.deepEqual(aufgelegtBeine, [CALLEE]);
});
