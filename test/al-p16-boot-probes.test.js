// AL-P16: die Sonden fuer die blinden Schalter. Zwei Ebenen, bewusst:
//   (a) capabilityProbeLines als reine Funktion - je Schalter beide Richtungen (die Spec
//       verlangt das ausdruecklich: eine Sonde, die nur den Gutfall zeigt, meldet den
//       Ausfall nie);
//   (b) zwei Spawn-Tests am ECHTEN Boot-Log - sonst bliebe die Verdrahtung in
//       logBootBanner ungetestet und ein geloeschter Aufruf faellt niemandem auf.
//
// MUTATIONSPROBE (Spec-Abnahme): stellt man eine Sonde auf process.env statt auf das
// uebergebene config-Objekt um, liefert sie fuer beide Richtungen DIESELBE Zeile - jeder
// der Tests AL-P16-1..6 wird dadurch rot, AL-P16-7 pinnt es zusaetzlich explizit.
import test from "node:test";
import assert from "node:assert/strict";
import { capabilityProbeLines } from "../src/boot.js";
import { startServer } from "./helpers.js";

// Der Sentinel-Schluessel, den keine Zeile und kein Boot-Log tragen darf (Regel 4).
const SENTINEL_KEY = "exa-al-p16-darf-nirgends-auftauchen";

// Alles aus - der ausgelieferte Default (BASE_ENV/config-Fallbacks).
function probeConfig({ tenancy = {}, research = {}, privacy = {} } = {}) {
  return {
    tenancy: {
      precallBriefingEnabled: false,
      consultEnabled: false,
      assistantContextEnabled: false,
      ...tenancy,
    },
    research: { researchEnabled: false, lookupEnabled: false, exaApiKey: "", ...research },
    privacy: { evidenceRetentionDays: 0, ...privacy },
  };
}

// Genau EINE Zeile je Label - so faellt auch ein geloeschter oder doppelter Eintrag auf.
function probe(label, config) {
  const hits = capabilityProbeLines(config).filter((l) => l.startsWith(`${label}: `));
  assert.equal(hits.length, 1, `erwartet genau eine ${label}-Zeile, bekommen: ${hits.length}`);
  return hits[0];
}

test("AL-P16-1: Vorab-Briefing meldet beide Richtungen samt Kontext-Kanal-Bedingung", () => {
  const off = probe("Vorab-Briefing", probeConfig());
  assert.equal(
    off,
    "Vorab-Briefing: aus (PRECALL_BRIEFING_ENABLED=false) - wirkt nur mit ASSISTANT_CONTEXT_ENABLED=false",
  );

  const on = probe(
    "Vorab-Briefing",
    probeConfig({ tenancy: { precallBriefingEnabled: true, assistantContextEnabled: true } }),
  );
  assert.equal(
    on,
    "Vorab-Briefing: AKTIV (PRECALL_BRIEFING_ENABLED=true) - wirkt nur mit ASSISTANT_CONTEXT_ENABLED=true",
  );
});

test("AL-P16-2: Vorab-Recherche meldet beide Richtungen und nennt immer das Tenant-Recht", () => {
  const off = probe("Vorab-Recherche", probeConfig());
  assert.equal(
    off,
    "Vorab-Recherche: aus (RESEARCH_ENABLED=false) - wirkt nur mit allowResearch am Tenant",
  );

  const on = probe("Vorab-Recherche", probeConfig({ research: { researchEnabled: true } }));
  assert.equal(
    on,
    "Vorab-Recherche: AKTIV (RESEARCH_ENABLED=true) - wirkt nur mit allowResearch am Tenant",
  );
});

test("AL-P16-3: In-Call-Nachschlag ist zweiteilig - Flag UND Anbieter-Schluessel", () => {
  const bothOff = probe("In-Call-Nachschlag", probeConfig());
  assert.equal(
    bothOff,
    "In-Call-Nachschlag: aus (LOOKUP_ENABLED=false) - EXA_API_KEY fehlt, wirkt nur mit allowLookup am Tenant",
  );

  const flagOnKeyMissing = probe("In-Call-Nachschlag", probeConfig({ research: { lookupEnabled: true } }));
  assert.equal(
    flagOnKeyMissing,
    "In-Call-Nachschlag: AKTIV (LOOKUP_ENABLED=true) - EXA_API_KEY fehlt, wirkt nur mit allowLookup am Tenant",
  );

  const flagOnKeySet = probe(
    "In-Call-Nachschlag",
    probeConfig({ research: { lookupEnabled: true, exaApiKey: "exa-irgendwas" } }),
  );
  assert.equal(
    flagOnKeySet,
    "In-Call-Nachschlag: AKTIV (LOOKUP_ENABLED=true) - EXA_API_KEY gesetzt, wirkt nur mit allowLookup am Tenant",
  );
});

test("AL-P16-4: der Anbieter-Schluessel erscheint in KEINER Sonden-Zeile (Regel 4)", () => {
  const lines = capabilityProbeLines(
    probeConfig({ research: { lookupEnabled: true, exaApiKey: SENTINEL_KEY } }),
  );
  assert.doesNotMatch(
    lines.join("\n"),
    new RegExp(SENTINEL_KEY),
    "der EXA_API_KEY darf nur als gesetzt/fehlt erscheinen, nie im Klartext",
  );
});

test("AL-P16-5: Consult-Kanal meldet beide Richtungen samt beider Restbedingungen", () => {
  const off = probe("Consult-Kanal", probeConfig());
  assert.equal(
    off,
    "Consult-Kanal: aus (CONSULT_ENABLED=false) - wirkt nur mit ASSISTANT_CONTEXT_ENABLED=false und allowConsult am Tenant",
  );

  const on = probe(
    "Consult-Kanal",
    probeConfig({ tenancy: { consultEnabled: true, assistantContextEnabled: true } }),
  );
  assert.equal(
    on,
    "Consult-Kanal: AKTIV (CONSULT_ENABLED=true) - wirkt nur mit ASSISTANT_CONTEXT_ENABLED=true und allowConsult am Tenant",
  );
});

test("AL-P16-6: Ergebnis-Zitate tragen die Frist als Wert, nicht ein Bool", () => {
  const off = probe("Ergebnis-Zitate", probeConfig());
  assert.equal(off, "Ergebnis-Zitate: aus (EVIDENCE_RETENTION_DAYS=0) - 0 = keine Zitate");

  const on = probe("Ergebnis-Zitate", probeConfig({ privacy: { evidenceRetentionDays: 2 } }));
  assert.equal(
    on,
    "Ergebnis-Zitate: AKTIV (EVIDENCE_RETENTION_DAYS=2) - Zitate werden erhoben und nach 2 Tagen geloescht",
  );
});

test("AL-P16-7: die Sonden folgen der geparsten Konfiguration, NICHT der Rohumgebung", () => {
  // Die Umgebung wird auf das GEGENTEIL der uebergebenen Konfiguration gestellt: eine
  // Sonde, die process.env liest, liefert dann die falsche Zeile.
  const opposite = {
    PRECALL_BRIEFING_ENABLED: "true",
    RESEARCH_ENABLED: "true",
    LOOKUP_ENABLED: "true",
    CONSULT_ENABLED: "true",
    EVIDENCE_RETENTION_DAYS: "9",
  };
  const before = Object.fromEntries(Object.keys(opposite).map((k) => [k, process.env[k]]));
  Object.assign(process.env, opposite);
  try {
    for (const line of capabilityProbeLines(probeConfig())) {
      assert.match(line, /: aus \(/, `erwartet den Aus-Zustand aus der Konfiguration: ${line}`);
    }
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("AL-P16-8: der echte Boot druckt jede der fuenf Sonden genau einmal (Aus-Zustand)", async () => {
  const srv = await startServer({});
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, 200);
    assert.doesNotMatch(srv.stdout, /Start abgebrochen/);
    for (const label of [
      "Vorab-Briefing",
      "Vorab-Recherche",
      "In-Call-Nachschlag",
      "Consult-Kanal",
      "Ergebnis-Zitate",
    ]) {
      const hits = srv.stdout.match(new RegExp(`${label}: `, "g"));
      assert.equal(hits ? hits.length : 0, 1, `erwartet genau eine ${label}-Zeile:\n${srv.stdout}`);
    }
  } finally {
    await srv.stop();
  }
});

test("AL-P16-9: Nachschlag an -> Boot-Log meldet den Schluessel als gesetzt, nie seinen Wert", async () => {
  const srv = await startServer({ env: { LOOKUP_ENABLED: "true", EXA_API_KEY: SENTINEL_KEY } });
  try {
    // startServer loest auf der Gateway-Zeile auf - die Sonden stehen DAHINTER im Banner.
    // Der Roundtrip laesst den Rest des Banners eintreffen (Muster P5-B4).
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, 200);
    assert.match(
      srv.stdout,
      /In-Call-Nachschlag: AKTIV \(LOOKUP_ENABLED=true\) - EXA_API_KEY gesetzt/,
    );
    assert.doesNotMatch(
      srv.stdout,
      new RegExp(SENTINEL_KEY),
      "der Anbieter-Schluessel darf nirgends im Boot-Log erscheinen (Regel 4)",
    );
  } finally {
    await srv.stop();
  }
});
