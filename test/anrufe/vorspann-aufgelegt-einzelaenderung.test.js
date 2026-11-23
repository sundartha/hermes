import assert from "node:assert/strict";
import { test } from "node:test";

import { makeVorspannAblauf } from "../../src/elevenlabs/vorspann-ablauf.js";
import { CALL_CONTROL_EREIGNIS } from "../../src/telephony/call-control-ereignis.ts";
import { vorspannZustand } from "../../src/store.js";
import { makePostgresVorspannZustand } from "../../src/store/vorspann-zustand.js";
import { legeMandantAn, makePgTestStore } from "../pg-helpers.js";

const TTL_MS = 120_000;
const CALLEE = "cc_callee_einzel";
const EL = "cc_el_einzel";

const warte = () => {
  let frei;
  const versprechen = new Promise((fertig) => (frei = fertig));
  return { versprechen, frei };
};

function baueSzenario(callId, { elScheitert }) {
  const ref = { tenantId: "t_einzel", callId };
  const call = { id: callId, tenantId: ref.tenantId, provider: "telnyx", status: "active", elCallControlId: EL };
  const aufgelegtBeine = [];
  let elScheitertNoch = elScheitert;
  let beiElAuflegen = async () => {};
  const steuerung = {
    endCallViaCallControl: async (bein) => {
      aufgelegtBeine.push(bein);
      if (bein === EL) await beiElAuflegen();
      if (bein === EL && elScheitertNoch) {
        elScheitertNoch = false;
        throw new Error("Auflegen gescheitert");
      }
    },
  };
  const geladen = warte();
  const bFertig = warte();
  const veraltet = { ...vorspannZustand };
  veraltet.lade = async (anfrage) => {
    const zeile = await vorspannZustand.lade(anfrage);
    geladen.frei();
    return zeile;
  };
  veraltet.speichere = async (anfrage) => {
    await bFertig.versprechen;
    return vorspannZustand.speichere(anfrage);
  };
  const store = { leseCall: async () => ({ ...call }), recordFailureReason: () => {} };
  const bauen = (zustand) =>
    makeVorspannAblauf({
      voiceControl: () => steuerung,
      store,
      config: {},
      ttsStore: { release: () => {} },
      vorspannZustand: zustand,
      inboundBridges: {},
      terminateAndBillCall: async ({ hangUp }) => hangUp?.(),
      awaitAndPersistInboundElResult: async () => {},
      billThunk: () => () => {},
      finishCall: () => {},
      now: () => 1,
    });
  const instanzA = bauen(veraltet);
  const instanzB = bauen(vorspannZustand);
  const instanzOhneEintrag = bauen({
    ...vorspannZustand,
    legeAufgelegtAn: async () => {
      throw new Error("Eintragen gescheitert");
    },
    nimmAufgelegtWeg: async () => {
      throw new Error("Wegnehmen gescheitert");
    },
  });
  const ereignisA = () => instanzA.behandle({ call, ereignis: { ereignis: CALL_CONTROL_EREIGNIS.WIEDERGABE_ENDE, callControlId: EL } });
  return {
    ref,
    call,
    aufgelegtBeine,
    geladen,
    bFertig,
    ereignisA,
    instanzB,
    instanzOhneEintrag,
    setzeBeiElAuflegen: (fn) => (beiElAuflegen = fn),
    legt: () => vorspannZustand.lade(ref).then((zeile) => [...zeile.aufgelegt].sort()),
  };
}

const lege = async (ref) => {
  await vorspannZustand.anlegen({ ...ref, token: "tok", text: "Satz", ttlMs: TTL_MS });
  await vorspannZustand.setzeCallee({ ...ref, calleeId: CALLEE });
};

const fristB = (s) => s.instanzB.beiFrist({ callId: s.call.id, frist: "wiedergabe" });

const hangup = (s) =>
  s.instanzB.behandle({ call: s.call, ereignis: { ereignis: CALL_CONTROL_EREIGNIS.AUFGELEGT, callControlId: CALLEE } });

test("Abnahme 1: Speichert Instanz A am Ereignisende mit veralteter Kopie, nachdem B das gescheiterte EL-Auflegen zurueckgenommen hat, bleibt das EL-Bein offen und das Auflegen des Callee-Beins legt es auf", async () => {
  const s = baueSzenario("call_einzel_1", { elScheitert: true });
  await lege(s.ref);
  let laufA;
  s.setzeBeiElAuflegen(async () => {
    laufA = s.ereignisA();
    await s.geladen.versprechen;
  });
  await fristB(s);
  s.bFertig.frei();
  await laufA;
  assert.deepEqual(await s.legt(), [CALLEE]);
  s.aufgelegtBeine.length = 0;
  await hangup(s);
  assert.deepEqual(s.aufgelegtBeine, [EL]);
});

test("Abnahme 2: Speichert Instanz A am Ereignisende mit veralteter Kopie, bleibt das von B eingetragene Callee-Bein aufgelegt und wird beim Hangup nicht noch einmal aufgelegt", async () => {
  const s = baueSzenario("call_einzel_2", { elScheitert: false });
  await lege(s.ref);
  const laufA = s.ereignisA();
  await s.geladen.versprechen;
  await fristB(s);
  s.bFertig.frei();
  await laufA;
  assert.deepEqual(await s.legt(), [CALLEE, EL].sort());
  s.aufgelegtBeine.length = 0;
  await hangup(s);
  assert.deepEqual(s.aufgelegtBeine, []);
});

test("Abnahme 3 (Speicher): speichere ohne aufgelegt laesst die Liste, Einzeländerungen fuegen einmalig hinzu und nehmen weg", async () => {
  const ref = { tenantId: "t_einzel", callId: "call_einzel_3" };
  await vorspannZustand.anlegen({ ...ref, token: "tok", text: "Satz", ttlMs: TTL_MS });
  await vorspannZustand.legeAufgelegtAn({ ...ref, bein: "a" });
  await vorspannZustand.legeAufgelegtAn({ ...ref, bein: "a" });
  await vorspannZustand.legeAufgelegtAn({ ...ref, bein: "b" });
  await vorspannZustand.speichere({ ...ref, stand: { M: 1 } });
  assert.deepEqual((await vorspannZustand.lade(ref)).aufgelegt, ["a", "b"]);
  await vorspannZustand.nimmAufgelegtWeg({ ...ref, bein: "a" });
  assert.deepEqual((await vorspannZustand.lade(ref)).aufgelegt, ["b"]);
  await vorspannZustand.nimmAufgelegtWeg({ ...ref, bein: "x" });
  assert.deepEqual((await vorspannZustand.lade(ref)).aufgelegt, ["b"]);
  await vorspannZustand.legeAufgelegtAn({ tenantId: "t_einzel", callId: "call_einzel_ohne", bein: "a" });
  await vorspannZustand.loesche(ref);
});

test("Abnahme 3 (Postgres): dieselben Einzeländerungen und speichere ohne aufgelegt in SQL", async () => {
  const { store, runner } = await makePgTestStore();
  await legeMandantAn(store, "t_einzel_pg");
  const zustand = makePostgresVorspannZustand(runner);
  const ref = { tenantId: "t_einzel_pg", callId: "call_einzel_pg" };
  await zustand.anlegen({ ...ref, token: "tok", text: "Satz", ttlMs: TTL_MS });
  await zustand.legeAufgelegtAn({ ...ref, bein: "a" });
  await zustand.legeAufgelegtAn({ ...ref, bein: "a" });
  await zustand.legeAufgelegtAn({ ...ref, bein: "b" });
  await zustand.speichere({ ...ref, stand: { M: 1 } });
  assert.deepEqual((await zustand.lade(ref)).aufgelegt, ["a", "b"]);
  assert.deepEqual((await zustand.lade(ref)).stand, { M: 1 });
  await zustand.nimmAufgelegtWeg({ ...ref, bein: "a" });
  assert.deepEqual((await zustand.lade(ref)).aufgelegt, ["b"]);
  await zustand.speichere({ ...ref, stand: {}, aufgelegt: ["c"] });
  assert.deepEqual((await zustand.lade(ref)).aufgelegt, ["c"]);
});

test("Scheitert das Eintragen oder Wegnehmen eines Beins im Speicher, werden beide Beine trotzdem aufgelegt", async () => {
  const s = baueSzenario("call_einzel_4", { elScheitert: true });
  await lege(s.ref);
  await s.instanzOhneEintrag.beiFrist({ callId: s.call.id, frist: "wiedergabe" });
  assert.deepEqual(s.aufgelegtBeine.sort(), [CALLEE, EL]);
  assert.deepEqual(await s.legt(), []);
});
