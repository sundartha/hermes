import test from "node:test";
import assert from "node:assert/strict";
import {
  OUTAGE_VERDICT,
  MIN_TENANTS_SHARED_FAULT,
  outageBucket,
  outageWindow,
  beurteileAusfall,
} from "../src/telephony/outage-detection.js";
import { reasonWithoutCarrier } from "../src/telephony/failure-reason.js";

const SCHWELLEN_FENSTER_MS = 3600000;
const SCHWELLEN = Object.freeze({
  windowMs: SCHWELLEN_FENSTER_MS,
  minFailures: 3,
  minAttempts: 20,
  failSharePercent: 20,
  debounceMs: 21600000,
  retryMs: 900000,
});
const NOW_ISO = "2026-08-27T16:45:00Z";
const NOW_MS = Date.parse(NOW_ISO);
const AUS_SCHWELLEN = Object.freeze({ ...SCHWELLEN, windowMs: 0 });

test("E1 K0: der erste Befund einer Klasse ohne Marker -> erstbefund", () => {
  const fenster = { fehler: 1, versuche: 1, erfolge: 0, tenants: 1 };
  const { urteil } = beurteileAusfall({ fenster, marker: null, schwellen: SCHWELLEN, nowMs: NOW_MS });
  assert.equal(urteil, OUTAGE_VERDICT.FIRST);
});

test("E2 K1 (REGRESSIONSFANG 27.08.2026): 3 Fehler, 0 Erfolge, EIN Tenant, Marker vorhanden -> alarm", () => {
  const fenster = { fehler: 3, versuche: 3, erfolge: 0, tenants: 1 };
  const marker = { reportedAt: null, lastAttemptAt: null };
  const { urteil, zahlen } = beurteileAusfall({ fenster, marker, schwellen: SCHWELLEN, nowMs: NOW_MS });
  assert.equal(urteil, OUTAGE_VERDICT.ALERT);
  assert.deepEqual(zahlen, fenster);
});

test("E3 K1 zweites Bein: 0 Erfolge FALSCH (2 Erfolge), aber >= 2 Tenants -> alarm", () => {
  const HARTKODIERTE_TENANT_ANZAHL = 2;
  const fenster = { fehler: 3, versuche: 5, erfolge: 2, tenants: HARTKODIERTE_TENANT_ANZAHL };
  const marker = { reportedAt: null, lastAttemptAt: null };
  const { urteil } = beurteileAusfall({ fenster, marker, schwellen: SCHWELLEN, nowMs: NOW_MS });
  assert.equal(urteil, OUTAGE_VERDICT.ALERT);
  assert.equal(MIN_TENANTS_SHARED_FAULT, HARTKODIERTE_TENANT_ANZAHL, "Default-Schwelle unveraendert");
});

test("E4 K1-Gegenprobe: ein Tenant, 10x unreachable (fehler bleibt 0 in outageWindow) -> kein-befund", () => {
  const fenster = { fehler: 0, versuche: 10, erfolge: 0, tenants: 0 };
  const { urteil } = beurteileAusfall({ fenster, marker: null, schwellen: SCHWELLEN, nowMs: NOW_MS });
  assert.equal(urteil, OUTAGE_VERDICT.NONE);
});

test("E5 K2 oberhalb: 25 Versuche, 8 Fehler (32% >= 20%) -> alarm", () => {
  const fenster = { fehler: 8, versuche: 25, erfolge: 17, tenants: 3 };
  const marker = { reportedAt: null, lastAttemptAt: null };
  const { urteil } = beurteileAusfall({ fenster, marker, schwellen: SCHWELLEN, nowMs: NOW_MS });
  assert.equal(urteil, OUTAGE_VERDICT.ALERT);
});

test("E6 K2 unterhalb: 25 Versuche, 2 Fehler (8%) -> kein-befund", () => {
  const fenster = { fehler: 2, versuche: 25, erfolge: 23, tenants: 2 };
  const marker = { reportedAt: null, lastAttemptAt: null };
  const { urteil } = beurteileAusfall({ fenster, marker, schwellen: SCHWELLEN, nowMs: NOW_MS });
  assert.equal(urteil, OUTAGE_VERDICT.NONE);
});

test("E7 Skala schweigt: 8300 Versuche, 4 Fehler, viele Erfolge, mehrere Tenants -> kein-befund", () => {
  const fenster = { fehler: 4, versuche: 8300, erfolge: 8259, tenants: 4 };
  const marker = { reportedAt: null, lastAttemptAt: null };
  const { urteil } = beurteileAusfall({ fenster, marker, schwellen: SCHWELLEN, nowMs: NOW_MS });
  assert.equal(urteil, OUTAGE_VERDICT.NONE);
});

test("E8 5xx-Sturm: 50 result-unknown-Versuche zaehlen nicht als fehler -> kein-befund", () => {
  const fenster = { fehler: 0, versuche: 50, erfolge: 0, tenants: 0 };
  const { urteil } = beurteileAusfall({ fenster, marker: null, schwellen: SCHWELLEN, nowMs: NOW_MS });
  assert.equal(urteil, OUTAGE_VERDICT.NONE);
});

test("E9 Entprellung: reportedAt vor 1h -> kein-befund; reportedAt vor 7h -> alarm", () => {
  const fenster = { fehler: 3, versuche: 3, erfolge: 0, tenants: 1 };
  const einStundeAlt = { reportedAt: "2026-08-27T15:45:00Z", lastAttemptAt: null };
  const siebenStundenAlt = { reportedAt: "2026-08-27T09:45:00Z", lastAttemptAt: null };
  assert.equal(
    beurteileAusfall({ fenster, marker: einStundeAlt, schwellen: SCHWELLEN, nowMs: NOW_MS }).urteil,
    OUTAGE_VERDICT.NONE,
  );
  assert.equal(
    beurteileAusfall({ fenster, marker: siebenStundenAlt, schwellen: SCHWELLEN, nowMs: NOW_MS }).urteil,
    OUTAGE_VERDICT.ALERT,
  );
});

test("E10 Wiederholung nach Fehlzustellung (S3-2): lastAttemptAt vor 20min -> alarm; vor 5min -> kein-befund", () => {
  const fenster = { fehler: 3, versuche: 3, erfolge: 0, tenants: 1 };
  const zwanzigMinAlt = { reportedAt: null, lastAttemptAt: "2026-08-27T16:25:00Z" };
  const fuenfMinAlt = { reportedAt: null, lastAttemptAt: "2026-08-27T16:40:00Z" };
  assert.equal(
    beurteileAusfall({ fenster, marker: zwanzigMinAlt, schwellen: SCHWELLEN, nowMs: NOW_MS }).urteil,
    OUTAGE_VERDICT.ALERT,
  );
  assert.equal(
    beurteileAusfall({ fenster, marker: fuenfMinAlt, schwellen: SCHWELLEN, nowMs: NOW_MS }).urteil,
    OUTAGE_VERDICT.NONE,
  );
});

test("E11 Erholung: fehler=0 mit offenem Marker -> erholt", () => {
  const fenster = { fehler: 0, versuche: 5, erfolge: 5, tenants: 0 };
  const marker = { reportedAt: "2026-08-27T15:45:00Z", lastAttemptAt: null };
  const { urteil } = beurteileAusfall({ fenster, marker, schwellen: SCHWELLEN, nowMs: NOW_MS });
  assert.equal(urteil, OUTAGE_VERDICT.RECOVERED);
});

test("E11b (Blocker: falsche Entwarnung bei Null-Verkehr) Erholung OHNE Verkehr -> KEIN Befund, Marker bleibt offen", () => {
  const fensterLeer = { fehler: 0, versuche: 0, erfolge: 0, tenants: 0 };
  const marker = { reportedAt: "2026-08-27T15:45:00Z", lastAttemptAt: null };
  const { urteil } = beurteileAusfall({ fenster: fensterLeer, marker, schwellen: SCHWELLEN, nowMs: NOW_MS });
  assert.equal(urteil, OUTAGE_VERDICT.NONE, "kein Verkehr ist KEIN Beleg fuer Erholung");
});

test("E11c (Blocker-Gegenprobe): ein Fenster voller FEHLVERSUCHE (versuche>0, erfolge=0) ist ebenfalls KEINE Erholung", () => {
  const fensterNurVersuche = { fehler: 0, versuche: 10, erfolge: 0, tenants: 0 };
  const marker = { reportedAt: "2026-08-27T15:45:00Z", lastAttemptAt: null };
  const { urteil } = beurteileAusfall({ fenster: fensterNurVersuche, marker, schwellen: SCHWELLEN, nowMs: NOW_MS });
  assert.equal(urteil, OUTAGE_VERDICT.NONE);
});

test("E12 Aus-Schalter: windowMs=0 bei sonst voller Alarm-Lage -> aus", () => {
  const fenster = { fehler: 3, versuche: 3, erfolge: 0, tenants: 1 };
  const marker = { reportedAt: null, lastAttemptAt: null };
  const { urteil } = beurteileAusfall({ fenster, marker, schwellen: AUS_SCHWELLEN, nowMs: NOW_MS });
  assert.equal(urteil, OUTAGE_VERDICT.OFF);
});

test("E13 Fenster-Ableitung: outageWindow gegen 6 Anruf-Zeilen", () => {
  const bucket = "not-placed:invite-403";
  const calls = [
    {
      direction: "outbound", tenantId: "t_ausserhalb", failureReason: "not-placed:invite-403-D51",
      endedAt: "2026-08-27T14:45:00Z", answeredAt: null,
    },
    {
      direction: "inbound", tenantId: "t_in", failureReason: "not-placed:invite-403-D51",
      endedAt: "2026-08-27T16:44:00Z", answeredAt: null,
    },
    {
      direction: "outbound", tenantId: "t_anders", failureReason: "not-placed:start-403",
      endedAt: "2026-08-27T16:44:00Z", answeredAt: null,
    },
    {
      direction: "outbound", tenantId: "t_erfolg", failureReason: null,
      endedAt: "2026-08-27T16:44:00Z", answeredAt: "2026-08-27T16:43:55Z",
    },
    {
      direction: "outbound", tenantId: "t_eins", failureReason: "not-placed:invite-403-D51",
      endedAt: "2026-08-27T16:44:30Z", answeredAt: null,
    },
    {
      direction: "outbound", tenantId: "t_zwei", failureReason: "not-placed:invite-403-D11",
      endedAt: "2026-08-27T16:44:50Z", answeredAt: null,
    },
  ];
  const zahlen = outageWindow(calls, { nowMs: NOW_MS, windowMs: SCHWELLEN.windowMs, bucket });
  assert.deepEqual(zahlen, { fehler: 2, versuche: 4, erfolge: 1, tenants: 2 });
});

test("E14 Eimer-Bildung: Carrier-Suffix faellt weg, andere Quelle bleibt ein anderer Eimer", () => {
  assert.equal(outageBucket("not-placed:invite-403-D51"), "not-placed:invite-403");
  assert.equal(outageBucket("not-placed:invite-403"), "not-placed:invite-403");
  assert.notEqual(outageBucket("not-placed:start-403"), outageBucket("not-placed:invite-403"));
  assert.equal(outageBucket(null), null);
});

test("G22/G5: outageBucket ist die EINE Delegation auf failure-reason.js#reasonWithoutCarrier - keine zweite Kopie der Grammatik", () => {
  assert.equal(outageBucket, reasonWithoutCarrier);
});
