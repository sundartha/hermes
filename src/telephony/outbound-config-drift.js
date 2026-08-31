// OUTBOUND-E4 (E-6/F4): die EINE Antwort auf "stimmt unsere Absender-Konfiguration noch
// mit der Anbieter-Wirklichkeit ueberein?". REIN: kein Netz, kein Date.now, kein
// config-Import, kein store-Import. Eingabe = die abgefragten Antworten (messung, s.
// outbound-config-probe.js), Ausgabe = Befundliste. Der Meldeweg ist bewusst getrennt
// (Muster outage-detection.js <-> outage-report.js, dasselbe Trennungsprinzip).
//
// REGRESSIONSFANG 27.08.2026 (tasks/befund-outbound-ausfall-2026-08-27.md): die
// Plattform-Absendernummer (+15739090177) gehoerte dem Telnyx-Konto nicht mehr, obwohl
// der ANI-Override sie weiter trug. Pruefung 3 (GET /v2/phone_numbers?filter[phone_
// number]=<N_ani>) ist der einzelne, eindeutige GET, der das erkennt - OHNE dass ein
// Anruf stattfindet.
//
// "UNKNOWN" IST EIN EIGENER, GEZAEHLTER BEFUND (PM-16): eine Pruefung, die mangels
// Konfiguration oder wegen eines Anbieterfehlers kein Urteil faellen kann, ist NIE
// "kein Befund" - sie ist ein Befund der Klasse unknown und zaehlt in zaehler.unknown.
// Eine Pruefung, die das nicht ausdrueckt, kann "konnte nicht pruefen" nicht von
// "geprueft und gut" unterscheiden - genau der Fehler, der den 27.08. drei Tage lang
// unsichtbar gemacht hat.
//
// BAUFORM (F1/G27, max. 3 Argumente je Funktion): jede pruefeXxx-Funktion bekommt ihre
// Messwerte plus GENAU einen "ctx" ({ausgenommen, befunde}) - melde() ist der einzige
// Schreibzugriff auf ctx.befunde (kein Streuen von befunde.push(...) ueber die Datei).
// zaehler wird NIRGENDS als Parameter durchgereicht (kein no-param-reassign-Risiko):
// beurteileDrift() zaehlt am Ende EINMAL ueber die fertige Befundliste.

// Anzahl der Pruefungen, die dieser Kern kennt (Plan E-6, Tabelle "Neun Invarianten").
// Pruefung 5 ist rein rechnerisch (kein Netzzugriff, kein eigener messung-Schluessel),
// Pruefung 4 ist ein Ausweichpfad zu Pruefung 3 (kein eigener Befund-Code) - beide zaehlen
// trotzdem zur Sollzahl, weil beide ein Urteil beitragen.
export const PRUEFUNGEN_SOLL = 9;

const MIN_KONTOTREFFER = 1;
const STUNDEN_PRO_TAG = 24;

export const DRIFT_KLASSE = Object.freeze({
  OWNERSHIP: "ownership",
  CONFIG: "config",
  WARN: "warn",
  UNKNOWN: "unknown",
  STALE: "watchdog_stale",
});

export const DRIFT_BEFUND = Object.freeze({
  OWNERSHIP_LOST: "ownership_lost",
  ALERT_SENDER_NOT_OWNED: "alert_sender_not_owned",
  EL_NUMBER_MISSING: "config_el_number_missing",
  EL_AGENT_MISMATCH: "config_el_agent_mismatch",
  EL_OUTBOUND_DISABLED: "config_el_outbound_disabled",
  CONNECTION_INACTIVE: "config_connection_inactive",
  ANI_OVERRIDE_MISSING: "config_ani_override_missing",
  ANI_MISMATCH: "config_ani_mismatch",
  FQDN_UNBOUND: "config_fqdn_unbound",
  OVP_DISABLED: "config_ovp_disabled",
  OVP_DESTINATION_MISSING: "config_ovp_destination_missing",
  BALANCE_LOW: "balance_low",
  WATCHDOG_STALE: "watchdog_stale",
});

// Praefix jedes unknown-Befund-Codes: "unbekannt:pruefung<N>" bzw. "unbekannt:
// pruefung1_supports_outbound" (K-15, Sonderfall: ein Feld, das die Antwortform gar nicht
// traegt, ist kein Anbieterfehler, sondern eine eigene Unwissenheit).
export const UNBEKANNT_PRAEFIX = "unbekannt:";

function unbekannt(pruefung) {
  return `${UNBEKANNT_PRAEFIX}${pruefung}`;
}

// Fail-closed (Blocker-Vermeidungsliste 3, Muster ausnahmeFormFehler in
// scripts/lib/elevenlabs-besitz.mjs): eine Ausnahme OHNE grund ODER OHNE seit ist keine
// gueltige Ausnahme - sie wird zu einem eigenen, BLOCKIERENDEN Fehler und NIE stillschweigend
// zu einer echten Ausnahme aufgewertet. EINE Regel-Quelle (G5, Review-Blocker): sowohl
// ausnahmeFehler als auch gueltigeAusnahmen fragen istUngueltig() - eine Aenderung der Regel
// (z.B. "seit" muss ein ISO-Datum sein) kann dadurch nicht mehr an einer der beiden Stellen
// vergessen werden.
function istUngueltig(ausnahme) {
  return !ausnahme.grund || !ausnahme.seit;
}

export function ausnahmeFehler(ausnahmen) {
  return ausnahmen
    .filter(istUngueltig)
    .map(
      (ausnahme) =>
        `Ausnahme fuer '${ausnahme.befund || "(kein Befund-Code)"}' ist UNGUELTIG: grund und seit sind Pflicht (fail-closed).`,
    );
}

function gueltigeAusnahmen(ausnahmen) {
  const fehler = ausnahmeFehler(ausnahmen);
  const ungueltig = new Set(ausnahmen.filter(istUngueltig).map((ausnahme) => ausnahme.befund));
  const map = new Map();
  for (const ausnahme of ausnahmen) {
    if (ungueltig.has(ausnahme.befund)) continue;
    map.set(ausnahme.befund, ausnahme);
  }
  return { map, fehler };
}

// EIN Neubau-Kontext je Lauf ({ausgenommen: Map, befunde: []}) - melde() ist der EINZIGE
// Schreibzugriff auf ctx.befunde in der ganzen Datei.
function neuerKontext(ausgenommen) {
  return { ausgenommen, befunde: [] };
}

// EIN Befund-Eintrag - PII-frei (nur Codes/Klassen/ISO-Codes/Anzahlen im detail, NIE eine
// Rufnummer, NIE eine Tenant-Kennung).
function melde({ code, klasse, detail }, ctx) {
  ctx.befunde.push({ code, klasse, detail, ausgenommen: ctx.ausgenommen.has(code) });
}

function meldeUnbekannt(pruefung, detail, ctx) {
  melde({ code: unbekannt(pruefung), klasse: DRIFT_KLASSE.UNKNOWN, detail }, ctx);
}

// ---- Pruefung 1: ElevenLabs-SIP-Nummer -------------------------------------------------
function pruefeElNummer({ elNummer }, soll, ctx) {
  if (!elNummer || elNummer.ok !== true) {
    meldeUnbekannt("pruefung1", "elNummer nicht lesbar", ctx);
    return null;
  }
  const wert = elNummer.wert || {};
  if (!wert.e164) {
    meldeUnbekannt("pruefung1", "phone_number fehlt in der Antwort", ctx);
    return null;
  }
  // Blocker 1/5 (Review Runde 2): "kein Urteil moeglich" hatte hier ZWEI stille Faelle -
  // soll.elAgentId leer (ELEVENLABS_AGENT_ID nicht konfiguriert) und wert.agentId fehlend
  // (assigned_agent nicht in der Antwort, z.B. Nummer keinem Agenten zugewiesen). Beide
  // wurden bisher als [] gemeldet UND als "gemessen" mitgezaehlt - exakt der Fehler, den
  // K-15 fuer pruefung1_supports_outbound bereits behoben hat (unbekannt statt stumm).
  if (!soll.elAgentId) {
    meldeUnbekannt("pruefung1_agent", "ELEVENLABS_AGENT_ID nicht konfiguriert", ctx);
  } else if (!wert.agentId) {
    meldeUnbekannt("pruefung1_agent", "assigned_agent.agent_id fehlt in der Antwort", ctx);
  } else if (wert.agentId !== soll.elAgentId) {
    melde(
      { code: DRIFT_BEFUND.EL_AGENT_MISMATCH, klasse: DRIFT_KLASSE.CONFIG, detail: "assigned_agent.agent_id != ELEVENLABS_AGENT_ID" },
      ctx,
    );
  }
  // supports_outbound ist im gemessenen Befund NICHT enthalten (Plan Zeile 1, zweite
  // Zeile): fehlt das Feld -> eigener unknown-Code (K-15), NIE ein config-Befund aus
  // einem Feldnamen, den wir nie gesehen haben.
  if (wert.supportsOutbound === undefined) {
    meldeUnbekannt("pruefung1_supports_outbound", "supports_outbound nicht in der Antwort", ctx);
  } else if (wert.supportsOutbound === false) {
    melde({ code: DRIFT_BEFUND.EL_OUTBOUND_DISABLED, klasse: DRIFT_KLASSE.CONFIG, detail: "supports_outbound=false" }, ctx);
  }
  return wert.e164;
}

// ---- Pruefung 2: Telnyx-FQDN-Connection ------------------------------------------------
function pruefeConnection({ connection }, ctx) {
  if (!connection || connection.ok !== true) {
    meldeUnbekannt("pruefung2", "connection nicht lesbar", ctx);
    return null;
  }
  const wert = connection.wert || {};
  if (wert.active !== true) {
    melde({ code: DRIFT_BEFUND.CONNECTION_INACTIVE, klasse: DRIFT_KLASSE.CONFIG, detail: "fqdn_connection.active != true" }, ctx);
  }
  return wert.aniOverride || null;
}

// ---- Pruefung 3+4: Kontoeigentum der ANI ----------------------------------------------
// EXPORTIERT (Review-Blocker G9/C2, G5): der ANI-Riegel (outbound-gates.js#
// ani_ownership) braucht fuer seine LIVE-Nachmessung exakt dasselbe Kontoeigentums-
// Urteil wie Pruefung 3/9 - EINE Quelle statt einer zweiten, im Gate getippten
// Vergleichslogik.
export function kontoBesitzt(kontotreffer, e164) {
  if (!kontotreffer || kontotreffer.ok !== true) return "unbekannt";
  const treffer = (kontotreffer.wert || {}).treffer || [];
  const genau = treffer.filter((eintrag) => eintrag.e164 === e164 && eintrag.status === "active");
  return genau.length >= MIN_KONTOTREFFER ? "besitzt" : "verloren";
}

function verifiziertAlsAusweich(verifizierte, e164) {
  if (!verifizierte || verifizierte.ok !== true) return false;
  return (verifizierte.wert || {}).e164s?.includes(e164) === true;
}

// Review-Blocker G26/PM-16: "kein Urteil moeglich" war bisher EIN Fall (return ohne
// Befund) fuer ZWEI verschiedene Ursachen - Pruefung 2 selbst nicht lesbar (Anbieterfehler,
// bereits unbekannt:pruefung2) UND Connection lesbar, aber ani_override GELOESCHT (eine
// stille Konfigurationsaenderung beim Anbieter, die Outbound genauso lahmlegt wie
// ownership_lost). Beide muessen die Sollzahl korrekt bedienen (kein Phantom-"gemessen")
// und der zweite Fall braucht den VOLLEN Meldeweg statt eines stillen unknown.
function pruefeAniEigentum({ aniKontotreffer, verifizierte, connection }, nAni, ctx) {
  if (!nAni) {
    if (connection && connection.ok === true) {
      melde(
        { code: DRIFT_BEFUND.ANI_OVERRIDE_MISSING, klasse: DRIFT_KLASSE.CONFIG, detail: "fqdn_connection.outbound.ani_override ist leer" },
        ctx,
      );
      return;
    }
    meldeUnbekannt("pruefung3", "kein N_ani ableitbar (Pruefung 2 nicht lesbar)", ctx);
    return;
  }
  const status = kontoBesitzt(aniKontotreffer, nAni);
  if (status === "unbekannt") {
    meldeUnbekannt("pruefung3", "aniKontotreffer nicht lesbar", ctx);
    return;
  }
  if (status === "besitzt") return;
  // Pruefung 4 (Ausweichpfad): eine verifizierte Fremd-CLI hebt den Verlust auf.
  if (verifiziertAlsAusweich(verifizierte, nAni)) return;
  melde({ code: DRIFT_BEFUND.OWNERSHIP_LOST, klasse: DRIFT_KLASSE.OWNERSHIP, detail: "ANI gehoert dem Telnyx-Konto nicht mehr" }, ctx);
}

// ---- Pruefung 5: die drei Deklarationen stimmen ueberein (rein rechnerisch) -----------
function pruefeAniUebereinstimmung({ nEl, nAni }, soll, ctx) {
  if (!nEl || !nAni || !soll.platformAniE164) {
    meldeUnbekannt("pruefung5", "N_el/N_ani/PLATFORM_ANI_E164 nicht vollstaendig", ctx);
    return;
  }
  if (nEl === nAni && nAni === soll.platformAniE164) return;
  // Weg 1 der Wiederherstellung verletzt Pruefung 5 BEWUSST - das ist niemals ownership.
  melde({ code: DRIFT_BEFUND.ANI_MISMATCH, klasse: DRIFT_KLASSE.CONFIG, detail: "N_el/N_ani/PLATFORM_ANI_E164 weichen ab" }, ctx);
}

// ---- Pruefung 6: FQDN an die Connection gebunden --------------------------------------
function pruefeFqdns({ fqdns }, soll, ctx) {
  if (!soll.fqdnConnectionId) {
    meldeUnbekannt("pruefung6", "TELNYX_FQDN_CONNECTION_ID nicht konfiguriert", ctx);
    return;
  }
  if (!fqdns || fqdns.ok !== true) {
    meldeUnbekannt("pruefung6", "fqdns nicht lesbar", ctx);
    return;
  }
  const ids = (fqdns.wert || {}).connectionIds || [];
  // STRIKTER String-Vergleich (kein Praefix/Fuzzy) - die IDs sind bereits ueber
  // telnyxJson() praezisionssicher als String projiziert (19-stellige Telnyx-IDs).
  if (!ids.some((id) => String(id) === String(soll.fqdnConnectionId))) {
    melde({ code: DRIFT_BEFUND.FQDN_UNBOUND, klasse: DRIFT_KLASSE.CONFIG, detail: "kein fqdn an TELNYX_FQDN_CONNECTION_ID gebunden" }, ctx);
  }
}

// ---- Pruefung 7: Outbound-Voice-Profile (enabled + Laender-Menge) --------------------
function pruefeOvp({ ovp }, soll, ctx) {
  if (!soll.ovpId) {
    meldeUnbekannt("pruefung7", "TELNYX_OUTBOUND_VOICE_PROFILE_ID nicht konfiguriert", ctx);
    return;
  }
  if (!ovp || ovp.ok !== true) {
    meldeUnbekannt("pruefung7", "ovp nicht lesbar", ctx);
    return;
  }
  const wert = ovp.wert || {};
  if (wert.enabled !== true) {
    melde({ code: DRIFT_BEFUND.OVP_DISABLED, klasse: DRIFT_KLASSE.CONFIG, detail: "outbound_voice_profile.enabled != true" }, ctx);
  }
  const bedienteLaender = soll.bedienteLaender || [];
  if (bedienteLaender.length === 0) {
    // bedientes Land nicht ableitbar (ALLOWED_COUNTRY_CODES="*" oder NANP) - Owner-
    // Entscheidung: kein Fehlalarm auf einer Menge, die wir nicht bilden koennen.
    meldeUnbekannt("pruefung7", "bedientes Land nicht ableitbar", ctx);
    return;
  }
  const whitelist = wert.whitelistedDestinations || [];
  const fehlend = bedienteLaender.filter((land) => !whitelist.includes(land));
  if (fehlend.length > 0) {
    melde(
      { code: DRIFT_BEFUND.OVP_DESTINATION_MISSING, klasse: DRIFT_KLASSE.CONFIG, detail: `fehlende Ziellaender: ${fehlend.join(",")}` },
      ctx,
    );
  }
}

// ---- Pruefung 8: Guthaben-Reichweite ---------------------------------------------------
function pruefeBalance({ balance }, schwellen, ctx) {
  if (!balance || balance.ok !== true) {
    meldeUnbekannt("pruefung8", "balance nicht lesbar", ctx);
    return;
  }
  const wert = balance.wert || {};
  const verbrauch = wert.verbrauch24hMicroCents;
  if (!Number.isFinite(verbrauch) || verbrauch <= 0) {
    // Kein Verbrauch -> Reichweite nicht berechenbar (Regelfall bei ~1 Anruf/Woche) -
    // ehrlich unknown, NIE gruen.
    meldeUnbekannt("pruefung8", "kein Verbrauch in 24h - Reichweite nicht berechenbar", ctx);
    return;
  }
  if (!Number.isFinite(wert.availableCreditMicroCents)) {
    // Guthaben nicht parsebar (Anbieter-Antwortform gebrochen) -> NIE als 0 werten (eine
    // still zu 0 gewordene Zahl saehe aus wie eine echte Messung).
    meldeUnbekannt("pruefung8", "Guthaben nicht parsebar", ctx);
    return;
  }
  const proStunde = verbrauch / STUNDEN_PRO_TAG;
  const reichweiteStunden = wert.availableCreditMicroCents / proStunde;
  if (reichweiteStunden < schwellen.balanceMinHours) {
    melde(
      {
        code: DRIFT_BEFUND.BALANCE_LOW,
        klasse: DRIFT_KLASSE.WARN,
        detail: `Reichweite ${Math.round(reichweiteStunden)}h < ${schwellen.balanceMinHours}h`,
      },
      ctx,
    );
  }
}

// ---- Pruefung 9: Alarm-Absender kontoeigen --------------------------------------------
function pruefeAlertSender({ alertSenderKontotreffer }, soll, ctx) {
  if (!soll.alertSenderE164) {
    meldeUnbekannt("pruefung9", "keine alert_sms_sender-Bindung", ctx);
    return;
  }
  const status = kontoBesitzt(alertSenderKontotreffer, soll.alertSenderE164);
  if (status === "unbekannt") {
    meldeUnbekannt("pruefung9", "alertSenderKontotreffer nicht lesbar", ctx);
    return;
  }
  if (status === "verloren") {
    melde(
      { code: DRIFT_BEFUND.ALERT_SENDER_NOT_OWNED, klasse: DRIFT_KLASSE.OWNERSHIP, detail: "Alarm-Absender gehoert dem Konto nicht mehr" },
      ctx,
    );
  }
}

// ---- watchdog_stale: die letzte ERFOLGREICHE Messung ist zu alt ----------------------
// letzteErfolgreicheMessungMs kommt aus dem durablen Marker (drift:messung-ok, s.
// outbound-drift-watch.js) - der Kern bleibt dadurch trotzdem rein: der Aufrufer liest
// die Uhr/den Store, der Kern bekommt nur die fertige Zahl.
function pruefeStale({ soll, schwellen, nowMs }, ctx) {
  const letzte = soll.letzteErfolgreicheMessungMs;
  if (!Number.isFinite(letzte)) return; // noch nie erfolgreich gemessen -> kein stale-Urteil
  if (nowMs - letzte > schwellen.staleMs) {
    melde(
      { code: DRIFT_BEFUND.WATCHDOG_STALE, klasse: DRIFT_KLASSE.STALE, detail: `letzte erfolgreiche Messung vor ${nowMs - letzte}ms` },
      ctx,
    );
  }
}

// Zaehlt EINMAL ueber die fertige Befundliste (ALLE Klassen, ausgenommen oder nicht) -
// die einzige Stelle, die zaehler befuellt (kein Parameter-Mutieren in den pruefeXxx-
// Funktionen, G27/F1).
//
// unknownOffen (Blocker 4, S1-1): NICHT-AUSGENOMMENE unknowns - unterscheidet "erklaerte
// Unwissenheit" (ein strukturell unvermeidbarer unknown mit gueltiger Ausnahme, z.B.
// unbekannt:pruefung1_supports_outbound) von "konnte nicht messen" (ein ECHTER
// Anbieterfehler/fehlender Schluessel ohne Ausnahme). zaehler.unknown bleibt die
// GESAMTzahl (Sollzahl-Rechnung/Log-Zeile) - unknownOffen ist die fuer Selbstheilung
// (schliesseVerschwundeneBefunde/MESSUNG_OK_MARKER, outbound-drift-watch.js) relevante
// Teilmenge. Ohne die Trennung war zaehler.unknown in Produktion IMMER > 0 (strukturelle
// unknowns sind der Regelfall), wodurch beide Selbstheilungs-Bedingungen unerreichbar
// blieben.
function zaehleBefunde(befunde) {
  const zaehler = { ownership: 0, config: 0, warn: 0, unknown: 0, watchdog_stale: 0, unknownOffen: 0 };
  for (const eintrag of befunde) {
    zaehler[eintrag.klasse] += 1;
    if (eintrag.klasse === DRIFT_KLASSE.UNKNOWN && !eintrag.ausgenommen) zaehler.unknownOffen += 1;
  }
  return zaehler;
}

/**
 * Der Entscheidungskern. messung/soll s. outbound-config-probe.js#messeAnbieterWirklichkeit
 * bzw. den Aufrufer (outbound-drift-watch.js/check-outbound-drift.mjs). ausnahmen:
 * [{befund, grund, seit}] (Muster outbound-drift-ausnahmen.json). schwellen:
 * {staleMs, balanceMinHours}. nowMs injiziert (kein Date.now im Kern).
 * @returns {{ befunde, zaehler, gemessen, soll, fehler }}
 */
export function beurteileDrift({ messung, soll, ausnahmen = [], schwellen, nowMs }) {
  const { map: ausgenommen, fehler } = gueltigeAusnahmen(ausnahmen);
  const ctx = neuerKontext(ausgenommen);

  const nEl = pruefeElNummer(messung, soll, ctx);
  const nAni = pruefeConnection(messung, ctx);
  pruefeAniEigentum(messung, nAni, ctx);
  pruefeAniUebereinstimmung({ nEl, nAni }, soll, ctx);
  pruefeFqdns(messung, soll, ctx);
  pruefeOvp(messung, soll, ctx);
  pruefeBalance(messung, schwellen, ctx);
  pruefeAlertSender(messung, soll, ctx);
  pruefeStale({ soll, schwellen, nowMs }, ctx);

  const zaehler = zaehleBefunde(ctx.befunde);
  return { befunde: ctx.befunde, zaehler, gemessen: PRUEFUNGEN_SOLL - zaehler.unknown, soll: PRUEFUNGEN_SOLL, fehler };
}

// CLI-Exit-Entscheidung (der einzige Ort, an dem "gemeldet" zu "der Lauf faellt durch"
// wird, Muster istBlockierend in scripts/check-elevenlabs-drift.mjs). Exportiert, damit
// die Entscheidung selbst messbar ist.
export function istBlockierend({ befunde, fehler }) {
  if (fehler.length > 0) return true;
  return befunde.some((eintrag) => !eintrag.ausgenommen);
}
