// Test-Helpers: Server als Kindprozess starten (PORT=0 -> echten Port aus dem
// Log parsen), Store-Seeding in ein Temp-DATA_DIR und Requests ueber die
// externe Interface-IP (fuer Tests, die NICHT als localhost gelten sollen).
import assert from "node:assert/strict";
import { spawn } from "child_process";
import crypto from "node:crypto";
import fs from "fs";
import http from "node:http";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { BOOTSTRAP_TENANT_ID, DEFAULT_GREETING } from "../src/store/defaults.js";
import { makeDefaultState } from "../src/store/state-ops.js";
import * as stateOps from "../src/store/state-ops.js";

// ROOT exportiert (AM3): single-origin-serving.test.js bildet einen RELATIVEN
// WEB_DIST_DIR gegen das Arbeitsverzeichnis des Spawn-Childs (= ROOT).
export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const STARTUP_TIMEOUT_MS = 15000;

// Owner-Absendernummer fuer Spawn-Tests: ersetzt den frueheren config-Seed
// (TWILIO_NUMBER), seit der Owner seine Nummer wie jeder Tenant im Store haelt.
// Ohne sie greift der Boot-Guard (kein Owner-Outbound -> Exit). +15005550006 =
// bisherige BASE_ENV-Nummer + seedCall.from (byte-identisch zum Altbestand).
// C-P2: der PROVIDER ist telnyx, die NUMMER bleibt die US-DID. Telnyx ist der einzige
// Anbieter, auf dem real telefoniert wird (Praemisse belegt: 3 Nummern, 67 Anrufe, 0 auf
// Twilio). Seit C-P4 ist er auch der einzige registrierte: die frueher hier danebenstehende
// TWILIO_TEST_OWNER_NUMBER ist mit dem Adapter entfallen, wie ihr eigener Kommentar es
// angekuendigt hatte.
export const OWNER_TEST_NUMBER = Object.freeze({ e164: "+15005550006", provider: "telnyx" });

// Inlands-DID fuer Tests, die ausdruecklich ein INLANDS-Leg fahren (P5-Herkunfts-Achse:
// Inlandssatz nur bei gleicher Vorwahl an beiden Enden). BEWUSST kein neuer Default fuer
// OWNER_TEST_NUMBER: die ausgelieferte Default-DID ist US, und genau das muss der
// Live-Messpunkt test/prod-config-smoke.test.js weiter fahren.
export const DOMESTIC_TEST_NUMBER = Object.freeze({ e164: "+4930111222333", provider: "telnyx" });

// Owner-Identitaet fuer Spawn-Tests: ersetzt den frueheren config-derived Identitaets-
// Seed (OWNER_FIRST_NAME/OWNER_LAST_NAME, P2b entfernt). Die Identitaet lebt jetzt im
// Store (wie die Owner-Nummer) -> ensureOwnerNumber traegt sie auf dem Owner-Tenant ein.
// firstName/lastName getrennt, ownerName = "firstName lastName" (= "Jonas Beispiel",
// woertlich gepinnt von Disclosure-/Greeting-Tests).
export const OWNER_TEST_FIRST_NAME = "Jonas";
export const OWNER_TEST_LAST_NAME = "Beispiel";
const OWNER_TEST_NAME = `${OWNER_TEST_FIRST_NAME} ${OWNER_TEST_LAST_NAME}`;

// ALLE config-relevanten Env-Variablen explizit setzen: dotenv fuellt nur
// UNgesetzte Variablen, so kann eine lokale .env die Tests nicht beeinflussen.
export const BASE_ENV = {
  PORT: "0",
  DATA_DIR: "", // wird pro Server durch ein Temp-Verzeichnis ersetzt
  ANTHROPIC_API_KEY: "test-anthropic-key",
  // B5: Anbieter-Wahl neutral auf den Default gepinnt, sonst leakt eine lokale .env via
  // dotenv in Spawn-Tests. test/b5-llm-registry.test.js setzt den Wert gezielt auf Muell.
  LLM_PROVIDER: "anthropic",
  // B5: leer, NICHT ein Dummy - die lokale .env traegt inzwischen einen ECHTEN Schluessel
  // (B1), der sonst in jeden Spawn-Prozess wandert. Bei LLM_PROVIDER=anthropic ist leer
  // der Normalfall; b5-Tests, die den Fremdadapter booten, setzen ihn explizit.
  DEEPSEEK_API_KEY: "",
  CLAUDE_MODEL: "claude-haiku-4-5",
  // 30 spiegelt den Live-Wert (Entscheidung 8, PLAN-LIVE-COST-TRACING); seit P7 traegt der
  // CODE-Fallback in src/config.js dieselbe Zahl (der Pin hier bleibt trotzdem, Lehre
  // test-base-env-drift). Der frueher hier begruendete Boot-Zwang (abgeleitete Plan-Decke
  // gegen den Plattform-Cap) ist mit KS-P9/E10 entfallen; die Zahl wirkt jetzt als
  // Warnschwelle der Plattform-Beobachtung UND - bei DEFAULT_TENANT_BUDGET_CENTS=0 - als
  // Pro-Tenant-Fallback (effectiveCapCents Stufe 3), auf den mehrere Spawn-Tests bauen.
  MAX_BUDGET_EUR: "30",
  // ---- LLM-Resilienz-Seam (P3b-R, src/llm.js) ----
  // Neutral + deterministisch: kurzer Timeout/Backoff, damit Tests, die den Seam ab
  // CP3 beruehren, nicht haengen; sonst leakt eine lokale .env via dotenv in Spawn-Tests
  // -> Baseline-Drift (Lehre test-base-env-drift). LLM_BACKOFF_MS=1 (nicht 250), damit
  // der ab CP3 konsumierte Seam Spawn-Tests nicht ausbremst (CP3 ownt diese Datei nicht).
  LLM_REQUEST_TIMEOUT_MS: "3500",
  LLM_MAX_RETRIES: "2",
  LLM_BACKOFF_MS: "1",
  LLM_BREAKER_THRESHOLD: "5",
  LLM_BREAKER_WINDOW_MS: "10000",
  LLM_BREAKER_COOLDOWN_MS: "30000",
  // L0-Instrumentierung in Spawn-Tests AUS (deterministisch, kein Log-Rauschen; sonst
  // leakt lokales .env via dotenv -> Baseline-Drift, Lehre test-base-env-drift).
  METRICS_ENABLED: "false",
  // GAP-36: Deploy-Commit in Spawn-Tests neutral leer (-> Sentinel "unbekannt"), sonst
  // leakt eine lokale .env via dotenv in die Spawn-Tests (Lehre test-base-env-drift).
  // gap-36-healthz-fingerprint.test.js setzt ihn explizit.
  RENDER_GIT_COMMIT: "",
  // Absendernummern sind keine Env-Var mehr: die Owner-Nummer kommt ueber
  // ensureOwnerNumber in den Spawn-Store (OWNER_TEST_NUMBER). Provider-spezifische
  // Tests reichen ownerNumber:{e164,provider} an startServer durch.
  // C-P5: TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_EDGE sind hier ENTFALLEN, weil es die
  // Variablen nicht mehr gibt (config.js). Umkehrung der BASE_ENV-Drift-Lehre, Praezedenz
  // KS-P3 (b) weiter unten: eine gepinnte, aber tote Env-Zeile taeuscht kuenftigen Lesern eine
  // wirksame Klemme vor und schuetzt vor nichts.
  // GAP-21: Default AUS neutral gepinnt (Lehre test-base-env-drift). Einzelne Tests
  // setzen MACHINE_DETECTION_ENABLED gezielt auf "true".
  MACHINE_DETECTION_ENABLED: "false",
  MACHINE_DETECTION_TIMEOUT_S: "5",
  // P2b: OWNER_FIRST_NAME/OWNER_LAST_NAME/OWNER_NUMBER sind keine Config-Env mehr. Die
  // Owner-Identitaet + -Nummer seedet ensureOwnerNumber direkt in den Spawn-Store
  // (OWNER_TEST_FIRST_NAME/OWNER_TEST_NUMBER), wie in Produktion (Store statt Env).
  SEND_SMS_SUMMARY: "false",
  PUBLIC_URL: "https://agent.test",
  DASHBOARD_PASSWORD: "",
  MCP_AUTH_TOKEN: "",
  LOGIN_COOKIE_TTL_SECONDS: "1800", // AM2: neutral gepinnt (sonst leakt lokale .env in Spawn-Tests)
  ALLOWED_NUMBERS: "",
  // outbound-p3: Outbound-Kill-Switch neutral AUS (fail-closed Default false = nicht gesperrt).
  // Ohne diese Zeile leakt eine lokale .env mit OUTBOUND_FROZEN=true via dotenv in Spawn-Tests
  // -> Baseline-Drift (Lehre test-base-env-drift). outbound-frozen.test.js setzt es explizit.
  OUTBOUND_FROZEN: "false",
  // OUTBOUND-E4: der ANI-Riegel ist ein SICHERHEITS-Gate (kann Anrufe ablehnen) - neutral
  // AUS, byte-identisch zum Produktions-Default. Kein Bestandstest soll ihn ungewollt
  // scharf schalten; test/outbound-ani-gate.test.js setzt ihn explizit.
  OUTBOUND_ANI_GATE_ENABLED: "false",
  // OUTBOUND-E4: der Drift-Waechter ist KEIN Sicherheits-Gate, macht aber Anbieter-IO
  // (Telnyx/ElevenLabs GETs). 0 = KOMPLETT AUS (Rollback-Hebel, Muster
  // OUTAGE_ALERT_WINDOW_MS=0 oben) - ohne diese Zeile liefe JEDER Spawn-Test beim Boot in
  // eine Anbieter-Abfrage (Lehre test-base-env-drift). test/outbound-drift-*.test.js
  // fahren den Kern/die Watch-Funktion direkt, ohne den echten Boot-Takt zu brauchen.
  OUTBOUND_DRIFT_MIN_INTERVAL_MS: "0",
  ALLOWED_COUNTRY_CODES: "*", // Land-Gate fuer Altbestand neutral; number-gate.test.js setzt es explizit
  MAX_CALLS_PER_HOUR: "100", // hoch genug, dass es Altbestand-Tests nicht bremst (wie RATE_LIMIT_PER_MIN)
  PROFILES_JSON: "", // Profile-Seed leer; einzelne Tests setzen es explizit
  // Owner-Number-Autoseed neutral leer (render-owner-autoseed, R8): ohne diese Zeilen
  // leakt eine lokale .env mit OWNER_NUMBER_SEED/OWNER_NUMBER_PROVIDER via dotenv in
  // Spawn-Tests -> eine geseedete Owner-Nummer braeche u.a. den Boot-Refusal-Test
  // (boot-failclosed.test.js, ownerNumber:null) (Lehre test-base-env-drift). Tests, die
  // den Autoseed pruefen (owner-number-seed.test.js), setzen sie explizit per env-Override.
  OWNER_NUMBER_SEED: "",
  OWNER_NUMBER_PROVIDER: "",
  // GAP-38: Bootstrap-Parameter in Spawn-Tests neutral leer - sonst leakt eine lokale .env
  // via dotenv und heilt Stores, deren Boot-Refusal drei Tests gerade beweisen
  // (boot-failclosed, owner-number-seed, store-integrity). Tests, die die Heilung pruefen,
  // setzen sie explizit per env-Override.
  BOOTSTRAP_E164: "",
  BOOTSTRAP_PROVIDER: "",
  // OUTBOUND-E1: neutral leer - ohne diesen Eintrag leakt die echte .env per dotenv in
  // jeden Spawn-Test (Lehre test-base-env-drift), hier mit besonders unangenehmer Folge:
  // die echte Live-ANI wuerde in Spawn-Tests gebunden und der Freigabe-Riegel in fremden
  // Tests scharf. Tests, die die Bindung pruefen, setzen sie explizit per env-Override.
  PLATFORM_ANI_E164: "",
  // AM6: Owner-OAuth-Identitaets-Seed neutral leer (kein idp_subject-Seed). Ohne diese
  // Zeile leakt eine lokale .env mit OWNER_IDP_SUBJECT via dotenv in Spawn-Tests ->
  // Baseline-Drift (Lehre test-base-env-drift). am6-oauth-tenant.test.js setzt es explizit.
  OWNER_IDP_SUBJECT: "",
  // KS-P3 (b): MAX_CALL_DURATION_S ist hier ENTFALLEN, weil es die Variable nicht mehr
  // gibt (E2/E3). Umkehrung der BASE_ENV-Drift-Lehre: eine gepinnte, aber tote Env-Zeile
  // taeuscht kuenftigen Lesern eine wirksame Klemme vor und schuetzt vor nichts.
  CAP_FAREWELL_LEAD_MS: "20000", // P3.1: neutraler Default, sonst leakt lokales .env in Spawn-Tests
  RESERVE_RELEASE_GRACE_MS: "15000", // OUT-05 F2: neutraler Default, sonst leakt lokales .env in Spawn-Tests
  FAKE_ORIGINATE: "false", // OUT-05 F2: Test-Seam AUS; einzelne Tests setzen ihn explizit
  SHUTDOWN_DRAIN_TIMEOUT_MS: "8000", // A6 F11: neutraler Default, sonst leakt lokales .env in Spawn-Tests
  STT_SPEECH_TIMEOUT_SEC: "2", // G3: neutraler Default, sonst leakt lokales .env in Spawn-Tests (test-base-env-drift)
  // STT-A1: neutral auf das Default-Profil gepinnt, sonst leakt eine lokale .env via
  // dotenv in Spawn-Tests (Lehre test-base-env-drift). stt-model-seam.test.js setzt den
  // Wert gezielt auf Muell, um den Boot-Refusal zu belegen.
  STT_PROFILE: "accurate",
  // stab-p7: Turn-Guard-Schwellen neutral auf den config-Default gepinnt (sonst leakt eine
  // lokale .env via dotenv in Spawn-Tests -> Baseline-Drift, Lehre test-base-env-drift).
  MAX_EMPTY_TURNS: "3",
  CALLER_SUBSTANCE_MIN_LEN: "2",
  SKIP_TWILIO_SIGNATURE_CHECK: "true",
  RATE_LIMIT_PER_MIN: "1000",
  RETENTION_DAYS: "0",
  // P2b: Diagnose-Retention in Spawn-Tests neutral AUS (= Bestandsverhalten). Ohne diese
  // Zeile leakt eine lokale .env via dotenv in die Spawn-Tests -> Baseline-Drift.
  // diagnostic-retention-http.test.js setzt sie explizit auf "7".
  DIAGNOSTIC_RETENTION_DAYS: "0",
  // AL-P11: Zitat-Erhebung in Spawn-Tests neutral AUS (= Bestandsverhalten). Ohne diese
  // Zeile leakt eine lokale .env via dotenv in die Spawn-Tests (Lehre test-base-env-drift).
  EVIDENCE_RETENTION_DAYS: "0",
  // OC-P1: Offenlegungs-Ausnahme in Spawn-Tests neutral AUS und Allowlist LEER
  // (= Bestandsverhalten, Offenlegung ueberall). Ohne diese zwei Zeilen leckt eine lokale
  // .env via dotenv in JEDEN Spawn-Test (Lehre test-base-env-drift) - und zwar auf die
  // eine Achse, an der ab OC-P2 ein gesetzlicher Pflichtsatz haengt.
  // test/oc-p1-owner-call-http.test.js setzt beide explizit.
  OWNER_SELF_CALL_ENABLED: "false",
  OWNER_SELF_CALL_TENANT_IDS: "",
  VOICE_ENGINE: "budget",
  OPENAI_API_KEY: "",
  REALTIME_MODEL: "gpt-realtime",
  REALTIME_VOICE: "alloy",
  // ---- Telnyx (zweiter Provider) ----
  // Nummern sind keine Env-Var mehr (s.o.). Keys/IDs neutral leer; Tests, die
  // Telnyx-Outbound brauchen, seeden eine Telnyx-Owner-Nummer via ownerNumber.
  // OFFLINE-DISKRIMINATOR der Outbound-Tests (gemessen 2026-08-07 am Server-Log des
  // Spawn-Kindes): leer gepinnt -> originateCall (adapters/telnyx/voice.js) wirft SYNCHRON
  // vor jedem Netzzugriff ("Telnyx originateCall: TELNYX_API_KEY fehlt"). POST /api/calls
  // faengt das ohne err.providerStatus -> HTTP 500. 500 heisst deshalb "alle Gates passiert,
  // bis zum Provider-Aufruf durchgekommen"; 400/402/403/429 heisst "ein Gate hat gesperrt".
  // (Bis C-P4 trug ein nicht-AC TWILIO_ACCOUNT_SID diese Rolle - seit dem Adapter-Ausbau war
  // dieser Wert inert und die Begruendung falsch, obwohl die Tests gruen blieben.)
  TELNYX_API_KEY: "",
  TELNYX_PUBLIC_KEY: "",
  TELNYX_API_BASE: "",
  TELNYX_CONNECTION_ID: "",
  TELNYX_CALL_CONTROL_APP_ID: "",
  // OUTBOUND-E4: neutral leer, sonst leakt eine lokale .env in Spawn-Tests (Lehre
  // test-base-env-drift). Wirkungslos hier, weil OUTBOUND_DRIFT_MIN_INTERVAL_MS=0 den
  // Waechter ohnehin komplett aushaelt - Pin trotzdem, Muster TELNYX_CONNECTION_ID.
  TELNYX_FQDN_CONNECTION_ID: "",
  TELNYX_OUTBOUND_VOICE_PROFILE_ID: "",
  TELNYX_ACCOUNT_SID: "",
  // Telnyx AI Assistant / Brain-Shim (PLAN-TELNYX-AI-ASSISTANT P1) neutral AUS
  // (fail-closed): der Shim antwortet 404, der Live-Pfad ist byte-identisch. Ohne diese
  // Zeile leakt eine lokale .env mit TELNYX_AI_ASSISTANT_ENABLED=true via dotenv in
  // Spawn-Tests -> Baseline-Drift (Lehre test-base-env-drift). Der Shim-HTTP-Test setzt
  // sie explizit auf "true".
  TELNYX_AI_ASSISTANT_ENABLED: "false",
  // P5: neutrale Defaults, sonst leakt eine lokale .env mit TELNYX_ASSISTANT_ID/
  // TELNYX_SHIM_MAX_TURNS_PER_MIN via dotenv in Spawn-Tests -> Baseline-Drift (Lehre
  // test-base-env-drift). Leere assistantId -> P4.5 onSpeakEnded skippt fail-safe.
  TELNYX_ASSISTANT_ID: "",
  TELNYX_SHIM_MAX_TURNS_PER_MIN: "30",
  // stab-p9: neutrale Defaults (= config.js-Fallback), sonst leakt eine lokale .env mit
  // TELNYX_DEAD_AIR_TIMEOUT_S/TELNYX_LOOP_GUARD_MAX_EMPTY_TURNS via dotenv in Spawn-Tests
  // -> Baseline-Drift (Lehre test-base-env-drift).
  TELNYX_DEAD_AIR_TIMEOUT_S: "45",
  TELNYX_OPENING_SPEAK_TIMEOUT_S: "45",
  TELNYX_LOOP_GUARD_MAX_EMPTY_TURNS: "8",
  // Shim-Auth (E2/E3) neutral leer, sonst leakt eine lokale .env via dotenv in Spawn-Tests
  // -> Baseline-Drift (Lehre test-base-env-drift). Flag-an-Spawn-Tests brauchen das Secret
  // fuer den Boot (TELNYX_ASSISTANT_BOOT_ENV traegt es explizit).
  TELNYX_SHIM_SHARED_SECRET: "",
  TELNYX_SHIM_API_KEY_REF: "",
  // OBS-FLAG neutral AUS, sonst leakt eine lokale .env mit TELNYX_SHIM_DEBUG_SHAPE=true
  // via dotenv in Spawn-Tests -> Baseline-Drift (Lehre test-base-env-drift).
  TELNYX_SHIM_DEBUG_SHAPE: "false",
  // AL-P7 neutral AUS (= config.js-Fallback), sonst leakt eine lokale .env mit
  // TELNYX_SHIM_TOKEN_STREAMING=true in Spawn-Tests (Lehre test-base-env-drift).
  TELNYX_SHIM_TOKEN_STREAMING: "false",
  // GQ-P1: Prod-Default (true) explizit gepinnt, sonst leakt eine lokale .env mit
  // TELNYX_SHIM_SUPERSEDE_EXTENDED_TURN=false in Spawn-Tests (Lehre test-base-env-drift).
  TELNYX_SHIM_SUPERSEDE_EXTENDED_TURN: "true",
  // GQ-P18: in Spawn-Tests neutral AUS (0). Nicht der Prod-Default: sonst leakte eine
  // lokale .env in die Spawn-Tests (Lehre test-base-env-drift), und ein Spawn-Test kann
  // die Sperre ohnehin nicht beobachten - sie braucht zwei gleichzeitige Requests desselben
  // Calls. Sie wird unit-nah gefahren (test/gq-p18-speech-gate.test.js, injizierte Timer).
  TELNYX_SHIM_EXTEND_HOLD_MS: "0",
  // GQ-P5: Prod-Default (true) explizit gepinnt, sonst leakt eine lokale .env mit
  // TELNYX_SHIM_IGNORE_PROVIDER_NUDGE=false in Spawn-Tests (Lehre test-base-env-drift).
  TELNYX_SHIM_IGNORE_PROVIDER_NUDGE: "true",
  // GQ-P6: Prod-Default (60) explizit gepinnt, sonst leakt eine lokale .env mit einem
  // abweichenden TELNYX_DIAL_TIMEOUT_SECS in Spawn-Tests (Lehre test-base-env-drift).
  TELNYX_DIAL_TIMEOUT_SECS: "60",
  // GQ-P3: Prod-Default (true) explizit gepinnt, sonst leakt eine lokale .env mit
  // TELNYX_INBOUND_HANDOFF_ENABLED=false via dotenv in Spawn-Tests (Lehre
  // test-base-env-drift). Wirkt ohnehin nur bei TELNYX_AI_ASSISTANT_ENABLED=true.
  TELNYX_INBOUND_HANDOFF_ENABLED: "true",
  // GQ-P4: neutral auf dem Code-Fallback gepinnt, sonst leakt eine lokale .env via dotenv
  // in die Spawn-Tests (Lehre test-base-env-drift).
  TELNYX_MAX_CONSECUTIVE_FAILED_TURNS: "3",
  TELNYX_FAILED_TURN_FAREWELL_TEXT: "",
  // ElevenLabs-TTS neutral aus (Gate = REF+VOICE_ID leer -> Azure-Bestand). Ohne
  // diese Zeilen leakt eine lokale .env in Spawn-Tests (Lehre test-base-env-drift).
  TELNYX_ELEVENLABS_API_KEY_REF: "",
  TELNYX_ELEVENLABS_VOICE_ID: "",
  TELNYX_ELEVENLABS_MODEL: "",
  // Play-TTS neutral aus (Gate = ELEVENLABS_PLAY_TTS_ENABLED=false -> Azure-Bestand).
  // Ohne diese Zeilen leakt eine lokale .env in Spawn-Tests (Lehre test-base-env-drift).
  ELEVENLABS_PLAY_TTS_ENABLED: "false",
  ELEVENLABS_API_KEY: "",
  ELEVENLABS_VOICE_ID: "",
  ELEVENLABS_MODEL: "",
  // NICHT "" - leer heisst "nicht gesetzt", und config.js faellt dann auf die ECHTE
  // Anbieter-Adresse zurueck. Gemessen: Spawn-Tests schickten damit bei jedem Lauf echte
  // GETs an api.elevenlabs.io (mit leerem Schluessel -> echtes 401), also eine Suite, die
  // vom Internet abhaengt und einen fremden Dienst belastet. Der Verwurf-Port 9 ist sofort
  // und offline nicht erreichbar; Tests mit eigenem Mock setzen die Basis ohnehin selbst.
  ELEVENLABS_API_BASE: "http://127.0.0.1:9",
  ELEVENLABS_OUTPUT_FORMAT: "",
  ELEVENLABS_SYNTH_TIMEOUT_MS: "2000",
  ELEVENLABS_TTS_TOKEN_TTL_MS: "60000",
  // ---- ElevenLabs-Outbound (der Zweig, der ECHTE Anrufe ausloest) ----
  // Diese fuenf fehlten und leakten damit aus der lokalen .env in jeden Spawn-Test
  // (Lehre test-base-env-drift, hier mit Geld- statt Konfigurationsfolge). Solange
  // ELEVENLABS_API_KEY oben "" ist, scheitert ein Anrufstart am 401 - aber diese
  // Sicherung ist die ZWEITE, nicht die erste: sobald jemand lokal
  // ELEVENLABS_OUTBOUND_ENABLED=true setzt (fuer einen echten Testanruf noetig),
  // liefe sonst die GANZE Suite mit aktivem Anruf-Zweig. Das Gate gehoert hierher.
  ELEVENLABS_OUTBOUND_ENABLED: "false",
  ELEVENLABS_AGENT_ID: "",
  ELEVENLABS_AGENT_PHONE_NUMBER_ID: "",
  // Test-Seam AUS wie beim Vorbild FAKE_ORIGINATE - einzelne Tests setzen ihn explizit.
  FAKE_ORIGINATE_ELEVENLABS: "false",
  // Produktionstakt (5000) laesst die Poll-Maschinerie in UNBETEILIGTE Spawn-Tests
  // hineinlaufen: deren Boot-Re-Arm pollt dann waehrend fremder Zusicherungen los.
  // Bewusst weit ueber jeder Testfrist - Tests, die den Poll messen, setzen ihn selbst.
  ELEVENLABS_RESULT_POLL_MS: "60000",
  // ---- Store-Backend + Onboarding/Provisioning ----
  // Neutral + fail-closed: json-Store, kein echter Nummern-Kauf. Tests, die das
  // brauchen (pg, Cap, echtes Provisioning), setzen es explizit per env-Override.
  STORE_BACKEND: "json",
  DATABASE_URL: "",
  // Queue-Backend neutral + fail-closed (In-Memory, deterministisch). Ohne diese
  // Zeile leakt eine lokale .env mit QUEUE_BACKEND=pgboss via dotenv in Spawn-Tests
  // -> Baseline-Drift (Lehre test-base-env-drift).
  QUEUE_BACKEND: "memory",
  MAX_NUMBERS: "5",
  MAX_NUMBERS_PER_TENANT: "1",
  PROVISIONING_ENABLED: "false",
  PROVISIONING_COUNTRY: "DE",
  PROVISIONING_REDRIVE_MAX_AGE_MS: "0",
  RELEASE_GRACE_DAYS: "0", // tenant-prolif-d: neutraler fail-closed Default (sonst leakt lokales .env in Spawn-Tests)
  // Kauf-Land-Override aus (Default): number.country = Herkunftsland, byte-identisch.
  // Ohne diese Zeile leakt eine lokale .env mit FORCE_NUMBER_COUNTRY=US via dotenv in
  // Spawn-Tests -> Baseline-Drift (Lehre test-base-env-drift).
  FORCE_NUMBER_COUNTRY: "",
  // Geo-Quelle bei der Registrierung aus (F1 Phase 6): Null-Adapter -> DE-Fallback,
  // netzfrei. Ohne diese Zeile leakt eine lokale .env mit GEO_ENABLED=true via dotenv
  // in Spawn-Tests -> Baseline-Drift (Lehre test-base-env-drift).
  GEO_ENABLED: "false",
  GEO_DB_PATH: "",
  // Review-Fix (Runde 1, P10-Blocker "ENTSCHAERFT (1)"): Weltdefault-Flip-Schalter neutral
  // AN (Code-/Test-Default, byte-identisch zur Bestandssuite vor diesem Fix). Ohne diese
  // Zeile leakt eine lokale .env mit WORLD_DEFAULT_LANGUAGE_ENABLED=false via dotenv in
  // Spawn-Tests -> Baseline-Drift (Lehre test-base-env-drift). Der eigene Switch-Test
  // (test/p10-world-default-language-switch.test.js) setzt "false" gezielt.
  WORLD_DEFAULT_LANGUAGE_ENABLED: "true",
  // Multi-Tenant default AUS: Bestandssuite laeuft byte-identisch im Owner-Pfad.
  // Ohne diesen Eintrag wuerde eine lokale .env mit MULTI_TENANT=true via dotenv
  // in Spawn-Tests lecken -> Baseline-Drift (Lehre test-base-env-drift).
  MULTI_TENANT: "false",
  // Self-Service default AUS (fail-closed): Bestandssuite byte-identisch. Ohne diese
  // Zeile leakt eine lokale .env mit SELF_SERVICE_ENABLED=true via dotenv in
  // Spawn-Tests -> Baseline-Drift (Lehre test-base-env-drift).
  SELF_SERVICE_ENABLED: "false",
  // Single-Origin (P1) default AUS: ohne unified Build serviert der Gateway byte-
  // identisch (nur public/). Ohne diese Zeilen leakt eine lokale .env mit WEB_DIST_DIR/
  // DEV_LOGIN_ENABLED via dotenv in Spawn-Tests -> Baseline-Drift (test-base-env-drift).
  // Tests, die das unified Serving / den Dev-Login pruefen, setzen sie explizit.
  WEB_DIST_DIR: "",
  DEV_LOGIN_ENABLED: "false",
  // Rich-UI default AUS (fail-closed): Bestandssuite byte-identisch (nur Text/
  // structuredContent). Ohne diese Zeile leakt eine lokale .env mit MCP_UI_ENABLED=true
  // via dotenv in Spawn-Tests -> Baseline-Drift (Lehre test-base-env-drift).
  MCP_UI_ENABLED: "false",
  // Per-Call-Kontext (PLAN-PERSONAL-ASSISTANT P3) default AUS (fail-closed): Bestandssuite
  // byte-identisch (context ignoriert). Ohne diese Zeile leakt eine lokale .env mit
  // ASSISTANT_CONTEXT_ENABLED=true via dotenv in Spawn-Tests -> Baseline-Drift
  // (Lehre test-base-env-drift). Der Smoke-/HTTP-Test setzt sie explizit auf "true".
  ASSISTANT_CONTEXT_ENABLED: "false",
  // P8 Pre-Call-Briefing default AUS (fail-closed): Bestandssuite byte-identisch (kein
  // zweiter LLM-Aufruf im place_call-Pfad). Ohne diese Zeilen leakt eine lokale .env via
  // dotenv in Spawn-Tests -> Baseline-Drift (Lehre test-base-env-drift). Die P8-Tests
  // setzen sie explizit.
  PRECALL_BRIEFING_ENABLED: "false",
  PRECALL_BRIEFING_MODEL: "claude-sonnet-5",
  PRECALL_BRIEFING_TIMEOUT_MS: "6000",
  // FIX-1: eigener Timeout der Zusammenfassung, auf den ausgelieferten Wert gepinnt -
  // sonst leakt eine lokale .env via dotenv in Spawn-Tests (Lehre test-base-env-drift).
  // Unkritisch fuer die Laufzeit der Suite: jeder Spawn-Test, der summarizeCall wirklich
  // ausloest, lenkt den Anbieter per ANTHROPIC_BASE_URL auf einen sofort antwortenden
  // Mock (test/_outbound-harness.js); ohne Mock antwortet der echte Endpunkt mit 401 -
  // nicht-transient, also ohne Retry und ohne Wartezeit.
  CALL_SUMMARY_TIMEOUT_MS: "20000",
  // AL-P10: Vorab-Recherche in Spawn-Tests neutral AUS + Gebuehr auf den Code-Default
  // gepinnt. Ohne diese Zeilen leckt eine lokale .env via dotenv in die Spawn-Tests
  // (Lehre test-base-env-drift).
  RESEARCH_ENABLED: "false",
  RESEARCH_SEARCH_FEE_CENTS: "1",
  // AL-P10b: Nachschlagen IM Gespraech in Spawn-Tests neutral AUS + Gebuehr/Anbieter auf
  // die Code-Defaults gepinnt. Seit AL-P10c ist EXA_API_KEY die config-Variable des
  // Anbieters - ohne diese Zeilen leckt eine lokale .env via dotenv in die Spawn-Tests
  // (Lehre test-base-env-drift); al-p10b-lookup.test.js setzt sie explizit.
  LOOKUP_ENABLED: "false",
  LOOKUP_SEARCH_FEE_CENTS: "1",
  EXA_API_KEY: "",
  // Thema A (2026-08-19): die LLM-Vorab-Erzeugung der Eroeffnungszeile auf den
  // Code-Default gepinnt (Lehre test-base-env-drift). In Spawn-Tests laeuft der Versuch
  // gegen den (nicht erreichbaren bzw. per ANTHROPIC_BASE_URL umgelenkten) Anbieter,
  // scheitert nicht-transient und faellt fail-closed auf die Auftrags-Bruecke - genau
  // dieser Rueckfall wird in elevenlabs-anrufstart.test.js (T11) am Draht gemessen.
  ELEVENLABS_OPENING_LINE_LLM_ENABLED: "true",
  EXA_API_BASE: "",
  // AL-P13: Consult-Kanal in Spawn-Tests neutral AUS (Default). Ohne diese Zeile leakt
  // eine lokale .env via dotenv in die Spawn-Tests (Lehre test-base-env-drift);
  // al-p13-consult-channel.test.js setzt es explizit auf "true".
  CONSULT_ENABLED: "false",
  // AL-P14: Rueckfrage IM Gespraech in Spawn-Tests neutral AUS (Default). Ohne diese Zeile
  // leakt eine lokale .env via dotenv in die Spawn-Tests (Lehre test-base-env-drift);
  // al-p14-in-call-consult.test.js setzt es explizit auf "true".
  IN_CALL_CONSULT_ENABLED: "false",
  // GQ-P2: die zwei Consult-Fristen neutral gepinnt, sonst leakt eine lokale .env via
  // dotenv in die Spawn-Tests (Lehre test-base-env-drift).
  CONSULT_WAIT_MS: "4000",
  CONSULT_OPEN_MS: "47000",
  // AL-P7b: Denk-Signal in Spawn-Tests neutral AUS (Default). Ohne diese Zeile leakt eine
  // lokale .env via dotenv in die Spawn-Tests (Lehre test-base-env-drift);
  // al-p7b-*.test.js setzen es explizit auf "true".
  THINKING_SIGNAL_ENABLED: "false",
  // WW-F2: Nachfassen in Spawn-Tests neutral AUS (Default). Ohne diese Zeile leakt eine
  // lokale .env via dotenv in die Spawn-Tests (Lehre test-base-env-drift);
  // ww-f2-tool-follow-up.test.js setzt es explizit auf "true".
  TOOL_FOLLOW_UP_ENABLED: "false",
  // ---- Payment/Billing (P6b1) ----
  // Neutral + fail-closed: kein Hold/Capture. Ohne diese Zeilen leakt eine lokale
  // .env mit PAYMENT_ENABLED=true via dotenv in Spawn-Tests -> Baseline-Drift.
  PAYMENT_ENABLED: "false",
  STRIPE_SECRET_KEY: "",
  STRIPE_API_BASE: "",
  NUMBER_SETUP_FEE_CENTS: "0",
  // KV-P0: Flush-Stichtag neutral LEER = fail-closed (nichts wird gemeldet). Ohne diese
  // Zeile leakt eine lokale .env mit gesetztem BILLING_FLUSH_EPOCH via dotenv in die
  // Spawn-Tests (Lehre test-base-env-drift) - die Suite misst dann einen scharfen Flush,
  // waehrend sie den gesperrten behauptet.
  BILLING_FLUSH_EPOCH: "",
  PAYMENT_CURRENCY: "eur",
  // Provider-Waehrung explizit (Lehre test-base-env-drift): ohne diese Zeile leakt eine
  // lokale .env mit PROVIDER_CURRENCY via dotenv in die Spawn-Tests.
  PROVIDER_CURRENCY: "USD",
  // LCT P2: Kurs explizit im Band (Lehre test-base-env-drift). Ohne diese Zeile leakt eine
  // lokale .env via dotenv in die Spawn-Tests und erzeugte dort eine fremde Boot-WARN.
  // Seit GAP-08 (P2) speist dieselbe Zeile auch die KI-Kosten-Achse (config.llm.usdToEur).
  PROVIDER_TO_BUCKET_RATE_MICRO: "920000",
  // LCT P3: Kosten-Abgleich explizit auf den Code-Defaults gepinnt (Lehre
  // test-base-env-drift). Ohne diese Zeilen faerbte eine lokale .env die Spawn-Suite.
  // Der Sweep laeuft ohnehin nur per Intervall (KE-P6B: 1 h, unref) - in einem Spawn-Test
  // feuert er nie; die P3-Tests rufen die Fabrik direkt und in-process auf.
  COST_TRUING_DELAY_MINUTES: "30",
  COST_TRUING_SWEEP_INTERVAL_MS: "3600000",
  COST_TRUING_MAX_ATTEMPTS: "5",
  // Nicht-leer, weil der Pflicht-Mengen-Riegel seit P8 unkonditional prueft (die
  // Korrekturbuchung ist bedingungslos aktiv); leer -> Boot-Refusal (das prueft (n1)
  // mit lokalem Override).
  COST_TRUING_REQUIRED_RECORD_TYPES: "sip-trunking,call-control",
  COST_TRUING_MIN_COVERAGE_PERCENT: "80",
  COST_TRUING_COVERAGE_STALL_SWEEPS: "8",
  COST_DRIFT_WARN_PERCENT: "50",
  COST_ALERT_DEBOUNCE_MS: "86400000",
  // LCT P5 (Drift-Waechter): auf den Code-Default gepinnt (Lehre test-base-env-drift).
  COST_CALIBRATION_MIN_SAMPLES: "20",
  // W4: Abo-Env neutral leer (fail-closed): ohne diese Zeilen leakt eine lokale .env mit
  // STRIPE_*_PRICE_ID / STRIPE_WEBHOOK_SECRET via dotenv in Spawn-Tests -> Baseline-Drift
  // (Lehre test-base-env-drift). PAYMENT_ENABLED=false -> der Webhook-Secret-Boot-Check greift nicht.
  STRIPE_STARTER_PRICE_ID: "",
  STRIPE_BUSINESS_PRICE_ID: "",
  STRIPE_WEBHOOK_SECRET: "",
  // outbound-p1c: Kosten-Achse neutral auf 0 (sonst leakt eine lokale .env via dotenv in
  // Spawn-Tests). Tarif 0 -> Reservierung feuert nie + Reconcile/Meter buchen 0 (byte-
  // identisch zum frueheren VOICE_MINUTE_COST_CENTS=0); Default-Budget 0 -> kein Seed (Onboard
  // byte-identisch). Die outbound-p1c-Tests setzen die Werte explizit.
  VOICE_TARIFF_DOMESTIC_CENTS: "0",
  VOICE_TARIFF_DEFAULT_CENTS: "0",
  // KV-P2: Inbound-Kosten-Achse test-neutral auf 0 (wie die zwei Saetze darueber) - sonst
  // leakt eine lokale .env via dotenv in die Spawn-Tests (Lehre test-base-env-drift) und
  // faerbte jeden Bestands-Spawn mit Inbound-Call umgebungsabhaengig. Die KV-P2-Tests
  // setzen den Satz explizit.
  VOICE_TARIFF_INBOUND_CENTS: "0",
  // LCT P4b: Vollkosten-Boot-Guard test-neutral aus (Schwelle 0 => 0<0 false => still),
  // analog VOICE_TARIFF_DOMESTIC_CENTS=0. Die P4b-Tests setzen die Schwelle explizit.
  VOICE_TARIFF_FULL_COST_FLOOR_CENTS: "0",
  DEFAULT_TENANT_BUDGET_CENTS: "0",
  // P6 (Budget-Achsen, Fruehwarnung): neutral AUS (0 = kein Ereignis, byte-identisch
  // zum Bestand) - sonst leakt eine lokale .env via dotenv in Spawn-Tests (Lehre
  // test-base-env-drift). test/platform-spend-warning.test.js setzt den Wert explizit.
  PLATFORM_SPEND_WARN_PERCENT: "0",
  PLATFORM_ALERT_SMS_TO: "",
  // OUTBOUND-E3b: neutral gepinnt. PLATFORM_ALERT_MAIL_TO leer - ohne diese Zeile
  // wanderte eine echte Betreiber-Adresse aus der lokalen .env in jeden Spawn-Test
  // (Versand-Attrappe waere umgangen). Die Schwellen auf ihren Defaults, damit ein
  // lokaler Experimentierwert keine fremde Baseline verschiebt.
  PLATFORM_ALERT_MAIL_TO: "",
  // OUTAGE_ALERT_WINDOW_MS neutral AUS (0), NICHT der Produktions-Default (3600000, s.
  // .env.example/render.yaml): empirisch belegt (Lauf mit 3600000 als Baseline), dass
  // JEDER Spawn-Test, der ELEVENLABS_OUTBOUND_ENABLED="true" setzt (z.B.
  // elevenlabs-anrufstart.test.js, ohne jeden Bezug zum Ausfall-Melder), sonst die neue
  // FATALE Pruefung BOTH_UNSET_WITH_OUTBOUND ausloest (boot-guard.js#alertChannelFindings:
  // kein Kanal + Outbound scharf + Fenster>0) und der Boot fail-closed verweigert wird -
  // 0 haelt den Melder aus, bis ein Test ihn ausdruecklich scharf schaltet (Muster
  // PLATFORM_SPEND_WARN_PERCENT=0 oben).
  OUTAGE_ALERT_WINDOW_MS: "0",
  OUTAGE_ALERT_MIN_FAILURES: "3",
  OUTAGE_ALERT_MIN_ATTEMPTS: "20",
  OUTAGE_ALERT_FAIL_SHARE_PERCENT: "20",
  OUTAGE_ALERT_DEBOUNCE_MS: "21600000",
  OUTAGE_ALERT_RETRY_MS: "900000",
  // 0 = C8b-Selbsttest aus, bis ein Test ihn ausdruecklich scharf schaltet (Muster
  // OUTAGE_ALERT_WINDOW_MS oben).
  OUTAGE_ALERT_SELF_TEST_INTERVAL_MS: "0",
  // 0 = C8-HOLD-Eskalation aus (Muster OUTAGE_ALERT_WINDOW_MS oben) - sonst koennte ein
  // Spawn-Test mit einem laengst suspendierten Fixture-Tenant unbeabsichtigt eine
  // Betreiber-Meldung ausloesen, ohne jeden Bezug zu C8.
  PLATFORM_HOLD_ESCALATION_MAX_AGE_MS: "0",
  // P7 (Budget-Achsen, Der Flip): neutral AUS (Default, byte-identisch zum Bestand) - sonst
  // leakt eine lokale .env mit BUDGET_MONTH_ENABLED=true via dotenv in Spawn-Tests (Lehre
  // test-base-env-drift) und faerbt die Suite umgebungsabhaengig.
  BUDGET_MONTH_ENABLED: "false",
  // LCT P7 (Fixkosten sichtbar machen): warnPercent neutral AUS (0 = kein Ereignis, wie
  // PLATFORM_SPEND_WARN_PERCENT oben) - sonst leakt eine lokale .env via dotenv in
  // Spawn-Tests (Lehre test-base-env-drift). Quota/Anker/Fixkosten bleiben auf den
  // dokumentierten Code-Defaults (reine Anzeige, kein Gate liest sie - unkritisch fuer
  // Bestandstests). test/tts-quota-counter.test.js setzt die Achse direkt ueber die
  // Ops-Ebene, nicht ueber einen Spawn-Server.
  TTS_CHARACTER_QUOTA: "39981",
  TTS_CHARACTER_QUOTA_WARN_PERCENT: "0",
  TTS_QUOTA_CYCLE_ANCHOR_DAY: "3",
  PLATFORM_FIXED_COST_CENTS_PER_MONTH: "600",
  NUMBER_MONTHLY_COST_CENTS: "92",
  // outbound-p1d: per-(Tenant,Ziel)-Cap neutral HOCH (Gate feuert in Altbestand-Tests nie,
  // wie MAX_CALLS_PER_HOUR=100). Ohne diese Zeilen leakt eine lokale .env mit
  // PER_TARGET_CALL_CAP/PER_TARGET_WINDOW_MS via dotenv in Spawn-Tests -> Baseline-Drift
  // (Lehre test-base-env-drift). outbound-per-target-cap.test.js setzt den Cap explizit auf 3.
  PER_TARGET_CALL_CAP: "1000",
  PER_TARGET_WINDOW_MS: "86400000",
  // ---- MCP-Auth + OAuth + Hosting ----
  // Neutral; oauth.test.js / mcp-Tests setzen Issuer/Audience/Modus explizit.
  MCP_AUTH: "",
  OAUTH_ISSUER_URL: "",
  OAUTH_AUDIENCE: "",
  RENDER_EXTERNAL_URL: "",
};

// Erste nicht-interne IPv4-Adresse - Requests dorthin gelten serverseitig
// nicht als localhost (req.socket.remoteAddress != 127.0.0.1).
export function externalIp() {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs) {
      if (a.family === "IPv4" && !a.internal) return a.address;
    }
  }
  return null;
}

// rawStore (String, optional): schreibt den Inhalt VERBATIM als store.json - fuer
// Tests, die ein bewusst kaputtes/nicht-JSON-File am Boot brauchen (Korruptions-
// Pfad, T-P1-03). seedState geht weiter durch JSON.stringify (gueltiges JSON).
export function tempDataDir(seedState, rawStore) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-test-"));
  if (typeof rawStore === "string") fs.writeFileSync(path.join(dir, "store.json"), rawStore);
  else if (seedState)
    fs.writeFileSync(path.join(dir, "store.json"), JSON.stringify(seedState, null, 2));
  return dir;
}

// Minimal-vollstaendiger Store-Zustand zum Seeden einzelner Testfaelle. tenants
// und numbers haben bewusst KEINEN Default (undefined): ohne sie ist die Form
// byte-identisch zum Altbestand (Conditional-Spread unten), mit ihnen laesst sich
// ein aktiver Tenant samt eigener Nummer seeden (Inbound-Routing + Identitaet).
export function seedState({
  calls = [],
  actionItems = [],
  notifications = [],
  settings = {},
  profiles = {},
  tenants,
  numbers,
} = {}) {
  return {
    settings: {
      agentName: "Hermes",
      // P11: der reale Produkt-Default (DEFAULT_GREETING, store/defaults.js), NICHT ein
      // handgeschriebener Kurztext - sonst erkennt greetingForLanguage (PROMPT-03) den
      // Seed-Default nicht als Katalog-Vorlage und behandelt ihn faelschlich wie
      // Admin-Freitext. Kein Bestandstest pinnt den frueheren Kurztext (geprueft).
      greeting: DEFAULT_GREETING,
      allowCalendar: true,
      allowBooking: true,
      allowSummaries: true,
      allowPersonalData: false,
      allowBankData: false,
      allowResearch: false,
      // AL-P12: explizit statt implizit ueber migrateSettingsToMap (Bestand),
      // verhaltensneutral - der Wert ist bereits der defaultSettings()-Default.
      allowCallMemory: false,
      ...settings,
    },
    calls,
    actionItems,
    calendar: [],
    usage: { inputTokens: 0, outputTokens: 0, costEur: 0, calls: calls.length },
    notifications,
    profiles,
    ...(tenants ? { tenants } : {}),
    ...(numbers ? { numbers } : {}),
  };
}

// Stellt einen telefonbaren Owner-Tenant im Spawn-Store sicher: aktive Owner-Nummer
// (Boot-Guard-Bedingung) UND Owner-Identitaet im Store (ownerName/firstName), seit P2b
// keine config-derived Seeds mehr greifen. ownerNumber === null -> bewusster Opt-out
// (Boot-Guard-Test, kaputter Store). {e164, provider} -> spezifische Owner-Nummer (z.B.
// Telnyx fuer Provider-Tests). Idempotent: eine vorhandene aktive Owner-Nummer bzw. ein
// bereits gesetzter ownerName bleiben unangetastet (explizite Test-Seeds gewinnen).
function ensureOwnerNumber(seed, ownerNumber = OWNER_TEST_NUMBER) {
  if (ownerNumber === null) return seed;
  // Ohne expliziten Seed den VOLLEN Default-Store (wie First-Boot, inkl. aller
  // Listen wie numberAssignments/provisioningJobs) als Basis - nicht das flache
  // seedState() (dem diese Listen fehlen). Gegebene Seeds bleiben unangetastet.
  const state = seed || makeDefaultState();
  const numbers = Array.isArray(state.numbers) ? [...state.numbers] : [];
  const hasOwnerActive = numbers.some(
    (n) => n.tenantId === BOOTSTRAP_TENANT_ID && n.status === "active",
  );
  if (!hasOwnerActive) {
    numbers.push({
      id: "num_owner_seed",
      e164: ownerNumber.e164,
      tenantId: BOOTSTRAP_TENANT_ID,
      provider: ownerNumber.provider,
      status: "active",
      providerNumberId: null,
    });
  }
  return { ...state, tenants: ensureOwnerIdentity(state.tenants), numbers };
}

// Owner-Tenant mit Identitaet im Spiegel sicherstellen (P2b: ownerName lebt im Store).
// Fehlt der Owner-Tenant -> anlegen; fehlt nur sein ownerName -> setzen. Ein bereits
// gesetzter ownerName bleibt unangetastet (explizite Test-Seeds gewinnen, idempotent).
function ensureOwnerIdentity(tenants) {
  const list = Array.isArray(tenants) ? [...tenants] : [];
  const owner = list.find((t) => t.id === BOOTSTRAP_TENANT_ID);
  const identity = {
    status: "active",
    firstName: OWNER_TEST_FIRST_NAME,
    ownerName: OWNER_TEST_NAME,
  };
  if (!owner) {
    list.push({ id: BOOTSTRAP_TENANT_ID, ...identity });
  } else if (!owner.ownerName) {
    Object.assign(owner, identity, { status: owner.status });
  }
  return list;
}

export function seedCall(overrides = {}) {
  return {
    id: "call_test1",
    // tenantId wie createCall (state-ops): Default = Owner-Tenant. P2b haengt die
    // Offenlegung an tenant.ownerName (kein config.ownerName-Fallback mehr) -> ein
    // Call OHNE tenantId fiele sonst auf einen leeren Owner-Namen zurueck.
    tenantId: BOOTSTRAP_TENANT_ID,
    twilioSid: null,
    direction: "outbound",
    from: "+15005550006",
    to: "+4915112345678",
    goal: "Testziel",
    briefing: null,
    constraints: null,
    callerName: null,
    language: "de",
    maxDurationS: 60,
    status: "active",
    startedAt: new Date().toISOString(),
    answeredAt: null,
    endedAt: null,
    transcript: [],
    summary: null,
    objectiveAchieved: null,
    actionItemIds: [],
    ...overrides,
  };
}

// LCT P4/P4b (G5): geteilter Seed fuer die Deckungsquote-Boot-Beweise. EINE Quelle statt
// der frueher in cost-truing-booking-guard.test.js (fiveCallsSeed) und voice-tariff-full-
// cost-guard.test.js (tenCallsSeed) je kopierten Bauer. Ein beendeter Outbound-Call traegt
// costTruedSource; costTruingCoveragePercent liest NUR den Anteil 'telnyx_detail_records'.
// KV-M3: zusaetzlich beantwortet UND mit buchbarer Schaetzung - ohne beides waere JEDER
// Call dieser Fabrik strukturell 'nie_beantwortet'/'ohne_schaetzung' und damit IMMER
// ausserhalb des (jetzt engeren) Nenners, unabhaengig vom uebergebenen costTruedSource.
function outboundEndedCall(id, costTruedSource) {
  return seedCall({
    id,
    direction: "outbound",
    answeredAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    estimatedCostCents: 20,
    costTruedSource,
  });
}

// count beendete Outbound-Calls, davon die ersten `proven` als bewiesen
// ('telnyx_detail_records'), der Rest 'unavailable'. `prefix` haelt die IDs je Aufrufer
// eindeutig (call_p_ im P4-Test, call_q_ im P4b-Test).
export function outboundCallsSeed(count, proven, prefix) {
  const calls = [];
  for (let i = 0; i < count; i++) {
    calls.push(outboundEndedCall(`${prefix}${i}`, i < proven ? "telnyx_detail_records" : "unavailable"));
  }
  return seedState({ calls });
}

// Wartet, bis das stdout des Kindprozesses auf das Pattern matcht - die
// HTTP-Antwort kommt oft an, BEVOR die Log-Pipe beim Parent eingetroffen ist.
export async function waitForLog(srv, regex, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (!regex.test(srv.stdout)) {
    if (Date.now() > deadline)
      throw new Error(`Log-Pattern ${regex} nicht gefunden in:\n${srv.stdout}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

// Pinnt: es existiert kein Basic-Auth-Gate mehr (AUTH-P7, geteilt zwischen
// auth-p3-bootstrap-fallback.test.js und auth-p5-internal-only.test.js - EINE Quelle
// statt zweier Kopien, S2). Vor AUTH-P7 liess BASE_ENV.DASHBOARD_PASSWORD="" das Gate
// mit `if (!config.auth.dashboardPassword) return next();` sofort durchreichen; seit
// AUTH-P7 gibt es diese Zeile im Code nicht mehr - kein 401, kein www-authenticate-
// Header, aus keinem Pfad mehr. Ein 403/404 in einem Test, der dies NICHT prueft,
// koennte theoretisch auch von einem wiederauferstandenen Gate kommen (falsch positiv
// gemessen); das ist der Wiederauferstehungs-Detektor.
export function assertGateAbsent(res) {
  assert.notEqual(res.status, 401, "kein Gate mehr - 401 waere eine Wiederauferstehung");
  assert.equal(
    res.headers.get("www-authenticate"),
    null,
    "kein www-authenticate -> kein Gate mehr davor",
  );
}

// Wartet, bis der auf Platte persistierte Store ein Praedikat erfuellt (G5: geteilt von
// max-duration-rearm.test.js + max-duration-live-cap.test.js). Fuer Terminalisierungs-
// Pfade noetig, die ASYNC laufen (setCallEndedAt + finishCall + save) - waitForLog deckt
// nur stdout ab, nicht den Store-Zustand selbst.
export async function waitForStoreState(srv, predicate, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate(srv.readStore())) {
    if (Date.now() > deadline)
      throw new Error(`Store-Zustand nicht erreicht:\n${JSON.stringify(srv.readStore().calls)}`);
    await new Promise((r) => setTimeout(r, 20));
  }
  return srv.readStore();
}

const WAIT_UNTIL_DEFAULT_TIMEOUT_MS = 500;
const WAIT_UNTIL_DEFAULT_POLL_INTERVAL_MS = 5;

// Wartet In-Process (kein Kindprozess, kein Store-Read von Platte) auf ein Praedikat -
// die In-Memory-Schwester von waitForLog/waitForStoreState oben, fuer Tests, die
// makeElevenLabsOutbound() direkt ohne Server aufrufen (G5: geteilt statt je Datei neu
// gebaut, Bestand vor OUTBOUND-E2: el-geldpfad-s1.test.js).
export async function waitUntil(
  predicate,
  { timeoutMs = WAIT_UNTIL_DEFAULT_TIMEOUT_MS, pollIntervalMs = WAIT_UNTIL_DEFAULT_POLL_INTERVAL_MS } = {},
) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Bedingung nicht innerhalb der Testfrist erreicht");
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

// Ersetzt globalThis.fetch fuer die Dauer von run() durch eine Anbieter-Attrappe und
// stellt das Original danach zuverlaessig wieder her (G5: geteilt statt je Datei neu
// gebaut, Bestand vor OUTBOUND-E2: el-geldpfad-s1.test.js).
export async function withFetch(fetchImpl, run) {
  const orig = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    return await run();
  } finally {
    globalThis.fetch = orig;
  }
}

// Die Store-Fassade, wie src/store/json.js sie baut: jede Methode reicht an denselben
// state-ops-Mutator durch, den auch Produktion benutzt - so rechnet voiceMinutesOf
// (billing/metering.js) gegen denselben Datensatz wie in Produktion, statt gegen ein
// Testobjekt mit Wunschfeldern (G5: geteilt statt je Datei neu gebaut, Bestand vor
// OUTBOUND-E2: el-geldpfad-s1.test.js). endCallRecord liefert hier den Call, nicht das
// {call, changed}-Paar, wie die echte Store-Fassade es tut.
export function storeOpsFacade(state) {
  return {
    load: () => state,
    getCall: (id) => stateOps.getCall(state, id),
    addTranscript: (id, rolle, text) => stateOps.addTranscript(state, id, rolle, text),
    recordProviderCallResult: (id, ergebnis) => stateOps.recordProviderCallResult(state, id, ergebnis),
    recordProviderCollectedFields: (id, felder) => stateOps.recordProviderCollectedFields(state, id, felder),
    recordCalleeConfirmedTimezone: (id, zone) => stateOps.recordCalleeConfirmedTimezone(state, id, zone),
    // Join-Schluessel zur Telefonie-Rechnung (persistProviderResult, s.
    // src/elevenlabs/outbound.js): hier ein No-op - nicht jeder Aufrufer haengt an ihm,
    // aber die Attrappe muss die Methode kennen, sonst wirft der Ergebnisweg einen
    // TypeError.
    recordSipCallId: () => {},
    trueUpAnsweredAt: (id, iso) => stateOps.trueUpAnsweredAt(state, id, iso),
    recordAnsweredUnclearReason: (id, grund) => stateOps.recordAnsweredUnclearReason(state, id, grund),
    // OUTBOUND-E2: finishFromConversation UND finishWithoutProviderResult rufen
    // recordFailureReason UNBEDINGT - ueber den echten Mutator, wie jede andere
    // Store-Methode hier (set-once + No-op bei null, s. state-ops.js).
    recordFailureReason: (id, grund) => stateOps.recordFailureReason(state, id, grund),
    setCallEndedAt: (id, status, iso) => stateOps.setCallEndedAt(state, id, status, iso),
    endCallRecord: (id, status) => stateOps.endCallRecord(state, id, status).call,
    // E2-S2-2 (Review-Blocker Runde 2): el-action-items.test.js baute vor dieser
    // Konsolidierung eine eigene Attrappe mit denselben drei Methoden - hier ergaenzt,
    // damit dieselbe Facade auch dort reicht statt einer zweiten Kopie.
    addActionItem: (id, text, typ) => stateOps.addActionItem(state, id, text, typ),
    callActionItems: (id) => stateOps.callActionItems(state, id),
    save: () => {},
  };
}

// Mock der Telnyx-PROVISIONING-API: routet nach Pfad (search/order/resolve/release).
// Liefert e164 +4915799990001. Geteilt von onboarding-route + onboarding-identity
// (G5: eine Definition statt zweier Kopien). Name explizit "...ProvisioningMock",
// um die Kollision mit dem lokalen Voice/Originate-Mock in onboarding-outbound.test.js
// (startTelnyxVoiceMock) aufzuloesen - zwei verschiedene Telnyx-APIs (TD-9).
export async function startTelnyxProvisioningMock() {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      requests.push({ method: req.method, path: req.url, body });
      res.setHeader("content-type", "application/json");
      if (req.url.startsWith("/v2/available_phone_numbers"))
        return res.end(JSON.stringify({ data: [{ phone_number: "+4915799990001" }] }));
      if (req.url === "/v2/number_orders")
        // id hier ist die Order-Sub-Resource-id (NICHT die phone_number-Ressourcen-id) -
        // der Adapter nutzt sie nicht mehr; die echte id liefert der resolve-GET unten.
        return res.end(
          JSON.stringify({
            data: { phone_numbers: [{ id: "ord_sub_1", phone_number: "+4915799990001" }] },
          }),
        );
      // resolveNumberId: GET /v2/phone_numbers?filter[phone_number]=... -> Ressourcen-id.
      if (req.url.startsWith("/v2/phone_numbers?"))
        return res.end(
          JSON.stringify({ data: [{ id: "num_ext_1", phone_number: "+4915799990001" }] }),
        );
      // release (DELETE /v2/phone_numbers/{id}) -> 200 ok
      res.end(JSON.stringify({ data: {} }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise((r) => server.close(r)),
  };
}

// OBS-2: console.log+warn fuer die Dauer eines async-Callbacks abfangen (orig sichern,
// ersetzen, im finally restaurieren - F.I.R.S.T., Reihenfolge-unabhaengig). Liefert die
// Zeilen. Eine Quelle (G5/S2) statt der zuvor in telnyx-call-control.test.js und
// telnyx-event-ingest-machine.test.js getrennt definierten Kopien.
export async function captureConsole(fn) {
  const lines = [];
  const origLog = console.log;
  const origWarn = console.warn;
  console.log = (...a) => lines.push(a.map(String).join(" "));
  console.warn = (...a) => lines.push(a.map(String).join(" "));
  try {
    await fn();
  } finally {
    console.log = origLog;
    console.warn = origWarn;
  }
  return lines;
}

// Fake-Billing-Adapter (P6b1): aufzeichnend + per-Override werfbar, analog dem
// Fake-Provisioner. Lebt in test/helpers.js (NICHT in src/) - reines Test-Double
// fuer provisionNumber. log haelt [methode, ...args] in Aufrufreihenfolge.
export function fakeBilling(overrides = {}) {
  const log = [];
  const base = {
    async placeHold(args) {
      log.push(["placeHold", args]);
      return { paymentIntentId: "pi_fake_1" };
    },
    async captureHold(id, amt) {
      log.push(["captureHold", id, amt]);
    },
    async cancelHold(id) {
      log.push(["cancelHold", id]);
    },
    async reportMeter(args) {
      log.push(["reportMeter", args]);
    }, // P6b3-Meter-Aufzeichner
  };
  return { log, ...base, ...overrides };
}

// Fake-Provisioner-Adapter: aufzeichnend (log) + per-Override werfbar (DIP) -
// reines Test-Double fuer provisionNumber/handleProvisionJob, kein Netz. Eine Quelle
// (G5/S2) statt der frueher in onboarding-service/billing-hold-capture/provisioning-
// worker dreifach kopierten Definition. log haelt die Schritte in Aufrufreihenfolge.
export function fakeProvisioner(overrides = {}) {
  const log = [];
  const orderCalls = []; // additiv: jeder orderNumber-Aufruf mit connectionId (AM5-Threading)
  const base = {
    async searchNumbers({ countryCode } = {}) {
      log.push(`search:${countryCode}`);
      return [{ e164: "+4915799990001" }];
    },
    async orderNumber({ e164, connectionId, idempotencyKey }) {
      // log-String UNVERAENDERT (Bestands-deepEquals gruen); orderCalls traegt zusaetzlich
      // die connectionId fuer die AM5-Threading-Pruefung (connection_id im Order-Body).
      log.push(`order:${e164}:${idempotencyKey}`);
      orderCalls.push({ e164, connectionId, idempotencyKey });
      return { e164, providerNumberId: "num_ext_1" };
    },
    async releaseNumber(id) {
      log.push(`release:${id}`);
    },
  };
  return { log, orderCalls, ...base, ...overrides };
}

// PA-18: fakeTelnyxShimConfig lebt jetzt in config-namespaces-helper.js (das config.js
// bereits legitim importiert) - ein config.js-Import HIER wuerde config.js schon beim
// Import von helpers.js auswerten, VOR dem env-Setup jeder aufrufenden Datei (s.
// config-namespaces-helper.js-Doku, test-base-env-drift). Re-Export bewusst UNTERLASSEN
// (kein zusaetzlicher Re-Export-Umweg, G5) - die vier Konsumenten importieren direkt.

// stab-p9: No-op-ConversationWatchdog fuer Bestandstests, die die Kosten-Notaus-Achse nicht
// pruefen - haelt sie byte-identisch (observeTurn NIE loopExceeded, arm/clear wirkungslos).
// Die stab-p9-Tests injizieren stattdessen den echten Watchdog bzw. einen Spy.
export function noopWatchdog() {
  return {
    arm() {},
    // MINOR-2-Fix: der Kontrakt von observeTurn traegt seit K0 zusaetzlich turnSeq (der
    // echte Watchdog erhoeht+liefert ihn bei jedem Aufruf) - das No-op-Double bildete das
    // nicht mehr ab. 0 ist ein neutraler Platzhalter (dieses Double zaehlt nicht wirklich),
    // klar von der 1-basierten Zaehlung des echten Watchdogs unterscheidbar.
    observeTurn: () => ({ loopExceeded: false, turnSeq: 0 }),
    // dead-air-speech: No-op = keine Sprech-Verlaengerung. Ohne diesen Eintrag wirft jeder
    // Shim-Test mit erfolgreichem Turn einen TypeError (der Shim meldet jede Antwort).
    noteAgentSpeech() {},
    clear() {},
    // afix-p3: No-op = kein Farewell-Hangup. Tests, die den realen Hangup pruefen, injizieren
    // den echten Watchdog (makeTestWatchdog, telnyx-shim-harness.js).
    scheduleFarewellHangup: () => ({ delayMs: 0 }),
  };
}

// afix-p1 (Review-Blocker Runde 2, G5): Fabrik fuer withConfig/withBlankedConfig, gebunden per
// Closure an EIN gegebenes config-Objekt - EINE Implementierung statt der frueher in
// telnyx-call-control.test.js und telnyx-event-ingest-machine.test.js fast wortgleich
// kopierten Save-Set-Restore-Logik. Nimmt configObj bewusst als Parameter der Fabrik entgegen
// statt config.js selbst zu importieren: manche Aufrufer muessen config ERST NACH dem Setzen
// von process.env dynamisch importieren (Muster telnyx-call-control.test.js: ein statischer
// Import hier wuerde diese Reihenfolge unterlaufen und eine lokale .env leaken lassen, siehe
// Lehre test-base-env-drift). Die zurueckgegebenen Funktionen bleiben bei <=3 Argumenten (F1),
// weil configObj per Closure gebunden ist statt bei jedem Aufruf mitgereicht zu werden.
// PA-20: nach dem Flip existiert keine flache config-Oberflaeche mehr. Der Helfer routet
// jeden flachen Override-Key ueber sein Namespace-Blatt (Getter+Setter auf denselben Slot).
// Der Flach->Namespace-Index wird EINMAL aus der uebergebenen Oberflaeche gebaut (13 enumerable
// Namespaces, je enumerable Blaetter) - KEIN statischer config.js-Import (test-base-env-drift).
export function makeConfigOverrides(configObj) {
  const namespaceOfKey = {};
  for (const namespace of Object.keys(configObj)) {
    for (const key of Object.keys(configObj[namespace])) namespaceOfKey[key] = namespace;
  }
  const readValue = (key) => configObj[namespaceOfKey[key]][key];
  const writeValue = (key, value) => {
    configObj[namespaceOfKey[key]][key] = value;
  };
  async function withConfig(key, value, fn) {
    const saved = readValue(key);
    writeValue(key, value);
    try {
      // pa20-fix1: Rueckgabewert von fn() durchreichen (bisher verworfen) - noetig fuer
      // makeStripeStub weiter unten, dessen Aufrufer teils `const result = await
      // withStripeStub(...)` schreiben. Rein additiv: kein Bestandsaufrufer liest den
      // Rueckgabewert von withConfig(), also byte-identisches Verhalten fuer sie.
      return await fn();
    } finally {
      writeValue(key, saved);
    }
  }
  function withBlankedConfig(key, fn) {
    return withConfig(key, "", fn);
  }
  // cc-p6-fix1 (Review-Blocker G5): Multi-Key-Variante fuer Faelle, die mehrere Felder
  // gleichzeitig ueberschreiben (z.B. ein Pflichtfeld-Bundle wie CONFIG_REQUIRED_OK).
  // Ersetzt die byte-identische Save-Set-Restore-Schleife, die zuvor in
  // config-boolenv.test.js, config-failclosed.test.js und config-payment-guard.test.js
  // dreifach als lokales `withConfig(overrides, fn)` kopiert war (Datei-Kommentar dort
  // verwies bereits explizit auf "Muster config-failclosed.test.js").
  function withConfigOverrides(overrides, fn) {
    const saved = {};
    for (const k of Object.keys(overrides)) saved[k] = readValue(k);
    for (const k of Object.keys(overrides)) writeValue(k, overrides[k]);
    try {
      return fn();
    } finally {
      for (const k of Object.keys(saved)) writeValue(k, saved[k]);
    }
  }
  return { withConfig, withBlankedConfig, withConfigOverrides };
}

// pa20-fix1 (Review-Blocker G5): Fabrik fuer withStripeStub, gebunden per Closure an EIN
// config-Objekt + EINEN Test-Secret-Key - ersetzt die in billing-stripe-idempotent-headers
// .test.js, stripe-cancel-hold-adapter.test.js und stripe-setup-checkout.test.js byte-
// identisch kopierte Save-Set-Restore-Logik (global.fetch + config.billing.stripeSecretKey/
// stripeApiBase). Baut auf withConfig() auf (dieselbe Namespace-Routing-Logik wie
// makeConfigOverrides), NIE api.stripe.com im Test. Reicht den Rueckgabewert von fn()
// durch, weil manche Aufrufer `const result = await withStripeStub(...)` schreiben.
const STRIPE_TEST_API_BASE = "https://api.stripe.test";
export function makeStripeStub(configObj, secret) {
  const { withConfig } = makeConfigOverrides(configObj);
  return function withStripeStub(impl, fn) {
    const originalFetch = global.fetch;
    global.fetch = impl;
    return withConfig("stripeSecretKey", secret, () =>
      withConfig("stripeApiBase", STRIPE_TEST_API_BASE, fn),
    ).finally(() => {
      global.fetch = originalFetch;
    });
  };
}

// cc-p6-fix1 (Review-Blocker G5): gemeinsame Pflichtfeld-Fixture fuer assertConfig()-Tests
// (config-boolenv.test.js, config-failclosed.test.js, config-payment-guard.test.js hatten
// sie zuvor byte-identisch bzw. mit leichten Abweichungen lokal kopiert). Deckt genau die
// Felder ab, die assertConfig() unabhaengig vom geprueften Aspekt verlangt; Aufrufer mit
// zusaetzlichen Anforderungen (z.B. PAYMENT_ENABLED-Pfad) spreaden + ueberschreiben lokal.
export const CONFIG_REQUIRED_OK = Object.freeze({
  anthropicApiKey: "x",
  publicUrl: "https://example.test",
  mcpAuth: "",
  storeBackend: "json",
  paymentEnabled: false,
});

// ---- Telnyx-Origination/-Inbound-Rohstoffe (Nummern/Header/Seed/POST-Helper) ----
// EINE Quelle (G5/S2) statt der frueher in telnyx-p5-origination + telnyx-p8-inbound +
// telnyx-p9-flag-matrix dreifach kopierten Konstanten und Helper-Funktionen.
// TELNYX_TEST_PEER_NUMBER spielt zwei Rollen (Outbound-Ziel UND Inbound-Anrufer-From) -
// beide Test-Dateien riefen bereits wortwoertlich dieselbe Nummer auf.
export const TELNYX_TEST_OWNER_NUMBER = Object.freeze({
  e164: "+4915005551234",
  provider: "telnyx",
});
export const TELNYX_TEST_PEER_NUMBER = "+4915112345678";
export const TELNYX_TEST_TENANT_NUMBER = "+4915255555555";
export const TELNYX_TEST_SIGNATURE_HEADERS = Object.freeze({
  "telnyx-signature-ed25519": "sig",
  "telnyx-timestamp": "1",
});

// Ed25519-Rohstoff fuer Telnyx-Inbound-Webhooks: Wegwerf-Schluesselpaar, der
// oeffentliche Teil in BEIDEN Formen, die der Adapter akzeptiert (base64-raw-32-Byte
// wie Telnyx ihn ausliefert, und PEM), plus der Signierer ueber `${ts}|${rawBody}`.
// EINE Quelle (G5/S2): zuvor in telnyx-signature.test.js und signature-dispatch.test.js
// kopiert; C-P3 braucht das Rezept ein drittes Mal (e2e ueber die HTTP-Route).
const ED25519_RAW_KEY_LEN = 32;
const MS_PER_S = 1000;

export const nowSeconds = () => Math.floor(Date.now() / MS_PER_S);

export function makeTelnyxSigner() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return {
    publicKeyBase64: publicKey
      .export({ format: "der", type: "spki" })
      .subarray(-ED25519_RAW_KEY_LEN)
      .toString("base64"),
    publicKeyPem: publicKey.export({ format: "pem", type: "spki" }).toString(),
    sign(ts, rawBody) {
      const signed = Buffer.concat([Buffer.from(`${ts}|`), Buffer.from(rawBody)]);
      return crypto.sign(null, signed, privateKey).toString("base64");
    },
  };
}

// P10: assertConfig verlangt bei aktivem TELNYX_AI_ASSISTANT_ENABLED-Flag zusaetzlich
// ASSISTANT_ID/API_KEY/CONNECTION_ID (fail-closed Boot) - Flag-an-Spawn-Tests brauchen
// die drei Werte oft NUR, damit der Server ueberhaupt startet, nicht fuer ihre
// eigentliche Aussage. EINE Quelle (G5/S2) statt der frueher in telnyx-p5-gate-proof +
// telnyx-p5-origination + telnyx-p8-inbound + telnyx-p9-flag-matrix + telnyx-shim-route
// fuenffach (teils voll, teils als 2-Key-Teilsatz) kopierten Fixture.
export const TELNYX_ASSISTANT_BOOT_ENV = Object.freeze({
  TELNYX_ASSISTANT_ID: "asst_x",
  TELNYX_API_KEY: "key_x",
  TELNYX_CONNECTION_ID: "conn_x",
  TELNYX_CALL_CONTROL_APP_ID: "ccapp_x",
  TELNYX_SHIM_SHARED_SECRET: "shim_secret_x",
});

// POST /api/calls (Outbound-Origination-Trigger). Liefert die rohe fetch-Response
// (Caller entscheidet, ob nur der Status oder auch der JSON-Body gebraucht wird).
export function placeCall(srv, to = TELNYX_TEST_PEER_NUMBER) {
  return fetch(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, objective: "Test" }),
  });
}

// POST /voice/incoming (Inbound-Webhook-Trigger). Setzt die Telnyx-Signatur-Header (der
// WERT ist belanglos, SKIP_TWILIO_SIGNATURE_CHECK ueberspringt die Krypto - die PRAESENZ
// waehlt den Provider). C-P3: der frueher vorhandene telnyx:false-Zweig (Twilio-Header)
// ist entfallen, es gibt keinen NICHT-Telnyx-Inbound-Pfad mehr.
// callSid: das Telnyx-TeXML-Feld, das die
// call_control_id des Inbound-Legs TRAEGT (GQ-P3, gemessen) - es gibt kein separates
// CallControlId-Feld mehr. callSid: null laesst das Feld WEG und erzeugt damit den
// Defektfall, gegen den der laute Rueckfall sichert. Liefert die rohe fetch-Response.
export function postTelnyxIncoming(
  srv,
  { callSid = "CAtest", from = TELNYX_TEST_PEER_NUMBER, to = TELNYX_TEST_TENANT_NUMBER } = {},
) {
  const body = { From: from, To: to };
  if (callSid) body.CallSid = callSid;
  return fetch(`${srv.localUrl}/voice/incoming`, {
    method: "POST",
    headers: TELNYX_TEST_SIGNATURE_HEADERS,
    body: new URLSearchParams(body),
  });
}

// Seedet EINE aktive Telnyx-Nummer (TELNYX_TEST_TENANT_NUMBER) am Owner-Tenant - Inbound-
// Routing (/voice/incoming) braucht eine passende aktive Nummer im Store, sonst greift das
// To-Routing nicht.
export function seedWithTelnyxNumber() {
  return seedState({
    tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: "Jonas" }],
    numbers: [
      {
        id: "num_telnyx",
        e164: TELNYX_TEST_TENANT_NUMBER,
        tenantId: BOOTSTRAP_TENANT_ID,
        provider: "telnyx",
        status: "active",
        providerNumberId: null,
      },
    ],
  });
}

// ---- OAuth-Mini-IdP (offline) fuer MCP_AUTH=oauth-Tests ----
// = PUBLIC_URL/mcp aus BASE_ENV (kanonische Audience).
export const MCP_AUDIENCE = "https://agent.test/mcp";
const KID = "test-key-1";

// Lokaler IdP: Metadata zeigt auf den JWKS-Endpunkt, JWKS enthaelt den
// oeffentlichen Schluessel. Liefert Issuer-URL + Signierer. metadataPath waehlt
// den Well-known-Pfad (WorkOS AuthKit nutzt oauth-authorization-server).
export async function startIdp({ metadataPath = "/.well-known/openid-configuration" } = {}) {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: KID, alg: "RS256", use: "sig" };

  const server = http.createServer((req, res) => {
    if (req.url === metadataPath) {
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify({ issuer, jwks_uri: `${issuer}/jwks` }));
    }
    if (req.url === "/jwks") {
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify({ keys: [jwk] }));
    }
    res.statusCode = 404;
    res.end("not found");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const issuer = `http://127.0.0.1:${server.address().port}`;

  // Zweiter Schluessel mit GLEICHER kid -> jose findet den Key, die Signatur
  // passt aber nicht: sauberer 401 ohne JWKS-Refetch.
  const wrong = await generateKeyPair("RS256");

  // noSubject: true laesst den sub-Claim ganz weg (fuer den Fail-closed-Test:
  // verifiziertes Token ohne email UND sub).
  const sign = (
    claims = {},
    { key = privateKey, exp = "5m", aud = MCP_AUDIENCE, iss = issuer, noSubject = false } = {},
  ) => {
    let jwt = new SignJWT({ ...claims })
      .setProtectedHeader({ alg: "RS256", kid: KID })
      .setIssuer(iss)
      .setAudience(aud)
      .setIssuedAt()
      .setExpirationTime(exp);
    if (!noSubject) jwt = jwt.setSubject(claims.sub || "user-1");
    return jwt.sign(key);
  };

  return {
    issuer,
    sign,
    wrongKey: wrong.privateKey,
    close: () => new Promise((r) => server.close(r)),
  };
}

// POST an /mcp (Streamable HTTP). Ohne body: initialize. Antwort kann SSE sein.
export function mcpPost(url, token, body = { jsonrpc: "2.0", id: 1, method: "initialize" }) {
  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

// JSON-RPC tools/call-Body fuer ein MCP-Tool (stateless: kein initialize noetig).
export const toolCall = (name, args = {}) => ({
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: { name, arguments: args },
});

// Liest das JSON-RPC-result aus einer /mcp tools/call-Antwort. Der stateless
// StreamableHTTP-Transport antwortet als SSE (text/event-stream): das result steht in
// der data:-Zeile (faellt auf rohes JSON zurueck, falls der Transport doch JSON liefert).
// EINE Quelle fuer Tests, die den Tool-HTTP-Body parsen (heute parst kein anderer Test ihn).
export async function readToolResult(res) {
  const body = await res.text();
  const trimmed = body.trim();
  const raw = trimmed.startsWith("{")
    ? trimmed
    : (body.split(/\r?\n/).find((l) => l.startsWith("data:")) || "").slice("data:".length).trim();
  if (!raw) throw new Error(`Keine JSON-RPC-Daten in der MCP-Antwort:\n${body}`);
  return JSON.parse(raw).result;
}

// Startet src/server.js und ERWARTET einen Boot-Refusal (Exit statt listen). Fuer
// die Fail-closed-Tests (OT-4): liefert { code, output, dataDir }. Wirft, wenn der
// Prozess NICHT innerhalb timeoutMs beendet (d.h. der Boot lief durch). Teilt
// BASE_ENV + tempDataDir mit startServer (G5: keine zweite Spawn-Definition).
export async function startServerExpectExit({
  env = {},
  seed,
  rawStore,
  ownerNumber,
  dataDir: reuseDataDir,
  timeoutMs = 8000,
} = {}) {
  // reuseDataDir (S1-4 Corrupt-Store-Test): laeuft auf einem vorbereiteten dataDir weiter (z.B.
  // korrupt + nicht-schreibbar), statt frisch zu seeden - mirror von startServer.
  const dataDir =
    reuseDataDir || tempDataDir(rawStore ? seed : ensureOwnerNumber(seed, ownerNumber), rawStore);
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, ...BASE_ENV, ...env, DATA_DIR: dataDir },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (d) => (output += d.toString()));
  child.stderr.on("data", (d) => (output += d.toString()));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Server ist NICHT beendet (Boot-Refusal erwartet). Output:\n${output}`));
    }, timeoutMs);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, output, dataDir });
    });
  });
}

// Startet src/server.js als Kindprozess und liefert Port, gesammeltes stdout
// und einen stop()-Handle. Wirft bei Startproblemen mit dem bisherigen Output.
export async function startServer({
  env = {},
  seed,
  rawStore,
  ownerNumber,
  dataDir: reuseDataDir,
} = {}) {
  // rawStore (Korruptions-Pfad) bleibt verbatim; sonst Owner-Nummer sicherstellen, sonst greift
  // der Boot-Guard (kein Owner-Outbound -> Exit). reuseDataDir (A6/F9-Restart-Tests) laeuft auf dem
  // Store EINES vorherigen Laufs weiter (Prozess-Neustart-Simulation) - kein frisches tempDataDir,
  // kein Seed-Overwrite; die auf Platte persistierte Owner-Nummer traegt den Boot-Guard.
  const dataDir =
    reuseDataDir || tempDataDir(rawStore ? seed : ensureOwnerNumber(seed, ownerNumber), rawStore);
  // NICHT "src/server.js" direkt: der Wrapper installiert einen Eltern-Waechter und startet dann
  // den unveraenderten Server. stop() unten raeumt zuverlaessig auf, aber nur auf dem GUTEN Pfad -
  // stirbt der Testrunner abnormal (Sitzungslimit, gestoppter Workflow, pkill), ueberlebt sein
  // Serverkind und wird an launchd durchgereicht. Am 29.08.2026 liefen so 19 verwaiste Server
  // gleichzeitig, drei ueber einen Tag; die Last daraus laesst fremde Tests am
  // STARTUP_TIMEOUT_MS scheitern. Begruendung und Messung: test/helpers/server-mit-
  // elternwaechter.mjs. startServerExpectExit behaelt bewusst den direkten Einstieg: die dortigen
  // Server sind auf 8 s befristet und ihre Ausgabe wird byte-genau geprueft.
  const child = spawn(process.execPath, ["test/helpers/server-mit-elternwaechter.mjs"], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, ...BASE_ENV, ...env, DATA_DIR: dataDir },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const output = { text: "" };
  child.stdout.on("data", (d) => (output.text += d.toString()));
  child.stderr.on("data", (d) => (output.text += d.toString()));

  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Server-Start Timeout. Output:\n${output.text}`)),
      STARTUP_TIMEOUT_MS,
    );
    const onData = (d) => {
      const m = output.text.match(/laeuft auf http:\/\/localhost:(\d+)/);
      if (m) {
        clearTimeout(timer);
        child.stdout.off("data", onData);
        resolve(parseInt(m[1], 10));
      }
    };
    child.stdout.on("data", onData);
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Server vorzeitig beendet (code ${code}). Output:\n${output.text}`));
    });
  });

  return {
    port,
    dataDir,
    child,
    localUrl: `http://127.0.0.1:${port}`,
    externalUrl: externalIp() ? `http://${externalIp()}:${port}` : null,
    get stdout() {
      return output.text;
    },
    readStore() {
      return JSON.parse(fs.readFileSync(path.join(dataDir, "store.json"), "utf8"));
    },
    async stop() {
      if (child.exitCode !== null) return;
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGTERM");
      await exited;
    },
  };
}

// Deutsche Signal-/Funktionswoerter, die in einem rein-englischen Kanal NICHT vorkommen
// duerfen (Muster WEB-05/E2E-02: "Guten Tag"/"Hallo"/"kann gerade nicht"/"Anruf").
// Liegt hier statt in e2e-06-en-purity-aggregate.test.js, weil der T3b-Waechter
// (test/p15-mcp-tool-descriptions-en.test.js) DIESELBE Liste prueft, statt sie zu
// duplizieren (G5). VERBOTEN aufzuweichen (PLAN-I18N-FIX P15/T4); der Wortlaut ist in
// test/p15-mcp-tool-descriptions-en.test.js zusaetzlich byte-gepinnt.
export const GERMAN_STOPWORDS =
  /Guten Tag|Hallo|kann gerade nicht|Anruf|Gegenseite|Bitte spaeter erneut|Nachricht|Ungueltige|Anmeldung fehlgeschlagen|Sitzung abgelaufen|Grund|Besitzer|Auftrag/;
