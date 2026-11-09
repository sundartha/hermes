import { FAILURE_REASON_TEXTS, makeCallFailedSummary } from "./failure-reason-texts.js";
import { MCP_DENIAL_TEXTS } from "./mcp-denial-texts.js";
import { AWAIT_SUMMARY } from "./platzhalter/warte-texte.js";

function countedText(lang, singular, plural) {
  return (count) => (new Intl.PluralRules(lang).select(count) === "one" ? singular(count) : plural(count));
}

export const MCP_ERROR_CODE = Object.freeze({
  UPSTREAM_INVALID: "upstream_invalid",
  UPSTREAM_INCOMPLETE: "upstream_incomplete",
  UPSTREAM_UNREACHABLE: "upstream_unreachable",
  CALL_START_UNCONFIRMED: "call_start_unconfirmed",
  HOP_TIMEOUT: "hop_timeout",
  NO_TENANT_LINKED: "no_tenant_linked",
  DENIAL_UNKNOWN: "denial_unknown",
  NOT_FOUND: "not_found",
  NOT_PERMITTED: "not_permitted",
  REQUEST_REJECTED: "request_rejected",
  TOO_MANY_REQUESTS: "too_many_requests",
  CALL_START_REJECTED: "call_start_rejected",
  RESTRICTED_PAYMENT_CARD: "restricted_payment_card",
  RESTRICTED_GOVERNMENT_ID: "restricted_government_id",
  RESTRICTED_CREDENTIAL: "restricted_credential",
});

export const MCP_TEXTS = Object.freeze({
  de: Object.freeze({
    roleAgent: "Agent",
    roleCounterparty: "Gegenseite",
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
        "Zeitablauf beim Anrufstart - der Anruf kann bereits laufen. KEIN erneuter place_call " +
        "ohne Pruefung: Stattdessen list_calls oder get_call_status abfragen, um den aktuellen " +
        "Stand zu sehen.",
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
      [MCP_ERROR_CODE.TOO_MANY_REQUESTS]:
        "Zu viele Anfragen in kurzer Zeit. Bitte in einer Minute erneut versuchen.",
      [MCP_ERROR_CODE.CALL_START_REJECTED]:
        "Der Anruf konnte nicht gestartet werden. Bitte den Status in list_calls pruefen, " +
        "bevor erneut angerufen wird.",
      [MCP_ERROR_CODE.RESTRICTED_PAYMENT_CARD]: (field) =>
        `Nicht gesendet: das Feld ${field} enthaelt offenbar eine Zahlungskartennummer. ` +
        "Hermes nimmt keine Zahlungskartendaten entgegen - bitte entfernen und erneut versuchen.",
      [MCP_ERROR_CODE.RESTRICTED_GOVERNMENT_ID]: (field) =>
        `Nicht gesendet: das Feld ${field} enthaelt offenbar eine behoerdliche Kennnummer ` +
        "(z.B. Sozialversicherungs-, Steuer- oder Ausweisnummer). Hermes nimmt solche " +
        "Nummern nicht entgegen - bitte entfernen und erneut versuchen.",
      [MCP_ERROR_CODE.RESTRICTED_CREDENTIAL]: (field) =>
        `Nicht gesendet: das Feld ${field} enthaelt offenbar Zugangsdaten (Passwort, PIN, ` +
        "Einmalcode, Schluessel oder Token). Hermes nimmt keine Zugangsdaten entgegen - " +
        "bitte entfernen und erneut versuchen.",
    }),
    denials: MCP_DENIAL_TEXTS.de,
    emptyCalls: "Noch keine Anrufe.",
    emptyInbox: "Keine neuen Anrufe.",
    inboxSummaryUnavailable: "Zusammenfassung nicht verfuegbar (technischer Fehler).",
    callStillRunning:
      "Anruf laeuft noch. Bitte get_call_status pollen und spaeter erneut versuchen.",
    awaitSummary: AWAIT_SUMMARY.de,
    consultPermissionHint:
      "Hinweis: Live-Rueckfragen waehrend des Anrufs erreichen diesen Chat nur, wenn die " +
      "Werkzeug-Berechtigung des Connectors erteilt ist.",
    callAlreadyRunningHint:
      "Dieser Anruf lief schon - zurueckgegeben wird der laufende Anruf, es wurde kein zweiter gestartet.",
    consultAnswerAccepted: countedText(
      "de",
      (count) => `${count} Angabe an den Anruf uebergeben.`,
      (count) => `${count} Angaben an den Anruf uebergeben.`,
    ),
    consultAckAccepted: "Rueckfrage quittiert - die Antwort wird erwartet.",
    consultAnswerRejected:
      "Antwort verworfen (Format oder Laenge). Die Rueckfrage bleibt offen - bitte kuerzer antworten.",
    consultNoLongerOpen: "Diese Rueckfrage ist nicht mehr offen (beantwortet oder Anruf vorbei).",
    emptyActionItems: "Keine offenen Action Items.",
    appointmentPrefix: "(Termin) ",
    agentStatus: Object.freeze({
      number: "Agent-Nummer",
      owner: "Besitzer",
      calls: "Calls bisher",
      permissions: "Berechtigungen",
      planUsage: (percent) => `Monatsnutzung: ${percent} % des Minuten-Kontingents`,
      planUsageUnknown: "Monatsnutzung: kein Kontingent hinterlegt",
    }),
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
        "Timed out while starting the call - the call may already be running. Do NOT call " +
        "place_call again blindly: check list_calls or get_call_status instead to see the " +
        "current state.",
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
      [MCP_ERROR_CODE.TOO_MANY_REQUESTS]:
        "Too many requests in a short time. Please try again in a minute.",
      [MCP_ERROR_CODE.CALL_START_REJECTED]:
        "The call could not be started. Please check the status with list_calls before " +
        "calling again.",
      [MCP_ERROR_CODE.RESTRICTED_PAYMENT_CARD]: (field) =>
        `Not sent: the field ${field} contains what looks like a payment card number. ` +
        "Hermes does not accept payment card data - remove it and try again.",
      [MCP_ERROR_CODE.RESTRICTED_GOVERNMENT_ID]: (field) =>
        `Not sent: the field ${field} contains what looks like a government identifier ` +
        "(such as a social security, tax, or passport number). Hermes does not accept such " +
        "numbers - remove it and try again.",
      [MCP_ERROR_CODE.RESTRICTED_CREDENTIAL]: (field) =>
        `Not sent: the field ${field} contains what looks like a credential (password, PIN, ` +
        "one-time code, key, or token). Hermes does not accept credentials - remove it and " +
        "try again.",
    }),
    denials: MCP_DENIAL_TEXTS.en,
    emptyCalls: "No calls yet.",
    emptyInbox: "No new calls.",
    inboxSummaryUnavailable: "Summary unavailable (technical error).",
    callStillRunning: "Call is still running. Please poll get_call_status and try again later.",
    awaitSummary: AWAIT_SUMMARY.en,
    consultPermissionHint:
      "Note: live questions during the call only reach this chat if the connector's tool " +
      "permission is granted.",
    callAlreadyRunningHint:
      "This call was already running - the running call is returned, no second call was started.",
    consultAnswerAccepted: countedText(
      "en",
      (count) => `${count} detail passed on to the call.`,
      (count) => `${count} details passed on to the call.`,
    ),
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
        "Délai dépassé au démarrage de l'appel - l'appel est peut-être déjà en cours. NE PAS " +
        "rappeler place_call à l'aveugle : consultez plutôt list_calls ou get_call_status pour " +
        "voir l'état actuel.",
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
      [MCP_ERROR_CODE.TOO_MANY_REQUESTS]:
        "Trop de demandes en peu de temps. Veuillez réessayer dans une minute.",
      [MCP_ERROR_CODE.CALL_START_REJECTED]:
        "L'appel n'a pas pu être démarré. Veuillez vérifier l'état dans list_calls avant " +
        "de rappeler.",
      [MCP_ERROR_CODE.RESTRICTED_PAYMENT_CARD]: (field) =>
        `Non envoyé : le champ ${field} semble contenir un numéro de carte de paiement. ` +
        "Hermes n'accepte pas les données de carte de paiement - veuillez le supprimer et réessayer.",
      [MCP_ERROR_CODE.RESTRICTED_GOVERNMENT_ID]: (field) =>
        `Non envoyé : le champ ${field} semble contenir un identifiant officiel (par exemple ` +
        "un numéro de sécurité sociale, fiscal ou de passeport). Hermes n'accepte pas ces " +
        "numéros - veuillez le supprimer et réessayer.",
      [MCP_ERROR_CODE.RESTRICTED_CREDENTIAL]: (field) =>
        `Non envoyé : le champ ${field} semble contenir des identifiants de connexion (mot de ` +
        "passe, code PIN, code à usage unique, clé ou jeton). Hermes n'accepte pas ces " +
        "identifiants - veuillez les supprimer et réessayer.",
    }),
    denials: MCP_DENIAL_TEXTS.fr,
    emptyCalls: "Aucun appel pour le moment.",
    emptyInbox: "Aucun nouvel appel.",
    inboxSummaryUnavailable: "Résumé indisponible (erreur technique).",
    callStillRunning:
      "L'appel est encore en cours. Veuillez interroger get_call_status et réessayer plus tard.",
    awaitSummary: AWAIT_SUMMARY.fr,
    consultPermissionHint:
      "Remarque : les questions en direct pendant l'appel n'arrivent dans cette " +
      "conversation que si l'autorisation d'outil du connecteur est accordée.",
    callAlreadyRunningHint:
      "Cet appel était déjà en cours - l'appel en cours est renvoyé, aucun second appel n'a été lancé.",
    consultAnswerAccepted: countedText(
      "fr",
      (count) => `${count} information transmise à l'appel.`,
      (count) => `${count} informations transmises à l'appel.`,
    ),
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
