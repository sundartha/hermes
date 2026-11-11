import { anbieterMesser } from "./telemetrie.js";

const NANOSEKUNDEN_JE_MS = 1_000_000;
const HTTP_ZU_VIELE_ANFRAGEN = 429;
const TELNYX_DROSSEL_CODE = "10011";
const BREVO_DROSSEL_CODE = "http_429";
const FRIST_FEHLERNAME = "TimeoutError";

const ERGEBNIS = Object.freeze({
  OK: "ok",
  FEHLER: "fehler",
  ZEITUEBERSCHREITUNG: "zeitueberschreitung",
  DROSSELUNG: "429",
  KANALGRENZE: "kanalgrenze",
});

const ANBIETER = Object.freeze({
  telnyx: Object.freeze({
    vorgaenge: Object.freeze({
      originateCall: "anruf-starten",
      endCall: "anruf-beenden",
      endCallViaCallControl: "anruf-beenden-callcontrol",
      redirectCall: "anruf-umleiten",
      sendSms: "sms-senden",
      searchNumbers: "nummern-suchen",
      orderNumber: "nummer-kaufen",
      releaseNumber: "nummer-freigeben",
      findPhoneNumber: "nummer-nachschlagen",
    }),
    istDrosselung: (fehler) =>
      fehler.providerStatus === HTTP_ZU_VIELE_ANFRAGEN || fehler.providerCode === TELNYX_DROSSEL_CODE,
  }),
  brevo: Object.freeze({
    vorgaenge: Object.freeze({ sendMail: "mail-senden" }),
    istDrosselung: (fehler) => fehler.code === BREVO_DROSSEL_CODE,
  }),
  stripe: Object.freeze({
    vorgaenge: Object.freeze({
      createCustomer: "kunde-anlegen",
      createSetupCheckoutSession: "checkout-karte-anlegen",
    }),
    istDrosselung: (fehler) => fehler.providerStatus === HTTP_ZU_VIELE_ANFRAGEN,
  }),
  workos: Object.freeze({
    vorgaenge: Object.freeze({
      exchange: "anmeldung-tauschen",
      deleteUser: "nutzer-loeschen",
    }),
    istDrosselung: () => false,
  }),
});

function ergebnisVon(anbieter, fehler) {
  if (fehler?.name === FRIST_FEHLERNAME) return ERGEBNIS.ZEITUEBERSCHREITUNG;
  if (fehler && ANBIETER[anbieter].istDrosselung(fehler)) return ERGEBNIS.DROSSELUNG;
  return ERGEBNIS.FEHLER;
}

function erfasse(aufruf) {
  try {
    anbieterMesser.messeAnbieter(aufruf);
  } catch {
    console.warn(`[anbieter-messung] Erfassen fehlgeschlagen anbieter=${aufruf.anbieter} vorgang=${aufruf.vorgang}`);
  }
}

function gemessen({ anbieter, vorgang }, objekt, original) {
  return async function gemessenerAufruf(...argumente) {
    const beginn = process.hrtime.bigint();
    const dauerMs = () => Number(process.hrtime.bigint() - beginn) / NANOSEKUNDEN_JE_MS;
    let ergebnis;
    try {
      ergebnis = await original.apply(objekt, argumente);
    } catch (fehler) {
      erfasse({ anbieter, vorgang, ergebnis: ergebnisVon(anbieter, fehler), dauerMs: dauerMs() });
      throw fehler;
    }
    erfasse({ anbieter, vorgang, ergebnis: ERGEBNIS.OK, dauerMs: dauerMs() });
    return ergebnis;
  };
}

export function umhuelleAnbieter(anbieter, objekt) {
  const ersetzt = {};
  for (const [methode, vorgang] of Object.entries(ANBIETER[anbieter].vorgaenge)) {
    if (methode in objekt) ersetzt[methode] = gemessen({ anbieter, vorgang }, objekt, objekt[methode]);
  }
  return Object.assign(objekt, ersetzt);
}
