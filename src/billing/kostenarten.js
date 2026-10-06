export const WAEHRUNG_HART = Object.freeze(["USD", "EUR"]);

export const KOSTENART = Object.freeze({
  ELEVENLABS_CONVAI: "elevenlabs_convai",
  TELNYX_SIP: "telnyx_sip",
  TELNYX_CALL_RECORDS: "telnyx_call_records",
  AI_TOKEN: "ai_token",
  RESEARCH_FEE: "research_fee",
  SMS: "sms",
  EIGEN_TTS_ZEICHEN: "eigen_tts_zeichen",
  EL_GRUNDGEBUEHR: "el_grundgebuehr",
  EL_CREDIT_KONTINGENT: "el_credit_kontingent",
  DID_MIETE: "did_miete",
  NUMMERN_EINKAUF: "nummern_einkauf",
  STRIPE_GEBUEHR: "stripe_gebuehr",
  INFRASTRUKTUR: "infrastruktur",
  TELNYX_INFERENCE: "telnyx_inference",
  MAIL_ZUSAMMENFASSUNG: "mail_zusammenfassung",
  WORKOS_AUTH: "workos_auth",
});

export const KOSTENPROFIL = Object.freeze({
  EL_CONVAI_SIP: "el_convai_sip",
  TELNYX_BUDGET: "telnyx_budget",
  TELNYX_INBOUND_BUDGET: "telnyx_inbound_budget",
  TELNYX_INBOUND_EL_CONVAI: "telnyx_inbound_el_convai",
});

export const EINSAMMLER = Object.freeze({
  KV2_4: "KV2-4",
  KV2_5: "KV2-5",
  KV2_5G: "KV2-5g",
  NICHT_BELEGPFLICHTIG: "nicht_belegpflichtig",
});

const RICHTUNG_INBOUND = "inbound";

export const PFLICHTTYPEN_AUS_ENV = "aus_env_pflichtmenge";

export const PFLICHTTYPEN_UNGEMESSEN = Object.freeze([]);

function pruefeNichtLeererString(name, feld, wert) {
  if (typeof wert !== "string" || !wert.trim())
    throw new Error(`kostenarten: '${name}'.${feld} fehlt oder ist leer`);
}

function pruefeBelegtypen(name, belegtypen) {
  if (belegtypen === undefined) return;
  const gueltig =
    Array.isArray(belegtypen) &&
    belegtypen.length > 0 &&
    belegtypen.every((belegtyp) => typeof belegtyp === "string" && belegtyp.trim());
  if (!gueltig) throw new Error(`kostenarten: '${name}'.belegtypen ist kein nicht-leeres String-Array`);
}

export function pruefeKostenart(name, zeile) {
  pruefeNichtLeererString(name, "quelle", zeile.quelle);
  pruefeNichtLeererString(name, "waehrung", zeile.waehrung);
  pruefeNichtLeererString(name, "preisquelle", zeile.preisquelle);
  if (typeof zeile.pflicht !== "boolean")
    throw new Error(`kostenarten: '${name}'.pflicht fehlt oder ist kein Boolean`);
  if (zeile.pflicht === true && !WAEHRUNG_HART.includes(zeile.waehrung))
    throw new Error(
      `kostenarten: '${name}' ist belegpflichtig, traegt aber keine harte Waehrung (USD|EUR)`,
    );
  pruefeBelegtypen(name, zeile.belegtypen);
}

function pruefeTraegerEinsammler(profilName, traeger, eintrag) {
  if (!Object.hasOwn(KOSTENARTEN, traeger))
    throw new Error(`kostenarten: Profil '${profilName}' fuehrt Traeger '${traeger}' ohne Katalogzeile`);
  const einsammler = eintrag?.einsammler;
  if (typeof einsammler !== "string" || !Object.values(EINSAMMLER).includes(einsammler))
    throw new Error(
      `kostenarten: Profil '${profilName}', Traeger '${traeger}' - einsammler fehlt, ist leer oder ` +
        "ein freier dritter Wert (erlaubt: eine Phasenkennung dieser Kette oder 'nicht_belegpflichtig')",
    );
}

function pruefePflichttypen(name, pflichttypen) {
  if (pflichttypen === PFLICHTTYPEN_AUS_ENV) return;
  if (pflichttypen === PFLICHTTYPEN_UNGEMESSEN) return;
  const gueltig =
    Array.isArray(pflichttypen) &&
    Object.isFrozen(pflichttypen) &&
    pflichttypen.length > 0 &&
    pflichttypen.every((typ) => typeof typ === "string" && typ.trim());
  if (!gueltig)
    throw new Error(
      `kostenarten: Profil '${name}'.pflichttypen ist weder der Env-Marker noch die ` +
        "ausdrueckliche UNGEMESSEN-Menge noch ein eingefrorenes, nicht-leeres String-Array",
    );
}

export function pruefeProfil(name, profil) {
  if (typeof profil?.traeger !== "object" || profil.traeger === null || Array.isArray(profil.traeger))
    throw new Error(`kostenarten: Profil '${name}'.traeger ist kein Objekt`);
  const traegerNamen = Object.keys(profil.traeger);
  if (traegerNamen.length === 0) throw new Error(`kostenarten: Profil '${name}'.traeger ist leer`);
  for (const traeger of traegerNamen) pruefeTraegerEinsammler(name, traeger, profil.traeger[traeger]);
  pruefePflichttypen(name, profil.pflichttypen);
}

const SIP_TRUNKING_BELEGTYP = "sip-trunking";

const TELNYX_CALL_RECORDS_BELEGTYPEN = Object.freeze([
  "sip-trunking",
  "call-control",
  "speech-to-text",
  "text-to-speech",
  "recording",
  "ai-voice-assistant",
]);

export const KOSTENARTEN = Object.freeze({
  [KOSTENART.ELEVENLABS_CONVAI]: {
    quelle: "ElevenLabs, GET /v1/convai/conversations/{conversation_id}, metadata.cost_fiat",
    waehrung: "USD",
    pflicht: true,
    preisquelle:
      "Anbieter-Ist, synchron am Gespraechsende (persistProviderResult, " +
      "elevenlabs/outbound.js). Waehrung BELEGT: GET /v1/user/subscription -> " +
      "currency:\"usd\" (befund-elevenlabs.md 3). Gemessen ueber 8 Anrufe: " +
      "0,0099-0,1333 USD je Anruf, 11,81 US-ct/min im Schnitt (AUFTRAG B2).",
  },
  [KOSTENART.TELNYX_SIP]: {
    quelle:
      "Telnyx, GET /v2/detail_records?filter[record_type]=sip-trunking, Betrag cost, " +
      "Join raw.sip_call_id === call.sipCallId",
    waehrung: "USD",
    pflicht: true,
    preisquelle:
      "Anbieter-Ist, verzoegert (COST_TRUING_DELAY_MINUTES). Waehrung BELEGT: " +
      "currency=\"USD\" auf allen 13 gemessenen Records (befund-telnyx.md O2). " +
      "Gemessen: 4,01 US-ct/min DE-Mobilfunk, 2,31 US-ct/min DE-Festnetz, immer auf " +
      "volle Minute aufgerundet.",
  },
  [KOSTENART.TELNYX_CALL_RECORDS]: {
    quelle:
      "Telnyx, detail_records, Summe aller zuordenbaren record_type-Werte je Anruf " +
      "(ASSIGNABLE_COST_RECORD_TYPES, telephony/adapters/telnyx/voice.js)",
    waehrung: "USD",
    pflicht: true,
    belegtypen: TELNYX_CALL_RECORDS_BELEGTYPEN,
    preisquelle:
      "Anbieter-Ist, Bestand: 56 von 56 Anrufen im Telnyx-Zeitraum abgeglichen " +
      "(AUFTRAG B1). belegtypen ist die TRAEGER-ZUORDNUNG (welche Records den Betrag " +
      "tragen), NICHT die Pflicht-Typmenge aus COST_TRUING_REQUIRED_RECORD_TYPES (die " +
      "steht separat, config.billing.costTruingRequiredRecordTypes) - beide zu " +
      "verwechseln setzt die Erstattungsbedingung falsch (in beide Richtungen, s. " +
      "Kommentar an der Konstante).",
  },
  [KOSTENART.AI_TOKEN]: {
    quelle: "eigen, meterAiTokens (llm-usage.js) -> trackUsage -> bookCents (state-ops.js)",
    waehrung: "Bucket (EUR-Cent)",
    pflicht: false,
    preisquelle:
      "Konfigurierte Modellpreise (config.llm.modelPricesUsd), KEIN Anbieter-Ist - " +
      "eine Preisdrift beim LLM-Anbieter ist auf dieser Achse unbeobachtet (offener " +
      "Punkt, Abschnitt 9). Faellt AUCH auf dem EL-Weg an: Precall-Briefing, " +
      "Eroeffnungssatz und der summarizeCall-Rueckfall buchen alle drei ausserhalb der " +
      "Turn-Schleife auf dieselbe Gate-Achse (bookTokenUsage/bookEstimatedTokenUsage).",
  },
  [KOSTENART.RESEARCH_FEE]: {
    quelle: "eigen, addResearchFeeCostCents (state-ops.js), Aufrufer llm-usage.js",
    waehrung: "Bucket (EUR-Cent)",
    pflicht: false,
    preisquelle:
      "Konfigurationswert (Exa-Suchgebuehr), kein Anbieter-Beleg noetig. Faellt AUCH " +
      "auf dem EL-Weg an (routes/webhooks-elevenlabs.js bucht live waehrend eines " +
      "EL-Gespraechs).",
  },
  [KOSTENART.SMS]: {
    quelle: "eigen, config.billing.smsCostCents (Default 0), Versand vor Buchung (call-finish.js)",
    waehrung: "Bucket (EUR-Cent)",
    pflicht: false,
    preisquelle:
      "Konfigurationswert ohne Anbieterbeleg, Default 0 - kein Fail-closed, ein " +
      "fehlender Preis ist hier lautlos 0.",
  },
  [KOSTENART.EIGEN_TTS_ZEICHEN]: {
    quelle: "eigen, recordTtsCharacters (state-ops.js), zaehlt Zeichen je Tenant",
    waehrung: "USD",
    pflicht: false,
    preisquelle:
      "GEMESSEN 2026-08-31, GET /v1/user/subscription (ElevenLabs, Konto der Phase " +
      "KV2-2): EIN gemeinsamer Kontingent-Zaehler auf Kontoebene " +
      "(character_count/character_limit, zum Messzeitpunkt 34530/63996, tier " +
      "\"starter\"), currency:\"usd\". Der Endpunkt fuehrt KEINE getrennte " +
      "ConvAI-Groesse - <Play>-Zeichen (dieser Pfad) und ConvAI-Verbrauch ziehen also " +
      "aus DEMSELBEN Kontingent, kein zweiter Zaehler existiert. Der " +
      "Ueberschreitungspreis je Zeichen ist am Endpunkt NICHT ausgewiesen " +
      "(current_overage.amount war zum Messzeitpunkt \"0\") - offener Punkt " +
      "Abschnitt 9, wenn ein Beleg-Einsammler je gebaut wird.",
  },
  [KOSTENART.EL_GRUNDGEBUEHR]: {
    quelle: "ElevenLabs, GET /v1/user/subscription, next_invoice.subtotal_cents",
    waehrung: "USD",
    pflicht: false,
    preisquelle:
      "Anbieter-Ist, monatlich: 600 US-Cent (befund-elevenlabs.md 3), Plan " +
      "\"starter\". Reine Anzeige (PLATFORM_FIXED_COST_CENTS_PER_MONTH), kein " +
      "Tenant-Gate. Der Wert ist ein USD-Listenpreis und wird seit KV2-10 in " +
      "api-billing.js ueber den EINEN Kurs nach EUR-Cent umgerechnet und als " +
      "USD-Listenpreis mitgegeben (KV2-10).",
  },
  [KOSTENART.EL_CREDIT_KONTINGENT]: {
    quelle:
      "ElevenLabs, charging.free_minutes_consumed / free_llm_dollars_consumed (Detailfeld " +
      "an Belegzeile elevenlabs_convai)",
    waehrung: "Credits",
    pflicht: false,
    preisquelle:
      "Listenpreis vs. Zahlungsstrom: in allen 8 gemessenen Anrufen 0 verbrauchte " +
      "Freikredits (AUFTRAG B2). Kein eigener Gate-/Buch-Weg, nur Detailfeld.",
  },
  [KOSTENART.DID_MIETE]: {
    quelle: "Telnyx-Nummernpreis am Nummern-Datensatz (number.monthlyCostCents)",
    waehrung: "USD",
    pflicht: false,
    preisquelle:
      "Anbieter-gelernter Preis beim Kauf (Owner-Entscheidung 2026-07-27, KEIN " +
      "Fallback). Erloes-Buch ja (kind NUMBER_MONTH), Gate nein. Heute traegt keine " +
      "reale Nummer einen gelernten Preis.",
  },
  [KOSTENART.NUMMERN_EINKAUF]: {
    quelle: "heute nirgends erfasst",
    waehrung: "keine - heute nirgends erfasst",
    pflicht: false,
    preisquelle:
      "Luecke, benannt statt gebaut: numberSetupFeeCents ist der Preis, den WIR " +
      "nehmen, nicht der, den wir zahlen. Bleibt ausserhalb dieser Kette.",
  },
  [KOSTENART.STRIPE_GEBUEHR]: {
    quelle: "Stripe, Gebuehrenzeile je Zahlung (Balance-Transaction)",
    waehrung: "Waehrung der jeweiligen Zahlung",
    pflicht: false,
    preisquelle:
      "Heute in keinem Code gelesen. Real, eindeutig einem Tenant zuzuordnen, " +
      "anbieterbelegt - waechst mit dem Produkterfolg, gehoert aber nicht auf die " +
      "Gespraechs-Gate-Achse (entsteht nicht im Anruf). Preisherleitung waere eine " +
      "eigene Kette.",
  },
  [KOSTENART.INFRASTRUKTUR]: {
    quelle: "Render, Postgres, Domains - keine API-Quelle im System",
    waehrung: "keine - Gemeinkosten ohne Verursacher je Anruf",
    pflicht: false,
    preisquelle: "Preisbildungs-Eingabe (was muss ein Abo kosten), keine Verbrauchskosten.",
  },
  [KOSTENART.TELNYX_INFERENCE]: {
    quelle: "Telnyx, detail_records, record_type=inference, Betrag cost",
    waehrung: "USD",
    pflicht: false,
    preisquelle:
      "Anbieter-Ist waere abrufbar, aber STRUKTURELL nicht zuordenbar - der Typ " +
      "traegt weder call_control_id noch ein Session-Feld, nur conversation_id " +
      "(UNASSIGNABLE_COST_RECORD_TYPES, voice.js). Ob dieser Typ auf dem Konto " +
      "ueberhaupt Betraege traegt, ist ungemessen (offener Punkt Abschnitt 9, zu " +
      "klaeren in KV2-5(d)).",
  },
  [KOSTENART.MAIL_ZUSAMMENFASSUNG]: {
    quelle:
      "Anbieterdienst, ZWEI moegliche Kanaele (Brevo HTTP vor SMTP, selectMailer, " +
      "wiring/web-login.js), Ausloeser call-finish.js je beendetem Anruf",
    waehrung: "USD",
    pflicht: false,
    preisquelle:
      "GEMESSEN 2026-08-31, oeffentliche Brevo-Preisliste: Transactional-Einstieg " +
      "\"Starter\" 9 USD/Monat fuer 5.000 E-Mails. Welcher Kanal in PRODUKTION aktiv " +
      "ist, konnte diese Session NICHT bestaetigen - der Render-Log-Abruf " +
      "(mail-boot-probe.js-Boot-Zeile) braucht eine Workspace-Bestaetigung, die eine " +
      "nicht-interaktive Session nicht einholen kann; benannter offener Punkt " +
      "Abschnitt 9, kein leeres Feld. Indiz aus dem Repo (.env.example: Render sperrt " +
      "SMTP auf dem kostenlosen Plan): Brevo ist der wahrscheinliche Live-Kanal. " +
      "Owner-Entscheidung 15 (2026-08-30 nicht ausdruecklich entschieden, Default " +
      "\"nur katalogisieren\"): kein Einsammler in dieser Phase.",
  },
  [KOSTENART.WORKOS_AUTH]: {
    quelle:
      "WorkOS (User-Management/AuthKit), Konto-Rechnung des Identitaets-Anbieters - kein " +
      "Betrags-Endpunkt im Repo",
    waehrung: "USD",
    pflicht: false,
    preisquelle:
      "GEMESSEN 2026-08-31, oeffentliche WorkOS-Preisliste (workos.com/pricing): " +
      "erste 1 Mio. monatlich aktive Nutzer (MAU) kostenlos, danach 2.500 USD je " +
      "weiterer 1 Mio. MAU. Kein Traeger irgendeines Profils (Abschnitt 8, Punkt 16) - " +
      "die Gebuehr entsteht an der Nutzeridentitaet, nicht im Anruf.",
  },
});

export const KOSTENPROFILE = Object.freeze({
  [KOSTENPROFIL.EL_CONVAI_SIP]: {
    pflichttypen: Object.freeze([SIP_TRUNKING_BELEGTYP]),
    traeger: {
      [KOSTENART.ELEVENLABS_CONVAI]: { einsammler: EINSAMMLER.KV2_4 },
      [KOSTENART.TELNYX_SIP]: { einsammler: EINSAMMLER.KV2_5 },
    },
  },
  [KOSTENPROFIL.TELNYX_BUDGET]: {
    pflichttypen: PFLICHTTYPEN_AUS_ENV,
    traeger: { [KOSTENART.TELNYX_CALL_RECORDS]: { einsammler: EINSAMMLER.KV2_5G } },
  },
  [KOSTENPROFIL.TELNYX_INBOUND_BUDGET]: {
    pflichttypen: PFLICHTTYPEN_AUS_ENV,
    traeger: { [KOSTENART.TELNYX_CALL_RECORDS]: { einsammler: EINSAMMLER.KV2_5G } },
  },
  [KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI]: {
    pflichttypen: PFLICHTTYPEN_UNGEMESSEN,
    traeger: {
      [KOSTENART.ELEVENLABS_CONVAI]: { einsammler: EINSAMMLER.KV2_4 },
      [KOSTENART.TELNYX_CALL_RECORDS]: { einsammler: EINSAMMLER.KV2_5G },
    },
  },
});

export function istBekanntesKostenprofil(wert) {
  return Object.hasOwn(KOSTENPROFILE, wert);
}

export function pflichttypenFuerProfil(profil, envPflichttypen) {
  const eintrag = KOSTENPROFILE[profil]?.pflichttypen;
  if (eintrag === PFLICHTTYPEN_AUS_ENV) return envPflichttypen;
  return Array.isArray(eintrag) ? eintrag : PFLICHTTYPEN_UNGEMESSEN;
}

export function legacyKostenprofil({ sipCallId, direction }) {
  if (sipCallId) return KOSTENPROFIL.EL_CONVAI_SIP;
  return direction === RICHTUNG_INBOUND ? KOSTENPROFIL.TELNYX_INBOUND_BUDGET : KOSTENPROFIL.TELNYX_BUDGET;
}

export function kostenprofilFuerAnruf(call) {
  if (istBekanntesKostenprofil(call?.costProfile)) return call.costProfile;
  return call?.costProfile == null ? legacyKostenprofil(call ?? {}) : call.costProfile;
}

export function pflichtTraegerFuerProfil(profil) {
  const traegerEintraege = Object.entries(KOSTENPROFILE[profil]?.traeger ?? {});
  const pflichtEintraege = traegerEintraege.filter(([, eintrag]) => eintrag.einsammler !== EINSAMMLER.NICHT_BELEGPFLICHTIG);
  return pflichtEintraege.map(([traeger]) => traeger);
}

for (const [name, zeile] of Object.entries(KOSTENARTEN)) pruefeKostenart(name, zeile);
for (const [name, profil] of Object.entries(KOSTENPROFILE)) pruefeProfil(name, profil);

function pruefeSchluesselmenge(bezeichner, tabelle, enumWerte) {
  const tabellenKeys = new Set(Object.keys(tabelle));
  const enumSet = new Set(enumWerte);
  if (tabellenKeys.size !== enumSet.size || [...enumSet].some((wert) => !tabellenKeys.has(wert)))
    throw new Error(`kostenarten: ${bezeichner}-Keys weichen von ihrem Enum ab`);
}
pruefeSchluesselmenge("KOSTENARTEN", KOSTENARTEN, Object.values(KOSTENART));
pruefeSchluesselmenge("KOSTENPROFILE", KOSTENPROFILE, Object.values(KOSTENPROFIL));
