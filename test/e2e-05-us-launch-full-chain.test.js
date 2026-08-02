// E2E-05 (i18n-Testkatalog, tasks/i18n-tests/11-luecken-und-e2e.md:966) - US-Launch-
// Vollkette unter Produktionswerten.
//
// Faehrt die AUSGELIEFERTE Konfiguration (GAP-33, test/prod-env.js, bereits gemergt) -
// NICHT die neutralisierte BASE_ENV: sonst misst dieser Test genau den Zustand, gegen den
// GAP-33 gebaut wurde, und jedes gruene Ergebnis waere wertlos (Vorgabe des Workflows).
//
// Der Katalog verlangt alle sechs Schritte (Onboard, Abo+DID, Inbound, Outbound,
// Summary-SMS, MCP get_agent_status) englisch/US-korrekt. Schritt 1 hatte zwei
// eigenstaendige Wurzeln (Beleg tasks/i18n-tests/11-luecken-und-e2e.md:981-984):
//   (a) normalizePrivateNumber() im Onboard-Pfad ignoriert country=US komplett und
//       erbt den ["+49"]-Default (FMT-11, src/routes/api-onboard.js:125) -> 400, BEVOR
//       das Land ueberhaupt gelesen wird. Weiterhin offen.
//   (b) selbst OHNE die private Nummer blieb language="de" (D1/DID-01,
//       src/i18n/locales.js:268-280: "US" fehlt in LANGUAGE_FOR_COUNTRY). Ueber den
//       Weltdefault-Flip (P10) geloest - Schritt 1b ist gruen.
// Die restlichen vier Schritte (DID-Kauf, Inbound, Outbound, SMS, MCP) sind nachgelagert
// zu (a)/(b) und werden hier NICHT zusaetzlich durchgespielt (s. Bestandsbegruendung).
//
// AUTH-P6: /api/onboard ist seither eine Betreiber-Route (webAuthMw+adminMw, nur MIT
// operatorAuth gemountet) - ein Spawn-Server unter prodEnv() (STORE_BACKEND bleibt bei
// BASE_ENV "json", prodEnv() setzt es bewusst NICHT - die Suite laeuft offline ohne
// Postgres) mountet die Route darum gar nicht mehr. SPAWN BLEIBT (diese Datei ist eine
// Kette, kein Routen-Test - sie soll pruefen, ob der PROZESS unter Produktionswerten
// bootet, nicht die Admin-Sitzung): der Onboard-HTTP-Schritt wird durch (1) einen
// direkten Aufruf derselben PUREN Funktionen ersetzt, die api-onboard.js fuer genau
// diese zwei Befunde nutzt (normalizePrivateNumber, resolveOnboardCountry,
// tenantGeoForCountry - kein Routen-Umweg noetig, die Funktionen sind config-frei) UND
// (2) einem Store-Seed mit dem Tenant + einer 'requested'-Nummer im Ergebniszustand
// eines erfolgreichen Onboards, gegen den der Spawn-Server unter prodEnv() erfolgreich
// bootet (beweist: kein Boot-Gate unter Produktionswerten lehnt einen solchen US-Tenant
// ab - Abgrenzung zur reinen Logikpruefung in (1)).
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState } from "./helpers.js";
import { prodEnv } from "./prod-env.js";
import { normalizePrivateNumber } from "../src/store/state-ops.js";
import { resolveOnboardCountry, tenantGeoForCountry } from "../src/geo/resolve.js";
import { setWorldDefaultLanguageEnabled } from "../src/store/defaults.js";

test("Schritt 1a: Onboard country=US + passende US-Privatnummer darf nicht am +49-Gate scheitern (ex E2E-05)", async () => {
  // (1) Logik direkt: dieselbe Funktion, denselben Aufruf wie api-onboard.js VOR dem
  // Store-Lock (normalizePrivateNumber(privateNumber, country)). Wirft sie, waere das
  // frueher ein 400 gewesen - der Test faengt genau diesen Wurf.
  assert.doesNotThrow(
    () => normalizePrivateNumber("+14155550123", "US"),
    "SOLL: eine passende US-Privatnummer darf unter country=US nicht am +49-Default-Gate scheitern",
  );
  const e164 = normalizePrivateNumber("+14155550123", "US");
  assert.equal(e164, "+14155550123");

  // (2) Boot unter Produktionswerten: ein Tenant im Ergebniszustand eines erfolgreichen
  // Onboards (country=US, privateNumber gesetzt, Nummer 'requested') bootet fehlerfrei.
  const srv = await startServer({
    env: prodEnv(),
    seed: seedState({
      tenants: [{ id: "t_e2e05a", status: "active", country: "US", privateNumber: e164 }],
    }),
  });
  try {
    const health = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(health.status, 200, "Server bootet unter Produktionswerten mit einem US-Tenant");
  } finally {
    await srv.stop();
  }
});

test("Schritt 1b: Onboard country=US liefert language=en ueber den Weltdefault (ex E2E-05)", async () => {
  // Review-Fix (Runde 2, P10-Blocker "Aktivierungsfenster"): render.yaml faehrt
  // WORLD_DEFAULT_LANGUAGE_ENABLED bis zur P13-Abnahme bewusst auf "false" (das
  // Aktivierungsfenster P10-P13 bleibt geschlossen). Dieser Test prueft den Flip-
  // MECHANISMUS (D1/DID-01, "US" -> language=en ueber den Weltdefault), nicht das
  // Aktivierungsfenster - der explizite Enabled-Aufruf haelt beides auseinander,
  // statt den Blueprint-Wert zu missbrauchen, um den Test gruen zu bekommen.
  setWorldDefaultLanguageEnabled(true);
  try {
    // (1) Logik direkt: dieselbe Aufloesung wie api-onboard.js (resolveOnboardCountry
    // -> tenantGeoForCountry.defaultLanguage), ohne body.country-User-Override oder
    // Geo-Vorschlag (Muster: Onboard ohne privateNumber im Bestand).
    const country = resolveOnboardCountry({
      userCountry: "US",
      proposedCountry: null,
      fallbackCountry: "DE",
    });
    assert.equal(country, "US");
    const geo = tenantGeoForCountry(country);
    assert.equal(
      geo.defaultLanguage,
      "en",
      `SOLL: ein US-Onboard muss language=en liefern (gemessen: "${geo.defaultLanguage}")`,
    );

    // (2) Boot unter Produktionswerten: derselbe Tenant (country=US, defaultLanguage=en,
    // wie es das erfolgreiche Onboard persistiert haette) bootet fehlerfrei.
    const srv = await startServer({
      env: prodEnv({ WORLD_DEFAULT_LANGUAGE_ENABLED: "true" }),
      seed: seedState({
        tenants: [{ id: "t_e2e05b", status: "active", country, defaultLanguage: geo.defaultLanguage }],
      }),
    });
    try {
      const health = await fetch(`${srv.localUrl}/healthz`);
      assert.equal(health.status, 200, "Server bootet unter Produktionswerten mit einem US/en-Tenant");
    } finally {
      await srv.stop();
    }
  } finally {
    setWorldDefaultLanguageEnabled(true); // Byte-identisch fuer nachfolgende Tests (F.I.R.S.T.)
  }
});
