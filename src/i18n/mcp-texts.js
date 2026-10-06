import { FAILURE_REASON_TEXTS, makeCallFailedSummary } from "./failure-reason-texts.js";
import { MCP_DENIAL_TEXTS } from "./mcp-denial-texts.js";

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
  CALL_START_REJECTED: "call_start_rejected",
  CONFIRMATION_UNAVAILABLE: "confirmation_unavailable",
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
    prepareCallNoCardHint:
      "Vorschau erstellt. Die Kartenbestaetigung ist auf diesem Server ausgeschaltet - es " +
      "gibt keinen Bestaetigungscode, place_call kann hier keinen Anruf ausloesen. Das dem " +
      "Nutzer ehrlich sagen.",
    prepareCallCardHint:
      "Vorschau erstellt. Der Nutzer prueft und bestaetigt den Anruf in der Hermes-Karte; " +
      "bestaetigt er, waehlt die Karte selbst mit ihrem Bestaetigungscode. Ruf place_call " +
      "fuer diesen Anruf nicht selbst auf und nie einen Code raten oder erfinden; die Karte " +
      "meldet die call_id danach per Chat-Nachricht. Zeigt dieser Host keine Hermes-Karte, kann " +
      "hier kein Anruf ausgeloest werden - das dem Nutzer ehrlich sagen.",
    callDataNotice:
      "Vor dem Bestätigen: Die Angaben auf dieser Karte gehen an den KI-Agenten und die " +
      "Anbieter, über die der Anruf läuft, können der angerufenen Person gesagt werden und " +
      "werden mit dem Anruf gespeichert. Das gilt auch für besonders geschützte Angaben: " +
      "Gesundheitsangaben, rassische oder ethnische Herkunft, politische Meinungen, religiöse " +
      "oder weltanschauliche Überzeugungen, Gewerkschaftszugehörigkeit, genetische oder " +
      "biometrische Daten, Sexualleben oder sexuelle Orientierung. Gib solche Angaben nur an, " +
      "wenn dieser Anruf sie wirklich braucht. Hermes ist nicht für Telemarketing oder " +
      "unaufgeforderte Werbe-, Verkaufs-, Wahlkampf- oder Massenanrufe gedacht.",
    emptyCalls: "Noch keine Anrufe.",
    emptyInbox: "Keine neuen Anrufe.",
    inboxSummaryUnavailable: "Zusammenfassung nicht verfuegbar (technischer Fehler).",
    callStillRunning:
      "Anruf laeuft noch. Bitte get_call_status pollen und spaeter erneut versuchen.",
    consultPermissionHint:
      "Hinweis: Live-Rueckfragen waehrend des Anrufs erreichen diesen Chat nur, wenn die " +
      "Werkzeug-Berechtigung des Connectors erteilt ist.",
    callAlreadyRunningHint:
      "Dieser Anruf lief schon - zurueckgegeben wird der laufende Anruf, es wurde kein zweiter gestartet.",
    consultAnswerAccepted: (count) => `${count} Angabe(n) an den Anruf uebergeben.`,
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
    callDataNotice:
      "Before you confirm: the details on this card go to the AI agent and the providers that " +
      "run the call, may be told to the person you call, and are stored with the call record. " +
      "This also applies to special categories of data: health details, racial or ethnic " +
      "origin, political opinions, religious or philosophical beliefs, trade union membership, " +
      "genetic or biometric data, sex life or sexual orientation. Only include such details if " +
      "this call really needs them. Hermes is not meant for telemarketing or unsolicited " +
      "advertising, sales, political campaign or mass calls.",
    emptyCalls: "No calls yet.",
    emptyInbox: "No new calls.",
    inboxSummaryUnavailable: "Summary unavailable (technical error).",
    callStillRunning: "Call is still running. Please poll get_call_status and try again later.",
    consultPermissionHint:
      "Note: live questions during the call only reach this chat if the connector's tool " +
      "permission is granted.",
    callAlreadyRunningHint:
      "This call was already running - the running call is returned, no second call was started.",
    consultAnswerAccepted: (count) => `${count} detail(s) passed on to the call.`,
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
    callDataNotice:
      "Avant de confirmer : les informations de cette carte sont transmises à l'agent IA et " +
      "aux prestataires qui assurent l'appel, peuvent être communiquées à la personne appelée " +
      "et sont conservées avec l'appel. Cela vaut aussi pour les catégories particulières de " +
      "données : données de santé, origine raciale ou ethnique, opinions politiques, " +
      "convictions religieuses ou philosophiques, appartenance syndicale, données génétiques " +
      "ou biométriques, vie sexuelle ou orientation sexuelle. N'indiquez de telles informations " +
      "que si cet appel en a vraiment besoin. Hermes n'est pas destiné au télémarketing ni " +
      "aux appels publicitaires, commerciaux, de campagne politique ou de masse non sollicités.",
    emptyCalls: "Aucun appel pour le moment.",
    emptyInbox: "Aucun nouvel appel.",
    inboxSummaryUnavailable: "Résumé indisponible (erreur technique).",
    callStillRunning:
      "L'appel est encore en cours. Veuillez interroger get_call_status et réessayer plus tard.",
    consultPermissionHint:
      "Remarque : les questions en direct pendant l'appel n'arrivent dans cette " +
      "conversation que si l'autorisation d'outil du connecteur est accordée.",
    callAlreadyRunningHint:
      "Cet appel était déjà en cours - l'appel en cours est renvoyé, aucun second appel n'a été lancé.",
    consultAnswerAccepted: (count) => `${count} information(s) transmise(s) à l'appel.`,
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
