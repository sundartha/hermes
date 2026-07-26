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
    emptyCalendar: "Kalender ist leer.",
    callStillRunning:
      "Anruf laeuft noch. Bitte get_call_status pollen und spaeter erneut versuchen.",
    // Feldnamen des get_agent_status-Textblocks (P15/T3a). LABEL, wo der Wert nur
    // angehaengt wird; ZEILEN-Funktion, wo die Sprache die Wortstellung bestimmt
    // (Geld-/Monatszeilen). Die Betraege kommen fertig formatiert herein (costDigits +
    // Waehrungslabel) - keine Geld-/Formatlogik im Buendel.
    agentStatus: Object.freeze({
      number: "Agent-Nummer",
      owner: "Besitzer",
      voiceEngine: "Voice-Engine",
      model: "Modell",
      calls: "Calls bisher",
      permissions: "Berechtigungen",
      unknownMonth: "unbekannt",
      costLifetime: (spent, cap) =>
        `KI-Kosten gesamt (Lebenszeit): ${spent} von ${cap} eigenem Budget`,
      costSpendMonth: (monthKey, amount) => `KI-Kosten Spend-Monat ${monthKey}: ${amount}`,
      reserved: (amount) => `Aktuell reserviert: ${amount}`,
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
    emptyCalendar: "Calendar is empty.",
    callStillRunning:
      "Call is still running. Please poll get_call_status and try again later.",
    agentStatus: Object.freeze({
      number: "Agent number",
      owner: "Owner",
      voiceEngine: "Voice engine",
      model: "Model",
      calls: "Calls so far",
      permissions: "Permissions",
      unknownMonth: "unknown",
      costLifetime: (spent, cap) => `AI cost total (lifetime): ${spent} of ${cap} own budget`,
      costSpendMonth: (monthKey, amount) => `AI cost spend month ${monthKey}: ${amount}`,
      reserved: (amount) => `Currently reserved: ${amount}`,
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
    emptyCalendar: "L'agenda est vide.",
    callStillRunning:
      "L'appel est encore en cours. Veuillez interroger get_call_status et réessayer plus tard.",
    agentStatus: Object.freeze({
      number: "Numéro de l'agent",
      owner: "Propriétaire",
      voiceEngine: "Moteur vocal",
      model: "Modèle",
      calls: "Appels jusqu'ici",
      permissions: "Autorisations",
      unknownMonth: "inconnu",
      costLifetime: (spent, cap) => `Coût IA total (à vie) : ${spent} sur ${cap} de budget propre`,
      costSpendMonth: (monthKey, amount) => `Coût IA mois de dépense ${monthKey} : ${amount}`,
      reserved: (amount) => `Actuellement réservé : ${amount}`,
    }),
  }),
});
