// MCP-Textkanal (PLAN-I18N-FIX P12): die sprachabhaengigen Strings der MCP-Tool-Schicht,
// inklusive der Feldnamen der Berechtigungs-Zusammenfassung (P13).
// GETRENNT von den gesprochenen Locale-Strings: diese Texte werden NIE gesprochen,
// sondern als Chat-Text ausgeliefert - die deutschen Werte bleiben deshalb in der
// ASCII-Transliteration des Bestands (Repo-Konvention, wie summarySystem,
// s. Kopf von i18n/locales.js). Eingehaengt wird das Buendel in LOCALES.<lang>.mcp
// (Muster INBOUND_NOTICES), damit localeFor() DER EINE Sprach-Resolver bleibt und
// mcp-tools.js keinen zweiten Lookup braucht (G5).
//
// FR traegt Akzente (wie jeder FR-String im Bundle), EN ist kuratiert.
//
// OUTBOUND-E3a: callFailedSummary importiert FAILURE_REASON_TEXTS/makeCallFailedSummary
// aus failure-reason-texts.js - DIESELBE Aufloesung Token -> Satz wie die Notification
// (G5), kein zweiter Textbau fuer denselben Grund.
import { FAILURE_REASON_TEXTS, makeCallFailedSummary } from "./failure-reason-texts.js";
// T2-09 (O-13/O-20): neutrale Ablehnungstexte je Gate-Grund, EINE Quelle fuer alle drei
// Sprachen (G5) - kein zweiter Textbau in mcp-tools.js.
import { MCP_DENIAL_TEXTS } from "./mcp-denial-texts.js";

// Stabile, sprachneutrale Fehler-Kennungen (P12 Pre-Mortem 2). Der Wurf traegt den CODE,
// die Uebersetzung passiert an genau EINER Kante (wrapHandler in mcp-tools.js). Diese
// Werte sind Vertrag zwischen Wurf und Kante - KEIN Anzeigetext.
export const MCP_ERROR_CODE = Object.freeze({
  UPSTREAM_INVALID: "upstream_invalid",
  UPSTREAM_INCOMPLETE: "upstream_incomplete",
  UPSTREAM_UNREACHABLE: "upstream_unreachable",
  // E3 (T-27): Zeitablauf auf dem place_call-Hop. NICHT "Anruf fehlgeschlagen" - der Anruf
  // kann laufen (gemessen: bei 15 s Frist kam das Gespraech trotzdem zustande,
  // elevenlabs/convai.js). Der Text sagt deshalb ausdruecklich, dass ein erneuter Versuch
  // den laufenden Anruf zurueckliefert statt einen zweiten zu starten.
  CALL_START_UNCONFIRMED: "call_start_unconfirmed",
  // T2-08 (T-27): Zeitablauf auf JEDEM UEBRIGEN MCP->REST-Hop (cancel_call, answer_consult,
  // check_inbox, get_call_status, list_calls, GET /api/state-Leser, der Abschluss-GET in
  // await_call_event). Anders als CALL_START_UNCONFIRMED (ein Anruf, der trotzdem lief) sagt
  // dieser Text NIE "fehlgeschlagen": cancel/answer laufen serverseitig unabhaengig vom
  // MCP-Client weiter, ein Retry darf deshalb nur zum erneuten Abfragen des Standes raten,
  // nie zu einer blinden Wiederholung.
  HOP_TIMEOUT: "hop_timeout",
  // T-14 (T2-05): kein Hermes-Mandant zu dieser Anmeldung gefunden (OAuth-Login ohne
  // verknuepften Tenant). Kein Wurf - src/mcp-no-tenant.js liest den Text direkt als
  // Tool-Fehlertext, zusammen mit der Re-Auth-Challenge im Ergebnis-_meta.
  NO_TENANT_LINKED: "no_tenant_linked",
  // T2-09 (O-13/O-20): vier weitere stabile Kennungen an der MCP-Grenze. DENIAL_UNKNOWN
  // ist der Auffangtext fuer einen Ablehnungsgrund, der (noch) keinen Tabelleneintrag hat
  // (Pre-Mortem 2) - er darf nie roh am Client landen, deshalb PLUS console.warn
  // serverseitig (mcp-tools.js#toolErrorText). NOT_FOUND/NOT_PERMITTED/REQUEST_REJECTED
  // ersetzen den rohen HTTP-Statuscode fuer alles ohne bekannten Grund.
  DENIAL_UNKNOWN: "denial_unknown",
  NOT_FOUND: "not_found",
  NOT_PERMITTED: "not_permitted",
  REQUEST_REJECTED: "request_rejected",
});

export const MCP_TEXTS = Object.freeze({
  de: Object.freeze({
    // Transkript-Rollen-Praefix (MCP-06). DE byte-identisch zum Bestand.
    roleAgent: "Agent",
    roleCounterparty: "Gegenseite",
    // Feldnamen der Berechtigungs-Zusammenfassung (MCP-09/P13): sie erscheinen als WERT
    // der Widget-Zeile "Permissions" und im Stufe-0-Textblock. DE bleibt byte-identisch
    // zum Bestand - "Summaries" war dort bereits englisch und wird NICHT nebenbei
    // eingedeutscht (das waere eine unbeauftragte Textaenderung).
    permissionLabels: Object.freeze({
      summaries: "Summaries",
      personalData: "PersoenlicheDaten",
      bankData: "Bankdaten",
    }),
    errors: Object.freeze({
      [MCP_ERROR_CODE.UPSTREAM_INVALID]:
        "Der Telefon-Agent hat keine gueltige Antwort geliefert. Bitte spaeter erneut versuchen.",
      [MCP_ERROR_CODE.UPSTREAM_INCOMPLETE]:
        "Der Telefon-Agent hat eine unvollstaendige Antwort geliefert. Bitte spaeter erneut versuchen.",
      [MCP_ERROR_CODE.UPSTREAM_UNREACHABLE]:
        "Der Telefon-Agent ist momentan nicht erreichbar. Bitte spaeter erneut versuchen.",
      [MCP_ERROR_CODE.CALL_START_UNCONFIRMED]:
        "Zeitablauf beim Anrufstart - der Anruf kann bereits laufen. Ein erneuter place_call an " +
        "dieselbe Nummer liefert den laufenden Anruf zurueck und startet keinen zweiten.",
      [MCP_ERROR_CODE.HOP_TIMEOUT]:
        "Zeitablauf bei der Anfrage - die Aktion kann trotzdem ausgefuehrt worden sein. Bitte " +
        "den aktuellen Stand erneut abfragen, statt die Aktion blind zu wiederholen.",
      [MCP_ERROR_CODE.NO_TENANT_LINKED]:
        "Zu dieser Anmeldung ist kein Hermes-Konto verknuepft. Bitte erneut mit dem Konto anmelden, " +
        "das fuer Hermes genutzt wird. Ohne Hermes-Konto ist dieses Werkzeug nicht verfuegbar.",
      [MCP_ERROR_CODE.DENIAL_UNKNOWN]:
        "Der Anruf wurde durch eine Sicherheits- oder Kontopruefung abgelehnt. Es wurde kein " +
        "Anruf gestartet. Details stehen im Hermes-Dashboard.",
      [MCP_ERROR_CODE.NOT_FOUND]:
        "Zu dieser ID wurde kein Anruf fuer dieses Konto gefunden. list_calls zeigt die " +
        "letzten Anrufe.",
      [MCP_ERROR_CODE.NOT_PERMITTED]: "Diese Aktion ist fuer dieses Hermes-Konto nicht verfuegbar.",
      [MCP_ERROR_CODE.REQUEST_REJECTED]:
        "Die Anfrage wurde abgelehnt. Bitte die Eingabe pruefen und erneut versuchen.",
    }),
    // T2-09: Ablehnungstexte je Gate-Grund (s. mcp-denial-texts.js), EINE Quelle je Sprache.
    denials: MCP_DENIAL_TEXTS.de,
    // Leer-/Zwischenzustaende der Tool-Antworten (P15/T3a): tenant-sichtbarer Text,
    // folgt der Tenant-Sprache. DE byte-identisch zum Bestand.
    emptyCalls: "Noch keine Anrufe.",
    // INBOX-P3: die zwei tenant-sichtbaren Texte des Inbox-Werkzeugs. emptyInbox ist
    // NEUTRAL formuliert - die Inbox ist KEINE Vollstaendigkeitsaussage darueber, ob
    // jemand angerufen hat (abgewiesene Rufe erzeugen gar keinen Datensatz, B-2).
    // inboxSummaryUnavailable trennt "technisch gescheitert" von "nichts passiert":
    // ein Eintrag ohne Zusammenfassung ist unbequem, aber wahr (E-2, Pre-Mortem R-1).
    emptyInbox: "Keine neuen Anrufe.",
    inboxSummaryUnavailable: "Zusammenfassung nicht verfuegbar (technischer Fehler).",
    emptyCalendar: "Kalender ist leer.",
    callStillRunning:
      "Anruf laeuft noch. Bitte get_call_status pollen und spaeter erneut versuchen.",
    // AL-P13: Consult-Kanal. TENANT-sichtbarer Text (er erscheint im Chat), deshalb
    // sprachabhaengig - anders als die Tool-Beschreibungen (einsprachig englisch, O14).
    // P5b (O-27 Teil 2, W4): Beschreibung statt Aufforderung - der Text nennt die
    // Voraussetzung, statt eine Host-Sicherheitseinstellung einzufordern.
    consultPermissionHint:
      "Hinweis: Live-Rueckfragen waehrend des Anrufs erreichen diesen Chat nur, wenn die " +
      "Werkzeug-Berechtigung des Connectors erteilt ist.",
    // E3 (N-11): tenant-sichtbarer Dedup-Hinweis, dasselbe Muster wie consultPermissionHint.
    callAlreadyRunningHint:
      "Dieser Anruf lief schon - zurueckgegeben wird der laufende Anruf, es wurde kein zweiter gestartet.",
    consultAnswerAccepted: (n) => `${n} Angabe(n) an den Anruf uebergeben.`,
    // P2 (SCOPE 2): NIE gesprochen, tenant-sichtbarer Chat-Text derselben Klasse wie
    // consultAnswerAccepted - die Quittung ("working") ist keine Antwort und braucht
    // deshalb einen eigenen Text statt consultAnswerAccepted(0).
    consultAckAccepted: "Rueckfrage quittiert - die Antwort wird erwartet.",
    consultAnswerRejected:
      "Antwort verworfen (Format oder Laenge). Die Rueckfrage bleibt offen - bitte kuerzer antworten.",
    consultNoLongerOpen: "Diese Rueckfrage ist nicht mehr offen (beantwortet oder Anruf vorbei).",
    // Stufe-0-Zeilenbausteine (P10/MCP-14): tenant-sichtbarer Text von list_action_items
    // und get_calendar. Sie standen bis hierher als deutsche Literale in mcp-tools.js -
    // in einer Oberflaeche, deren Weltdefault "en" ist. DE bleibt byte-identisch zum
    // Bestand, inklusive des abschliessenden Leerzeichens im Praefix. calendarLine ist
    // eine ZEILEN-Funktion (nicht nur ein Trennwort), weil Verbinder UND Interpunktion
    // um den Zeitraum sprachabhaengig sind - dieselbe Begruendung wie bei der
    // Nutzungszeile unten. Die Zeitwerte kommen fertig formatiert herein.
    emptyActionItems: "Keine offenen Action Items.",
    appointmentPrefix: "(Termin) ",
    calendarLine: ({ title, start, end }) => `${title}: ${start} bis ${end}`,
    // Feldnamen des get_agent_status-Textblocks (P15/T3a). LABEL, wo der Wert nur
    // angehaengt wird; ZEILEN-Funktion, wo die Sprache die Wortstellung bestimmt
    // (Nutzungszeile). KS-P8: der Prozentwert kommt fertig herein - keine Formatlogik
    // im Buendel.
    agentStatus: Object.freeze({
      number: "Agent-Nummer",
      owner: "Besitzer",
      calls: "Calls bisher",
      permissions: "Berechtigungen",
      planUsage: (percent) => `Monatsnutzung: ${percent} % des Minuten-Kontingents`,
      planUsageUnknown: "Monatsnutzung: kein Kontingent hinterlegt",
    }),
    // OUTBOUND-E3a: der Ergebnistext eines gescheiterten Anrufs im MCP-Rueckweg. TENANT-
    // sichtbar (er erscheint im Chat), deshalb sprachabhaengig - anders als die
    // Tool-Beschreibungen (einsprachig englisch, O14). Der GRUND-Satzteil kommt aus
    // FAILURE_REASON_TEXTS, nicht aus einer zweiten Tabelle (G5).
    callFailedSummary: makeCallFailedSummary(
      "Der Anruf ist nicht zustande gekommen.",
      FAILURE_REASON_TEXTS.de,
    ),
  }),
  en: Object.freeze({
    roleAgent: "Agent",
    roleCounterparty: "Other party",
    permissionLabels: Object.freeze({
      summaries: "Summaries",
      personalData: "PersonalData",
      bankData: "BankData",
    }),
    errors: Object.freeze({
      [MCP_ERROR_CODE.UPSTREAM_INVALID]:
        "The phone agent did not return a valid response. Please try again later.",
      [MCP_ERROR_CODE.UPSTREAM_INCOMPLETE]:
        "The phone agent returned an incomplete response. Please try again later.",
      [MCP_ERROR_CODE.UPSTREAM_UNREACHABLE]:
        "The phone agent is currently unavailable. Please try again later.",
      [MCP_ERROR_CODE.CALL_START_UNCONFIRMED]:
        "Timed out while starting the call - the call may already be running. Calling place_call " +
        "again for the same number returns the running call instead of starting a second one.",
      [MCP_ERROR_CODE.HOP_TIMEOUT]:
        "Timed out while waiting for a response - the action may have completed anyway. Please " +
        "check the current status instead of blindly retrying the action.",
      [MCP_ERROR_CODE.NO_TENANT_LINKED]:
        "No Hermes account is linked to this sign-in. Please sign in again with the account you " +
        "use for Hermes. Without a Hermes account this tool is not available.",
      [MCP_ERROR_CODE.DENIAL_UNKNOWN]:
        "The call was refused by a safety or account check. No call was placed. Details are " +
        "shown in the Hermes dashboard.",
      [MCP_ERROR_CODE.NOT_FOUND]:
        "No call with this ID was found for your account. list_calls shows the recent calls.",
      [MCP_ERROR_CODE.NOT_PERMITTED]: "This action is not available for your Hermes account.",
      [MCP_ERROR_CODE.REQUEST_REJECTED]:
        "The request was rejected. Please check the input and try again.",
    }),
    denials: MCP_DENIAL_TEXTS.en,
    emptyCalls: "No calls yet.",
    emptyInbox: "No new calls.",
    inboxSummaryUnavailable: "Summary unavailable (technical error).",
    emptyCalendar: "Calendar is empty.",
    callStillRunning: "Call is still running. Please poll get_call_status and try again later.",
    // P5b (O-27 Teil 2, W4): description, not an instruction - names the precondition
    // instead of demanding a host security setting.
    consultPermissionHint:
      "Note: live questions during the call only reach this chat if the connector's tool " +
      "permission is granted.",
    callAlreadyRunningHint:
      "This call was already running - the running call is returned, no second call was started.",
    consultAnswerAccepted: (n) => `${n} detail(s) passed on to the call.`,
    consultAckAccepted: "Consult acknowledged - the answer is expected next.",
    consultAnswerRejected:
      "Answer rejected (format or length). The question stays open - please answer more briefly.",
    consultNoLongerOpen: "This question is no longer open (already answered or the call ended).",
    emptyActionItems: "No open action items.",
    appointmentPrefix: "(Appointment) ",
    calendarLine: ({ title, start, end }) => `${title}: ${start} to ${end}`,
    agentStatus: Object.freeze({
      number: "Agent number",
      owner: "Owner",
      calls: "Calls so far",
      permissions: "Permissions",
      planUsage: (percent) => `Monthly usage: ${percent}% of your included minutes`,
      planUsageUnknown: "Monthly usage: no plan quota on file",
    }),
    callFailedSummary: makeCallFailedSummary("The call did not go through.", FAILURE_REASON_TEXTS.en),
  }),
  fr: Object.freeze({
    roleAgent: "Agent",
    roleCounterparty: "Interlocuteur",
    permissionLabels: Object.freeze({
      summaries: "Résumés",
      personalData: "DonnéesPersonnelles",
      bankData: "DonnéesBancaires",
    }),
    errors: Object.freeze({
      [MCP_ERROR_CODE.UPSTREAM_INVALID]:
        "L'agent téléphonique n'a pas renvoyé de réponse valide. Veuillez réessayer plus tard.",
      [MCP_ERROR_CODE.UPSTREAM_INCOMPLETE]:
        "L'agent téléphonique a renvoyé une réponse incomplète. Veuillez réessayer plus tard.",
      [MCP_ERROR_CODE.UPSTREAM_UNREACHABLE]:
        "L'agent téléphonique est actuellement injoignable. Veuillez réessayer plus tard.",
      [MCP_ERROR_CODE.CALL_START_UNCONFIRMED]:
        "Délai dépassé au démarrage de l'appel - l'appel est peut-être déjà en cours. Un nouvel " +
        "appel à place_call vers le même numéro renvoie l'appel en cours au lieu d'en démarrer un second.",
      [MCP_ERROR_CODE.HOP_TIMEOUT]:
        "Délai dépassé en attendant une réponse - l'action a peut-être quand même été exécutée. " +
        "Veuillez vérifier l'état actuel plutôt que de répéter l'action à l'aveugle.",
      [MCP_ERROR_CODE.NO_TENANT_LINKED]:
        "Aucun compte Hermes n'est lié à cette connexion. Veuillez vous reconnecter avec le compte " +
        "que vous utilisez pour Hermes. Sans compte Hermes, cet outil n'est pas disponible.",
      [MCP_ERROR_CODE.DENIAL_UNKNOWN]:
        "L'appel a été refusé par un contrôle de sécurité ou de compte. Aucun appel n'a été " +
        "passé. Les détails sont affichés dans le tableau de bord Hermes.",
      [MCP_ERROR_CODE.NOT_FOUND]:
        "Aucun appel avec cet identifiant n'a été trouvé pour ce compte. list_calls affiche " +
        "les appels récents.",
      [MCP_ERROR_CODE.NOT_PERMITTED]: "Cette action n'est pas disponible pour ce compte Hermes.",
      [MCP_ERROR_CODE.REQUEST_REJECTED]:
        "La demande a été rejetée. Veuillez vérifier la saisie et réessayer.",
    }),
    denials: MCP_DENIAL_TEXTS.fr,
    emptyCalls: "Aucun appel pour le moment.",
    emptyInbox: "Aucun nouvel appel.",
    inboxSummaryUnavailable: "Résumé indisponible (erreur technique).",
    emptyCalendar: "L'agenda est vide.",
    callStillRunning:
      "L'appel est encore en cours. Veuillez interroger get_call_status et réessayer plus tard.",
    // P5b (O-27 Teil 2, W4): Beschreibung statt Aufforderung, wie bei den Fassungen
    // oben - nennt die Voraussetzung, statt eine Host-Sicherheitseinstellung einzufordern.
    consultPermissionHint:
      "Remarque : les questions en direct pendant l'appel n'arrivent dans cette " +
      "conversation que si l'autorisation d'outil du connecteur est accordée.",
    callAlreadyRunningHint:
      "Cet appel était déjà en cours - l'appel en cours est renvoyé, aucun second appel n'a été lancé.",
    consultAnswerAccepted: (n) => `${n} information(s) transmise(s) à l'appel.`,
    consultAckAccepted: "Question accusée de réception - la réponse est attendue.",
    consultAnswerRejected:
      "Réponse rejetée (format ou longueur). La question reste ouverte - veuillez répondre plus brièvement.",
    consultNoLongerOpen:
      "Cette question n'est plus ouverte (déjà répondue ou appel terminé).",
    emptyActionItems: "Aucune action en attente.",
    appointmentPrefix: "(Rendez-vous) ",
    calendarLine: ({ title, start, end }) => `${title} : ${start} à ${end}`,
    agentStatus: Object.freeze({
      number: "Numéro de l'agent",
      owner: "Propriétaire",
      calls: "Appels jusqu'ici",
      permissions: "Autorisations",
      planUsage: (percent) => `Utilisation mensuelle : ${percent} % des minutes incluses`,
      planUsageUnknown: "Utilisation mensuelle : aucun forfait enregistré",
    }),
    callFailedSummary: makeCallFailedSummary("L'appel n'a pas abouti.", FAILURE_REASON_TEXTS.fr),
  }),
});
