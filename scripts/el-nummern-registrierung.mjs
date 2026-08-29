#!/usr/bin/env node
// OUTBOUND-E5 (F3): Reparaturlauf fuer die ElevenLabs-Nummernregistrierung. Beantwortet
// "hat jede aktive Tenant-DID eine eigene Registrierung, deren phone_number mit ihr
// uebereinstimmt?" und legt sie im --anlegen-Modus nach - der Weg fuer BESTANDS-DIDs, die
// vor dieser Etappe angelegt wurden (Backfill-Plan, kein automatisches Massen-Anlegen beim
// Boot).
//
// FAIL-CLOSED wie check-outbound-drift.mjs: ungelesen wird nichts als gruen gemeldet.
// --pruefen (Default) ist NUR-LESEND (Store-Lesung + ElevenLabs GET /v1/convai/
// phone-numbers). --anlegen ist der EINZIGE Modus mit Schreibzugriff und verlangt
// zusaetzlich --ja-wirklich - eine vergessene, zu weit gefasste --anlegen-Ausfuehrung darf
// nicht versehentlich N Registrierungen anlegen.
//
// Aufruf: npm run elevenlabs:nummern [-- --pruefen|--anlegen [--ja-wirklich] [--nur=<numberId>]]
//
// BETRIEBLICHE VORAUSSETZUNG (docs/RUNBOOK-OUTBOUND.md): STORE_BACKEND=pg + DATABASE_URL +
// IP in der Prod-DB-Allowlist (Lehre prod-db-ip-allowlist: "SSL connection closed
// unexpectedly" heisst Firewall, nicht TLS). Der Store-Import haengt bewusst HINTER dem
// Schluessel-Check (dynamic import) - eine fehlende ElevenLabs-Konfiguration soll nicht
// erst nach einem (moeglicherweise scheiternden) DB-Verbindungsaufbau auffallen.
import { config } from "../src/config.js";
import { PROVIDER, NUMBER_STATUS } from "../src/store/defaults.js";
import { makeElSipRegistrar, fehlendeZugangsdaten } from "../src/elevenlabs/nummern-registrierung.js";
import { listPhoneNumbers } from "../src/elevenlabs/convai.js";
import { attachNumberRegistration } from "../src/store/state-ops.js";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LOG_PREFIX = "[elevenlabs-nummern]";
// process.argv[0]=node, [1]=Skriptpfad - die eigentlichen Argumente beginnen danach
// (Muster check-staged-suppressions.js CLI_ARGS_OFFSET).
const CLI_ARGS_OFFSET = 2;

function schluesselFehlt() {
  if (!config.voice.elevenLabsOutbound.apiKey) return "ELEVENLABS_API_KEY fehlt.";
  return null;
}

// Reine Argv-Auswertung (F1): --anlegen schaltet den Schreibmodus, --pruefen ist der
// Default (auch ohne Flag). --nur pinnt den Pilot-Modus auf EINE Nummer.
function modusAusArgv(argv) {
  return {
    anlegen: argv.includes("--anlegen"),
    jaWirklich: argv.includes("--ja-wirklich"),
    nur: argv.find((arg) => arg.startsWith("--nur="))?.slice("--nur=".length) || null,
  };
}

function aktiveTelnyxNummern(state, nurNumberId) {
  return state.numbers.filter(
    (number) =>
      number.status === NUMBER_STATUS.ACTIVE &&
      number.provider === PROVIDER.TELNYX &&
      (!nurNumberId || number.id === nurNumberId),
  );
}

// Waisen: Registrierungen beim Anbieter, deren phone_number KEINER aktiven DID gehoert
// UND die nicht die globale Rueckfall-Registrierung (el.agentPhoneNumberId) sind - die
// ist Betriebszustand (Bestandsschutz fuer Tenants ohne eigene Registrierung, s. Runbook
// V4), kein Muell. Reine Menge-Differenz - kein zweiter Netzzugriff (dieselbe Liste
// beantwortet beides).
//
// REVIEW-BLOCKER RUNDE 2 (RUNBOOK V3): waisen() bekommt IMMER ALLE aktiven DIDs, nicht die
// --nur-gefilterte Auswahl - sonst meldet der Pilot-Pruefmodus (--nur=<numberId>) die
// Registrierungen aller UEBRIGEN Tenants faelschlich als Waisen (die Menge-Differenz sah
// nur die eine gewaehlte DID als "aktiv").
function waisen(providerListe, alleAktivenNummern, rueckfallId) {
  const aktiveE164 = new Set(alleAktivenNummern.map((number) => number.e164));
  return providerListe.filter(
    (eintrag) => !aktiveE164.has(eintrag.phone_number) && eintrag.phone_number_id !== rueckfallId,
  );
}

// --pruefen: NUR-LESEND. Meldet je aktiver (ggf. --nur-gefilterter) DID, ob Store-Kennung
// UND Anbieter-Datensatz uebereinstimmen, plus die Waisen-Liste (IMMER ueber ALLE aktiven
// DIDs gebildet, s. waisen() oben - --nur filtert nur die Fortschritts-Zeilen je DID, nicht
// die Waisen-Pruefung). PII-arm: nur interne IDs und die letzten vier Ziffern haetten
// ohnehin keinen Mehrwert - hier wird gar keine Rufnummer geloggt.
export async function pruefen({ state, el, nurNumberId }) {
  const aktiveNummern = aktiveTelnyxNummern(state, nurNumberId);
  const alleAktivenNummern = nurNumberId ? aktiveTelnyxNummern(state, null) : aktiveNummern;
  const providerListe = await listPhoneNumbers({ fetchImpl: fetch, account: el });
  const providerByE164 = new Map(providerListe.map((eintrag) => [eintrag.phone_number, eintrag]));
  let ohneRegistrierung = 0;
  let abweichend = 0;
  for (const number of aktiveNummern) {
    const beimAnbieter = providerByE164.get(number.e164);
    if (!number.providerAgentPhoneNumberId) {
      ohneRegistrierung++;
      console.log(`${LOG_PREFIX} number=${number.id} OHNE Registrierung`);
    } else if (!beimAnbieter || beimAnbieter.phone_number_id !== number.providerAgentPhoneNumberId) {
      abweichend++;
      console.error(`${LOG_PREFIX} number=${number.id} Registrierung WEICHT AB oder fehlt beim Anbieter`);
    }
  }
  const waisenListe = waisen(providerListe, alleAktivenNummern, el.agentPhoneNumberId);
  for (const eintrag of waisenListe)
    console.error(`${LOG_PREFIX} WAISE beim Anbieter: phone_number_id=${eintrag.phone_number_id}`);
  console.log(
    `${LOG_PREFIX} ${ohneRegistrierung} von ${aktiveNummern.length} aktiven DIDs ohne Registrierung, ` +
      `${abweichend} abweichend, ${waisenListe.length} Waise(n) beim Anbieter.`,
  );
  return ohneRegistrierung === 0 && abweichend === 0 && waisenListe.length === 0 ? 0 : 1;
}

// --anlegen: der EINZIGE Schreibzugriff. NUR fuer DIDs ohne Kennung (Schloss #1 sitzt
// bereits in registrierungFehlt/ensureRegistration selbst); seriell, je Nummer eine
// Log-Zeile, kein Abbruch der Schleife bei einem einzelnen Fehlschlag (Muster
// registriereNummerFailSoft in onboarding.js). saveState wird AWAITED (Review-Blocker
// Runde 1, G26): auf STORE_BACKEND=pg (die dokumentierte Betriebsvoraussetzung dieses
// Skripts) ist save() asynchron - ein nicht awaiteter Aufruf liesse die kostenpflichtig
// angelegte Registrierung nie in der DB landen, waehrend das Skript trotzdem "angelegt"
// meldet (stilles Gruen genau im Datenverlust-Fall). attachNumberRegistration statt
// Direktzuweisung (G5): derselbe set-once-Mutator wie im Produktionspfad
// (onboarding.js#registriereNummerFailSoft), EINE Stelle schreibt das Feld.
// fetchImpl optional (Default global fetch, wie makeElSipRegistrar selbst) - IO-injiziert,
// damit anlegen() sich direkt gegen eine lokale Attrappe testen laesst (Muster
// nummern-registrierung.js), ohne den CLI-Entry (runCli/dynamic store-import) mitzuziehen.
export async function anlegen({ state, saveState, el, sipUser, sipPasswort, nurNumberId, fetchImpl }) {
  const registrar = makeElSipRegistrar({ el, sipUser, sipPasswort, ...(fetchImpl ? { fetchImpl } : {}) });
  const kandidaten = aktiveTelnyxNummern(state, nurNumberId).filter(
    (number) => !number.providerAgentPhoneNumberId,
  );
  let fehlgeschlagen = 0;
  for (const number of kandidaten) {
    try {
      const { phoneNumberId, angelegt } = await registrar.ensureRegistration({
        e164: number.e164,
        numberId: number.id,
      });
      attachNumberRegistration(state, number.id, phoneNumberId);
      await saveState();
      console.log(`${LOG_PREFIX} number=${number.id} angelegt=${angelegt}`);
    } catch (err) {
      fehlgeschlagen++;
      console.error(`${LOG_PREFIX} number=${number.id} FEHLGESCHLAGEN: ${err.message}`);
    }
  }
  console.log(`${LOG_PREFIX} ${kandidaten.length - fehlgeschlagen} von ${kandidaten.length} angelegt.`);
  return fehlgeschlagen === 0 ? 0 : 1;
}

async function runCli(argv) {
  const grundKey = schluesselFehlt();
  if (grundKey) {
    console.error(`${LOG_PREFIX} Fehler (fail-closed): ${grundKey} Ungelesen wird nichts als gruen gemeldet.`);
    return 1;
  }
  const modus = modusAusArgv(argv);
  if (modus.anlegen && !modus.jaWirklich) {
    console.error(`${LOG_PREFIX} Fehler (fail-closed): --anlegen verlangt zusaetzlich --ja-wirklich.`);
    return 1;
  }
  if (modus.anlegen && !config.voice.elevenLabsOutbound.numberRegistrationEnabled) {
    console.error(`${LOG_PREFIX} Fehler (fail-closed): ELEVENLABS_NUMBER_REGISTRATION_ENABLED ist nicht "true".`);
    return 1;
  }
  // E5-03 (G5-Fix, Review Runde 2): EINE Quelle fuer "welche Zugangsdaten sind fuer eine
  // Registrierung Pflicht?" - fehlendeZugangsdaten aus nummern-registrierung.js, dieselbe
  // Pruefung, die ensureRegistration ohnehin je Nummer durchsetzt. Vorher pruefte das
  // Skript hier eine eigene, kuerzere Liste (nur SIP-Zugang, OHNE agentId) - bei fehlender
  // ELEVENLABS_AGENT_ID meldete runCli faelschlich "alles gut" und baute die DB-Verbindung
  // erst auf, um dann je Nummer in den Wurf zu laufen.
  const el = config.voice.elevenLabsOutbound;
  const sipUser = config.telephony.telnyxSipTrunkUsername;
  const sipPasswort = config.telephony.telnyxSipTrunkPassword;
  const grundZugang = modus.anlegen ? fehlendeZugangsdaten({ el, sipUser, sipPasswort }) : null;
  if (grundZugang) {
    console.error(`${LOG_PREFIX} Fehler (fail-closed): ${grundZugang}`);
    return 1;
  }
  // Store-Import HINTER allen Konfig-Checks (s. Modul-Kopf) - dynamic import, kein
  // DB-Verbindungsaufbau, bevor die billigeren Pruefungen oben durchgelaufen sind.
  // store.js exportiert die Fassade als BENANNTE Einzelfunktionen (kein "store"-Objekt,
  // Muster server.js/claude.js/scripts/check-setup.js: "import * as store"). Der bisherige
  // Destrukturierungs-Import `({ store } = ...)` griff auf ein nicht existierendes Feld -
  // store blieb undefined, jeder Aufruf (--pruefen UND --anlegen) crashte fail-closed
  // erst spaeter mit "Cannot read properties of undefined (reading 'load')". Gefunden durch
  // den CLI-Spawn-Test dieser Runde (E5-01) - der komplette Einstieg war zuvor ungetestet.
  let store;
  try {
    store = await import("../src/store.js");
  } catch (err) {
    console.error(`${LOG_PREFIX} Fehler (fail-closed): Store nicht erreichbar: ${err.message}`);
    return 1;
  }
  const state = store.load();
  if (modus.anlegen)
    return anlegen({
      state,
      saveState: async () => {
        await store.save();
      },
      el,
      sipUser,
      sipPasswort,
      nurNumberId: modus.nur,
    });
  return pruefen({ state, el, nurNumberId: modus.nur });
}

const istHauptmodul = fileURLToPath(import.meta.url) === resolve(process.argv[1] || "");
if (istHauptmodul) {
  try {
    process.exit(await runCli(process.argv.slice(CLI_ARGS_OFFSET)));
  } catch (err) {
    console.error(`${LOG_PREFIX} Fehler (fail-closed): ${err.message}`);
    process.exit(1);
  }
}
