#!/usr/bin/env node
import { config } from "../src/config.js";
import { PROVIDER, NUMBER_STATUS } from "../src/store/defaults.js";
import {
  REGISTRIERUNG_KLASSE,
  fehlendeZugangsdaten,
  holeRegistrierungen,
  inventarSchnappschuss,
  inventarUrteil,
  makeElSipRegistrar,
  registrierungsKlasse,
} from "../src/elevenlabs/nummern-registrierung.js";
import { deletePhoneNumber, fetchPhoneNumber, listPhoneNumbers } from "../src/elevenlabs/convai.js";
import { attachNumberRegistration } from "../src/store/state-ops.js";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LOG_PREFIX = "[elevenlabs-nummern]";
const CLI_ARGS_OFFSET = 2;

function schluesselFehlt() {
  if (!config.voice.elevenLabsOutbound.apiKey) return "ELEVENLABS_API_KEY fehlt.";
  return null;
}

const SCHALTER = Object.freeze({
  PRUEFEN: "--pruefen",
  ANLEGEN: "--anlegen",
  JA_WIRKLICH: "--ja-wirklich",
  NUR: "--nur=",
  TRUNK_INVENTAR: "--trunk-inventar",
  REGISTRIERUNG_LOESCHEN: "--registrierung-loeschen",
  ID: "--id=",
});
const WERT_SCHALTER = Object.freeze([SCHALTER.NUR, SCHALTER.ID]);
const FLAG_SCHALTER = Object.freeze(
  Object.values(SCHALTER).filter((schalter) => !WERT_SCHALTER.includes(schalter)),
);
const REGISTRIERUNGS_ID_MUSTER = /^phnum_[a-z0-9]+$/;
const ANBIETER_NUMMER_PFAD = "/v1/convai/phone-numbers/";
const LISTEN_TRENNER = ", ";

function wertVon(argv, schalter) {
  return argv.find((arg) => arg.startsWith(schalter))?.slice(schalter.length) || null;
}

function modusAusArgv(argv) {
  return {
    anlegen: argv.includes(SCHALTER.ANLEGEN),
    jaWirklich: argv.includes(SCHALTER.JA_WIRKLICH),
    nur: wertVon(argv, SCHALTER.NUR),
    trunkInventar: argv.includes(SCHALTER.TRUNK_INVENTAR),
    registrierungLoeschen: argv.includes(SCHALTER.REGISTRIERUNG_LOESCHEN),
    id: wertVon(argv, SCHALTER.ID),
  };
}

function unbekannteArgumente(argv) {
  return argv.filter(
    (arg) => !FLAG_SCHALTER.includes(arg) && !WERT_SCHALTER.some((schalter) => arg.startsWith(schalter)),
  );
}

function modusKonflikt(modus) {
  return [modus.anlegen, modus.trunkInventar, modus.registrierungLoeschen].filter(Boolean).length > 1;
}

function aktiveTelnyxNummern(state, nurNumberId) {
  return state.numbers.filter(
    (number) =>
      number.status === NUMBER_STATUS.ACTIVE &&
      number.provider === PROVIDER.TELNYX &&
      (!nurNumberId || number.id === nurNumberId),
  );
}

function waisen(providerListe, alleAktivenNummern, rueckfallId) {
  const aktiveE164 = new Set(alleAktivenNummern.map((number) => number.e164));
  return providerListe.filter(
    (eintrag) => !aktiveE164.has(eintrag.phone_number) && eintrag.phone_number_id !== rueckfallId,
  );
}

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

const KLASSEN_TEXT = Object.freeze({
  [REGISTRIERUNG_KLASSE.OFFEN]: "ROT (Inbound-Trunk ohne Zugangsdaten)",
  [REGISTRIERUNG_KLASSE.MIT_ZUGANG]: "Inbound mit Zugangsdaten",
  [REGISTRIERUNG_KLASSE.OHNE_INBOUND]: "ohne Inbound-Konfiguration (Annahme 'lehnt INVITE ab' UNBELEGT)",
});
const URTEIL_TEXT = Object.freeze({ GRUEN: "GRUEN", ROT: "ROT" });

function jaNein(wert) {
  return wert ? "ja" : "nein";
}

function meldeNachUrteil(gruen, zeile) {
  if (gruen) console.log(zeile);
  else console.error(zeile);
}

function urteilText(gruen) {
  return gruen ? URTEIL_TEXT.GRUEN : URTEIL_TEXT.ROT;
}

function meldeInventarZeile(schnappschuss) {
  const zeile =
    `${LOG_PREFIX} registrierung=${schnappschuss.id} label=${JSON.stringify(schnappschuss.label)} ` +
    `nummer=${schnappschuss.endung} inbound_trunk=${jaNein(schnappschuss.inboundTrunk)} ` +
    `zugangsdaten=${jaNein(schnappschuss.zugangsdaten)} ` +
    `allowed_numbers=[${schnappschuss.allowedNumbersEndungen.join(LISTEN_TRENNER)}] ` +
    `outbound_trunk=${jaNein(schnappschuss.outboundTrunk)} -> ${KLASSEN_TEXT[schnappschuss.klasse]}`;
  meldeNachUrteil(schnappschuss.klasse !== REGISTRIERUNG_KLASSE.OFFEN, zeile);
}

export async function trunkInventar({ el, fetchImpl = fetch }) {
  const registrierungen = await holeRegistrierungen({ fetchImpl, account: el });
  registrierungen.map(inventarSchnappschuss).forEach(meldeInventarZeile);
  const urteil = inventarUrteil(registrierungen);
  meldeNachUrteil(
    urteil.gruen,
    `${LOG_PREFIX} INVENTAR ${urteilText(urteil.gruen)} - ${registrierungen.length} Registrierungen, ` +
      `${urteil.offen.length} offen, ${urteil.mitZugang.length} mit Zugangsdaten, ` +
      `${urteil.ohneInbound.length} ohne Inbound-Konfiguration (Annahme unbelegt, kein Schutzbeleg)`,
  );
  return urteil.gruen ? 0 : 1;
}

async function leseRegistrierung({ el, id, fetchImpl }) {
  try {
    return await fetchPhoneNumber({ fetchImpl, account: el, phoneNumberId: id });
  } catch (err) {
    console.error(`${LOG_PREFIX} registrierung=${id} nicht lesbar (HTTP ${err.providerStatus ?? "unbekannt"})`);
    return null;
  }
}

async function loeschBeleg({ el, id, fetchImpl }) {
  const registrierungen = await holeRegistrierungen({ fetchImpl, account: el });
  const nochGelistet = registrierungen.some((registrierung) => registrierung.phone_number_id === id);
  const urteil = inventarUrteil(registrierungen);
  const erfolg = !nochGelistet && urteil.gruen;
  meldeNachUrteil(
    erfolg,
    `${LOG_PREFIX} LOESCH-BELEG ${urteilText(erfolg)} - id gelistet: ${jaNein(nochGelistet)}, ` +
      `Inventar: ${urteilText(urteil.gruen)}`,
  );
  return erfolg ? 0 : 1;
}

export async function registrierungLoeschen({ el, id, jaWirklich, fetchImpl = fetch }) {
  const registrierung = await leseRegistrierung({ el, id, fetchImpl });
  if (!registrierung) return 1;
  const klasse = registrierungsKlasse(registrierung);
  if (klasse !== REGISTRIERUNG_KLASSE.OFFEN) {
    console.error(
      `${LOG_PREFIX} registrierung=${id} VERWEIGERT: nur offene Inbound-Trunks ohne Zugangsdaten (Klasse ${klasse})`,
    );
    return 1;
  }
  if (!jaWirklich) {
    console.log(
      `${LOG_PREFIX} TROCKENLAUF - wuerde DELETE ${ANBIETER_NUMMER_PFAD}${id} senden; nichts gesendet. Zum Loeschen: ${SCHALTER.JA_WIRKLICH}`,
    );
    return 0;
  }
  const { status } = await deletePhoneNumber({ fetchImpl, account: el, phoneNumberId: id });
  console.log(`${LOG_PREFIX} registrierung=${id} DELETE gesendet, HTTP ${status ?? "unbekannt"} (nicht entscheidend)`);
  return await loeschBeleg({ el, id, fetchImpl });
}

function argumentFehler(meldung) {
  console.error(`${LOG_PREFIX} Fehler (fail-closed): ${meldung}`);
  return 1;
}

function laufeLoeschModus(modus) {
  if (!modus.id || !REGISTRIERUNGS_ID_MUSTER.test(modus.id)) {
    return argumentFehler(`${SCHALTER.REGISTRIERUNG_LOESCHEN} verlangt ${SCHALTER.ID}<phnum_...>.`);
  }
  return registrierungLoeschen({ el: config.voice.elevenLabsOutbound, id: modus.id, jaWirklich: modus.jaWirklich });
}

async function runCli(argv) {
  const grundKey = schluesselFehlt();
  if (grundKey) {
    console.error(`${LOG_PREFIX} Fehler (fail-closed): ${grundKey} Ungelesen wird nichts als gruen gemeldet.`);
    return 1;
  }
  const unbekannt = unbekannteArgumente(argv);
  if (unbekannt.length > 0) return argumentFehler(`unbekannte Argumente ${unbekannt.join(LISTEN_TRENNER)}.`);
  const modus = modusAusArgv(argv);
  if (modusKonflikt(modus)) {
    return argumentFehler(
      `${SCHALTER.ANLEGEN}, ${SCHALTER.TRUNK_INVENTAR} und ${SCHALTER.REGISTRIERUNG_LOESCHEN} schliessen sich aus.`,
    );
  }
  if (modus.trunkInventar) return trunkInventar({ el: config.voice.elevenLabsOutbound });
  if (modus.registrierungLoeschen) return laufeLoeschModus(modus);
  return laufeStoreModus(modus);
}

async function laufeStoreModus(modus) {
  if (modus.anlegen && !modus.jaWirklich) {
    console.error(`${LOG_PREFIX} Fehler (fail-closed): --anlegen verlangt zusaetzlich --ja-wirklich.`);
    return 1;
  }
  if (modus.anlegen && !config.voice.elevenLabsOutbound.numberRegistrationEnabled) {
    console.error(`${LOG_PREFIX} Fehler (fail-closed): ELEVENLABS_NUMBER_REGISTRATION_ENABLED ist nicht "true".`);
    return 1;
  }
  const el = config.voice.elevenLabsOutbound;
  const sipUser = config.telephony.telnyxSipTrunkUsername;
  const sipPasswort = config.telephony.telnyxSipTrunkPassword;
  const grundZugang = modus.anlegen ? fehlendeZugangsdaten({ el, sipUser, sipPasswort }) : null;
  if (grundZugang) {
    console.error(`${LOG_PREFIX} Fehler (fail-closed): ${grundZugang}`);
    return 1;
  }
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
