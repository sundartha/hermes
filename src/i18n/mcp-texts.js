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
  // elevenlabs/convai.js). KORRIGIERT (T2-13-Nachbesserung, Safety-Review): der Text riet
  // frueher zu einem erneuten place_call an dieselbe Nummer (die POST /api/calls-Dedup
  // haette den laufenden Anruf zurueckgeliefert). Seit T2-13 verbraucht confirmAndConsume
  // den Bestaetigungscode VOR diesem Hop - ein erneuter place_call mit demselben Code
  // erreicht die Dedup gar nicht mehr, er scheitert IMMER an confirmationRequired. Der
  // Text verweist deshalb jetzt auf list_calls/get_call_status statt auf einen Retry.
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
  // T2-09-Nachbesserung (Safety-Review-Befund mcp-tools.js:435): der Anrufstart selbst
  // ist bei einem 5xx OHNE bekannten Ablehnungsgrund (Originate/Provider-Ablehnung,
  // api-calls.js originate-catch) KEIN "vorruebergehend nicht erreichbar" - der Anruf-
  // Datensatz existiert bereits (endFailedCallWithReason lief), ein Retry legt einen
  // WEITEREN Anruf-Datensatz samt Reservierung an. Anders als UPSTREAM_UNREACHABLE laedt
  // dieser Text NICHT zum sofortigen Wiederholen ein, sondern verweist auf list_calls -
  // derselbe Retry-Vorsicht-Wortlaut wie CALL_START_UNCONFIRMED/HOP_TIMEOUT oben.
  CALL_START_REJECTED: "call_start_rejected",
  // T2-13 (N-10): das Betriebsgeheimnis des Bestaetigungs-Codes fehlt (CALL_CONFIRMATION_
  // SECRET leer, POST /api/call-confirmations antwortet 503 reason=confirmation_unavailable).
  // Neutraler Text, NIE der Env-Name oder ein Secret-Hinweis (Regel 4).
  CONFIRMATION_UNAVAILABLE: "confirmation_unavailable",
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
        "Zeitablauf beim Anrufstart - der Anruf kann bereits laufen. Der Bestaetigungscode ist " +
        "jetzt verbraucht: KEIN erneuter place_call mit diesem Code (er wird abgelehnt). " +
        "Stattdessen list_calls oder get_call_status abfragen, um den aktuellen Stand zu sehen.",
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
      [MCP_ERROR_CODE.CALL_START_REJECTED]:
        "Der Anruf konnte nicht gestartet werden. Bitte den Status in list_calls pruefen, " +
        "bevor erneut angerufen wird.",
      [MCP_ERROR_CODE.CONFIRMATION_UNAVAILABLE]:
        "Der Bestaetigungsdienst ist derzeit nicht verfuegbar. Es wurde kein Anruf gestartet.",
    }),
    // T2-09: Ablehnungstexte je Gate-Grund (s. mcp-denial-texts.js), EINE Quelle je Sprache.
    denials: MCP_DENIAL_TEXTS.de,
    // T2-13 (N-10): place_call ohne gueltigen confirmation_code - der Anruf wurde NICHT
    // gewaehlt (kein Datensatz, keine Kosten). to/objective sind bereits normalisiert bzw.
    // wie eingegeben (dieselben Werte, die auch die Vorschau zeigt). "Host ohne Karte"
    // wortwoertlich, s. Spec-Abschnitt 2 Punkt 4: ein Host ohne Kartenfaehigkeit bekommt nie
    // einen Code und kann darum nie bestaetigen.
    // KORRIGIERT (Safety-Review T2-13): alle drei Texte richten sich an das MODELL. Sie
    // durften es nie anleiten, den Code selbst in der Karte zu "pruefen" (= sich selbst zu
    // bestaetigen) - bestaetigen tut der NUTZER, die Karte sendet den Code.
    // KORRIGIERT (T2-14-Nachbesserung, Safety-Review): "sendet die Karte den
    // Bestaetigungscode" liess offen, WOHIN - das Modell haette annehmen koennen, es
    // bekaeme ihn selbst. Die Karte waehlt fuer den bestaetigten Anruf SELBST (Klick ->
    // place_call ueber die Host-Bruecke); das Modell ruft place_call fuer diesen Anruf nicht
    // auf und erhaelt die call_id per Chat-Nachricht der Karte. Dieser Text erscheint jetzt
    // auch der KARTE selbst bei einer Ablehnung (isError -> content[0].text, s.
    // src/ui/widgets/call.html serverRejectionText) - er muss also fuer beide Adressaten
    // verstaendlich bleiben.
    // T2-14-Nachbesserung: place_call mit einem Code, den dieser Mandant schon verbraucht hat
    // (Karte neu geladen, Doppel-Zustellung). Der Anruf dazu wurde schon abgeschickt - kein
    // "noch nicht bestaetigt", kein Retry-Rat. Nennt weder Code noch Ziel.
    confirmationAlreadyUsed:
      "Dieser Bestaetigungscode wurde bereits verwendet - der Anruf dazu wurde schon " +
      "abgeschickt. place_call dafuer nicht erneut aufrufen; den Stand mit list_calls oder " +
      "get_call_status pruefen. Fuer einen weiteren Anruf neu mit prepare_call vorbereiten.",
    confirmationRequired: (to, objective) =>
      `Dieser Anruf ist noch nicht bestaetigt (Ziel: ${to}, Anliegen: ${objective}). Der ` +
      "Nutzer muss ihn in der Hermes-Karte bestaetigen; bestaetigt er, waehlt die Karte " +
      "selbst mit ihrem Bestaetigungscode - diesen Code gibt es sonst nirgends, nie einen " +
      "Code raten oder erfinden. Wurde danach ein Argument geaendert (auch briefing oder " +
      "context), neu mit prepare_call vorbereiten - ein Host ohne Karte kann nicht waehlen.",
    // T2-13: prepare_call bei MCP_UI_ENABLED=false (der einzige Schalter, der das
    // entscheidet - keine Erkennung einzelner Hosts, s. Korrektur in PLAN-SECURITY.md
    // Abschnitt OpenAI-T2-13) - ein Code wird zwar serverseitig ausgestellt, aber an
    // KEINEN Client weitergereicht (Plan Abschnitt 5, "Weg ohne Karte" ist bewusst
    // ausgeschlossen). Der Text nennt deshalb den SERVER-Schalter, keine Host-Eigenschaft.
    prepareCallNoCardHint:
      "Vorschau erstellt. Die Kartenbestaetigung ist auf diesem Server ausgeschaltet - es " +
      "gibt keinen Bestaetigungscode, place_call kann hier keinen Anruf ausloesen. Das dem " +
      "Nutzer ehrlich sagen.",
    // Bei MCP_UI_ENABLED=true - der Server weiss NICHT, ob dieser Host die Karte zeigt;
    // der letzte Satz deckt den Host ohne Karte ehrlich ab.
    // KORRIGIERT (T2-14-Nachbesserung, Safety-Review): s. Kommentar bei confirmationRequired
    // - "Vorher place_call nicht aufrufen" implizierte, das Modell riefe es SPAETER selbst
    // auf. Die Karte ruft place_call fuer den bestaetigten Anruf komplett selbst auf.
    prepareCallCardHint:
      "Vorschau erstellt. Der Nutzer prueft und bestaetigt den Anruf in der Hermes-Karte; " +
      "bestaetigt er, waehlt die Karte selbst mit ihrem Bestaetigungscode. Ruf place_call " +
      "fuer diesen Anruf nicht selbst auf und nie einen Code raten oder erfinden; die Karte " +
      "meldet die call_id danach per Chat-Nachricht. Zeigt dieser Host keine Hermes-Karte, kann " +
      "hier kein Anruf ausgeloest werden - das dem Nutzer ehrlich sagen.",
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
    // Stufe-0-Zeilenbausteine (P10/MCP-14): tenant-sichtbarer Text von list_action_items.
    // Er stand bis hierher als deutsches Literal in mcp-tools.js - in einer Oberflaeche,
    // deren Weltdefault "en" ist. DE bleibt byte-identisch zum Bestand, inklusive des
    // abschliessenden Leerzeichens im Praefix.
    emptyActionItems: "Keine offenen Action Items.",
    appointmentPrefix: "(Termin) ",
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
        "Timed out while starting the call - the call may already be running. The confirmation " +
        "code is now consumed: do NOT call place_call again with this code (it will be rejected). " +
        "Check list_calls or get_call_status instead to see the current state.",
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
      [MCP_ERROR_CODE.CALL_START_REJECTED]:
        "The call could not be started. Please check the status with list_calls before " +
        "calling again.",
      [MCP_ERROR_CODE.CONFIRMATION_UNAVAILABLE]:
        "The confirmation service is currently unavailable. No call was started.",
    }),
    denials: MCP_DENIAL_TEXTS.en,
    // T2-13 (N-10): place_call without a valid confirmation_code - no call was placed (no
    // record, no cost). A host without a card never receives a code and can therefore never
    // confirm.
    // KORRIGIERT (T2-14-Nachbesserung, Safety-Review): s. the DE comment above
    // confirmationRequired - the card places a confirmed call itself, the model never gets
    // the code. This text also renders inside the card itself on a rejection (isError ->
    // content[0].text, s. src/ui/widgets/call.html serverRejectionText).
    // T2-14 follow-up: place_call with a code this tenant already used (card reloaded,
    // duplicate delivery). Its call was already sent - never "not confirmed yet", never a
    // retry hint. Names neither the code nor the destination.
    confirmationAlreadyUsed:
      "This confirmation code was already used - its call was already sent. Do not call " +
      "place_call for it again; check list_calls or get_call_status. For another call, " +
      "call prepare_call again.",
    confirmationRequired: (to, objective) =>
      `This call is not confirmed yet (destination: ${to}, purpose: ${objective}). The ` +
      "user must confirm it in the Hermes card; once confirmed, the card places the call " +
      "itself with its own confirmation code - never guess or invent one. If any argument " +
      "changed since (briefing or context included), call prepare_call again - a host " +
      "without a card cannot place calls.",
    prepareCallNoCardHint:
      "Preview created. Card confirmation is switched off on this server - there is no " +
      "confirmation code, and place_call cannot place a call here. Tell the user so honestly.",
    prepareCallCardHint:
      "Preview created. The user reviews and confirms this call in the Hermes card; if " +
      "they confirm, the card places the call itself - do not call place_call for that " +
      "call yourself, and never guess or invent a code. The card reports the call_id back " +
      "in a chat message once it is placed. If this host does not show the Hermes card, " +
      "no call can be placed from here - tell the user so honestly.",
    emptyCalls: "No calls yet.",
    emptyInbox: "No new calls.",
    inboxSummaryUnavailable: "Summary unavailable (technical error).",
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
        "Délai dépassé au démarrage de l'appel - l'appel est peut-être déjà en cours. Le code de " +
        "confirmation est maintenant consommé : NE PAS rappeler place_call avec ce code (il sera " +
        "refusé). Consultez plutôt list_calls ou get_call_status pour voir l'état actuel.",
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
      [MCP_ERROR_CODE.CALL_START_REJECTED]:
        "L'appel n'a pas pu être démarré. Veuillez vérifier l'état dans list_calls avant " +
        "de rappeler.",
      [MCP_ERROR_CODE.CONFIRMATION_UNAVAILABLE]:
        "Le service de confirmation est actuellement indisponible. Aucun appel n'a été démarré.",
    }),
    denials: MCP_DENIAL_TEXTS.fr,
    // T2-13 (N-10): place_call sans confirmation_code valide - aucun appel n'a été passé.
    // KORRIGIERT (T2-14-Nachbesserung, Safety-Review) : voir le commentaire DE au-dessus de
    // confirmationRequired - c'est la carte qui passe l'appel confirmé elle-même, le modèle
    // ne reçoit jamais le code. Ce texte s'affiche aussi dans la carte elle-même en cas de
    // refus (isError -> content[0].text, s. src/ui/widgets/call.html serverRejectionText).
    // T2-14 suivi : place_call avec un code deja utilise par ce locataire (carte rechargee,
    // double livraison). Son appel a deja ete envoye - jamais "pas encore confirme", jamais
    // de conseil de reessai. Ne nomme ni le code ni la destination.
    confirmationAlreadyUsed:
      "Ce code de confirmation a déjà été utilisé - son appel a déjà été envoyé. " +
      "N'appelez pas à nouveau place_call pour lui ; vérifiez list_calls ou get_call_status. " +
      "Pour un autre appel, rappelez prepare_call.",
    confirmationRequired: (to, objective) =>
      `Cet appel n'est pas encore confirmé (destination : ${to}, objet : ${objective}). ` +
      "L'utilisateur doit le confirmer dans la carte Hermes ; une fois confirmé, la carte " +
      "passe l'appel elle-même avec son propre code de confirmation - ne devinez ni " +
      "n'inventez jamais de code. Si un argument a changé depuis (briefing ou context " +
      "compris), rappelez prepare_call - un hôte sans carte ne peut pas passer d'appel.",
    prepareCallNoCardHint:
      "Aperçu créé. La confirmation par carte est désactivée sur ce serveur - il n'y a pas " +
      "de code de confirmation, et place_call ne peut pas passer d'appel ici. Dites-le " +
      "honnêtement à l'utilisateur.",
    prepareCallCardHint:
      "Aperçu créé. L'utilisateur vérifie et confirme cet appel dans la carte Hermes ; s'il " +
      "confirme, la carte passe l'appel elle-même - n'appelez pas place_call vous-même pour " +
      "cet appel, et ne devinez ni n'inventez jamais de code. La carte signale la call_id " +
      "dans un message de chat une fois l'appel passé. Si cet hôte n'affiche pas la carte " +
      "Hermes, aucun appel ne peut être passé d'ici - dites-le honnêtement à l'utilisateur.",
    emptyCalls: "Aucun appel pour le moment.",
    emptyInbox: "Aucun nouvel appel.",
    inboxSummaryUnavailable: "Résumé indisponible (erreur technique).",
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
