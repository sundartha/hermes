// MCP-Textkanal (PLAN-I18N-FIX P12): die sprachabhaengigen Strings der MCP-Tool-Schicht,
// inklusive der Feldnamen der Berechtigungs-Zusammenfassung (P13).
// GETRENNT von den gesprochenen Locale-Strings: diese Texte werden NIE gesprochen,
// sondern als Chat-Text ausgeliefert - die deutschen Werte bleiben deshalb in der
// ASCII-Transliteration des Bestands (Repo-Konvention, wie summarySystem/realtimeOpener,
// s. Kopf von i18n/locales.js). Eingehaengt wird das Buendel in LOCALES.<lang>.mcp
// (Muster INBOUND_NOTICES), damit localeFor() DER EINE Sprach-Resolver bleibt und
// mcp-tools.js keinen zweiten Lookup braucht (G5).
//
// FR traegt Akzente (wie jeder FR-String im Bundle), EN ist kuratiert.

// Stabile, sprachneutrale Fehler-Kennungen (P12 Pre-Mortem 2). Der Wurf traegt den CODE,
// die Uebersetzung passiert an genau EINER Kante (wrapHandler in mcp-tools.js). Diese
// Werte sind Vertrag zwischen Wurf und Kante - KEIN Anzeigetext.
export const MCP_ERROR_CODE = Object.freeze({
  UPSTREAM_INVALID: "upstream_invalid",
  UPSTREAM_INCOMPLETE: "upstream_incomplete",
  UPSTREAM_UNREACHABLE: "upstream_unreachable",
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
    }),
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
    consultPermissionHint:
      "Hinweis: Falls waehrend des Anrufs keine Live-Rueckfragen ankommen, muss die " +
      "Werkzeug-Berechtigung des Connectors auf 'Zulassen' stehen.",
    consultAnswerAccepted: (n) => `${n} Angabe(n) an den Anruf uebergeben.`,
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
      voiceEngine: "Voice-Engine",
      model: "Modell",
      calls: "Calls bisher",
      permissions: "Berechtigungen",
      planUsage: (percent) => `Monatsnutzung: ${percent} % des Minuten-Kontingents`,
      planUsageUnknown: "Monatsnutzung: kein Kontingent hinterlegt",
    }),
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
    }),
    emptyCalls: "No calls yet.",
    emptyInbox: "No new calls.",
    inboxSummaryUnavailable: "Summary unavailable (technical error).",
    emptyCalendar: "Calendar is empty.",
    callStillRunning: "Call is still running. Please poll get_call_status and try again later.",
    consultPermissionHint:
      "Note: if no live questions arrive during the call, the connector's tool permission " +
      "needs to be set to 'Allow'.",
    consultAnswerAccepted: (n) => `${n} detail(s) passed on to the call.`,
    consultAnswerRejected:
      "Answer rejected (format or length). The question stays open - please answer more briefly.",
    consultNoLongerOpen: "This question is no longer open (already answered or the call ended).",
    emptyActionItems: "No open action items.",
    appointmentPrefix: "(Appointment) ",
    calendarLine: ({ title, start, end }) => `${title}: ${start} to ${end}`,
    agentStatus: Object.freeze({
      number: "Agent number",
      owner: "Owner",
      voiceEngine: "Voice engine",
      model: "Model",
      calls: "Calls so far",
      permissions: "Permissions",
      planUsage: (percent) => `Monthly usage: ${percent}% of your included minutes`,
      planUsageUnknown: "Monthly usage: no plan quota on file",
    }),
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
    }),
    emptyCalls: "Aucun appel pour le moment.",
    emptyInbox: "Aucun nouvel appel.",
    inboxSummaryUnavailable: "Résumé indisponible (erreur technique).",
    emptyCalendar: "L'agenda est vide.",
    callStillRunning:
      "L'appel est encore en cours. Veuillez interroger get_call_status et réessayer plus tard.",
    consultPermissionHint:
      "Remarque : si aucune question en direct n'arrive pendant l'appel, l'autorisation " +
      "d'outil du connecteur doit être réglée sur « Autoriser ».",
    consultAnswerAccepted: (n) => `${n} information(s) transmise(s) à l'appel.`,
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
      voiceEngine: "Moteur vocal",
      model: "Modèle",
      calls: "Appels jusqu'ici",
      permissions: "Autorisations",
      planUsage: (percent) => `Utilisation mensuelle : ${percent} % des minutes incluses`,
      planUsageUnknown: "Utilisation mensuelle : aucun forfait enregistré",
    }),
  }),
});
