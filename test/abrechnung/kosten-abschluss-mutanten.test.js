import assert from "node:assert/strict";
import { test } from "node:test";

import { REIFE } from "../../src/begriffe/abrechnung.js";
import { KOSTENART, KOSTENPROFIL } from "../../src/billing/kostenarten.js";
import {
  ABSCHLUSS_GRUND,
  ENDZUSTAND,
  abschlussFuerAnruf,
  belegUnbeschaffbarAmAnruf,
} from "../../src/billing/kosten-abschluss.ts";

const JETZT_MS = Date.parse("2026-01-10T12:00:00.000Z");
const FRIST_MS = 3_600_000;
const VOR_FRIST = "2026-01-10T08:00:00.000Z";

test("belegUnbeschaffbarAmAnruf: nur das SIP-Profil gilt als unbeschaffbar, ein anderes Profil mit gleichen Merkmalen nicht", () => {
  const merkmale = { endedAt: VOR_FRIST, elevenlabsConversationId: "conv_1", sipCallId: null };
  assert.equal(
    belegUnbeschaffbarAmAnruf({ call: { ...merkmale, costProfile: KOSTENPROFIL.EL_CONVAI_SIP }, belege: [] }),
    true,
  );
  assert.equal(
    belegUnbeschaffbarAmAnruf({ call: { ...merkmale, costProfile: KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI }, belege: [] }),
    false,
  );
});

test("abschlussFuerAnruf: nicht nachreifbarer und nachreifbarer Träger zusammen sind unvollständig, nicht unbeschaffbar", () => {
  const call = {
    costProfile: KOSTENPROFIL.EL_CONVAI_SIP,
    endedAt: VOR_FRIST,
    elevenlabsConversationId: "conv_1",
    sipCallId: "sip_1",
  };
  const belege = [
    { traeger: KOSTENART.ELEVENLABS_CONVAI, reife: REIFE.ERWARTET, nachreifbar: false },
    { traeger: KOSTENART.TELNYX_SIP, reife: REIFE.ERWARTET, nachreifbar: true },
  ];
  const ergebnis = abschlussFuerAnruf({
    call,
    belege,
    nowMs: JETZT_MS,
    deadlineMs: FRIST_MS,
    sweepTraegerErledigt: false,
  });
  assert.equal(ergebnis.geschlossen, true);
  assert.equal(ergebnis.grund, ABSCHLUSS_GRUND.FRIST);
  assert.equal(ergebnis.endzustand, ENDZUSTAND.UNVOLLSTAENDIG_FINAL);
});

test("abschlussFuerAnruf: ohne Anruf-Datensatz endet der Abschluss mit profil_fehlt statt mit einem Fehler", () => {
  const ergebnis = abschlussFuerAnruf({
    call: null,
    belege: [],
    nowMs: JETZT_MS,
    deadlineMs: FRIST_MS,
    sweepTraegerErledigt: true,
  });
  assert.equal(ergebnis.geschlossen, true);
  assert.equal(ergebnis.endzustand, ENDZUSTAND.PROFIL_FEHLT);
});
