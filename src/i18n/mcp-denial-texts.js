// T2-09 (O-13 Datenminimierung, O-20 kein Abo-/Upgrade-Flow an der MCP-Grenze): neutrale,
// sprachabhaengige Texte je Gate-Ablehnungsgrund. Der Grund selbst (Schluessel dieses
// Buendels) ist die interne Kennung aus src/telephony/outbound-gates.js (denialAudit) -
// GENAU diese Kennung, keine zweite Liste (Vollstaendigkeit prueft
// test/openai-t2-09-neutrale-fehlertexte.test.js gegen die Quelle). Die Texte selbst
// nennen NIE die Kennung, keinen Env-Namen, keine Zahl aus der Konfiguration und kein
// "HTTP <n>" - Zahlen (Restbudget, Datum) bleiben ausschliesslich im REST-`error`-Text
// bzw. im Hermes-Dashboard (Entscheidung 4 der Spec). Jeder Text sagt: was passiert ist,
// dass KEIN Anruf entstand, und was der Nutzer tun kann.
//
// GETRENNT von den gesprochenen Locale-Strings (Muster MCP_TEXTS/GATE_TEXTS, s. Kopf von
// mcp-texts.js): diese Texte werden NIE gesprochen, sondern als Tool-Fehlertext
// ausgeliefert - die deutschen Werte bleiben deshalb in der ASCII-Transliteration des
// Bestands. FR traegt Akzente, EN ist kuratiert.
//
// abo und allowlist teilen bewusst denselben Wortlaut (beide heissen fuer den Nutzer
// "dieses Konto darf gerade nicht anrufen"); budget_tenant und reserve_erschoepft teilen
// ebenfalls denselben Wortlaut (derselbe Sperrzustand, zwei interne Gate-Namen).
export const MCP_DENIAL_TEXTS = Object.freeze({
  de: Object.freeze({
    frozen:
      "Ausgehende Anrufe sind derzeit vom Hermes-Betreiber pausiert. Es wurde kein Anruf " +
      "gestartet. Bitte spaeter erneut versuchen.",
    tenant_unbekannt:
      "Diese Anmeldung ist mit keinem Hermes-Konto verknuepft, das Anrufe starten darf. Es " +
      "wurde kein Anruf gestartet. Bitte mit dem Hermes-Konto anmelden.",
    kyc:
      "Ausgehende Anrufe erfordern eine verifizierte Identitaet fuer dieses Hermes-Konto. Es " +
      "wurde kein Anruf gestartet. Bitte die Verifizierung im Hermes-Dashboard abschliessen.",
    keine_identitaet:
      "Fuer dieses Hermes-Konto ist kein Name fuer die Anruf-Offenlegung hinterlegt. Es wurde " +
      "kein Anruf gestartet. Bitte den Namen im Hermes-Dashboard eintragen.",
    denylist:
      "Diese Nummer kann nicht angerufen werden (Notruf-, Mehrwert- oder Servicenummer). Es " +
      "wurde kein Anruf gestartet.",
    format:
      "Die Zielnummer liegt nicht in einem gueltigen internationalen Format vor. Es wurde " +
      "kein Anruf gestartet.",
    land:
      "Anrufe in dieses Land sind fuer dieses Hermes-Konto nicht freigeschaltet. Es wurde " +
      "kein Anruf gestartet.",
    stundenlimit:
      "Das Stundenlimit fuer ausgehende Anrufe ist erreicht. Es wurde kein Anruf gestartet. " +
      "Bitte spaeter erneut versuchen.",
    ziel_limit:
      "Das Wiederholungslimit fuer dieses Ziel ist erreicht. Es wurde kein Anruf gestartet. " +
      "Bitte spaeter erneut versuchen.",
    abo:
      "Ausgehende Anrufe sind fuer dieses Hermes-Konto nicht freigeschaltet. Es wurde kein " +
      "Anruf gestartet. Bitte den Kontostatus im Hermes-Dashboard pruefen.",
    allowlist:
      "Ausgehende Anrufe sind fuer dieses Hermes-Konto nicht freigeschaltet. Es wurde kein " +
      "Anruf gestartet. Bitte den Kontostatus im Hermes-Dashboard pruefen.",
    billing_hold:
      "Ausgehende Anrufe sind wegen eines offenen Zahlungsproblems pausiert. Es wurde kein " +
      "Anruf gestartet. Bitte die Zahlungsdaten im Hermes-Dashboard pruefen.",
    keine_tenant_nummer:
      "Fuer dieses Hermes-Konto ist keine aktive Rufnummer zum Anrufen hinterlegt. Es wurde " +
      "kein Anruf gestartet. Bitte die Nummer im Hermes-Dashboard pruefen.",
    herkunft:
      "Die Hermes-Nummer dieses Kontos kann fuer dieses Zielland nicht verwendet werden. Es " +
      "wurde kein Anruf gestartet.",
    ani_not_owned:
      "Die Leitung fuer ausgehende Anrufe ist derzeit nicht verfuegbar. Es wurde kein Anruf " +
      "gestartet. Bitte spaeter erneut versuchen.",
    budget_tenant:
      "Die monatliche Kostengrenze dieses Kontos ist erreicht. Es wurde kein Anruf gestartet. " +
      "Details stehen im Hermes-Dashboard.",
    reserve_erschoepft:
      "Die monatliche Kostengrenze dieses Kontos ist erreicht. Es wurde kein Anruf gestartet. " +
      "Details stehen im Hermes-Dashboard.",
    reserve_ueber_rest:
      "Dieser Anruf passt nicht mehr in die verbleibende monatliche Kostengrenze. Es wurde " +
      "kein Anruf gestartet. Details stehen im Hermes-Dashboard.",
    minutes:
      "Die im aktuellen Abrechnungszeitraum inkludierten Gespraechsminuten sind aufgebraucht. " +
      "Es wurde kein Anruf gestartet. Mit der naechsten Abrechnungsperiode stehen wieder " +
      "Minuten zur Verfuegung.",
    reserve_error:
      "Der Anruf konnte nicht vorbereitet werden. Es wurde kein Anruf gestartet. Bitte " +
      "erneut versuchen.",
    gate_error:
      "Die Sicherheitspruefung konnte gerade nicht abgeschlossen werden. Es wurde kein Anruf " +
      "gestartet. Bitte spaeter erneut versuchen.",
  }),
  en: Object.freeze({
    frozen:
      "Outbound calls are temporarily paused by the Hermes operator. No call was placed. " +
      "Please try again later.",
    tenant_unbekannt:
      "This sign-in is not linked to a Hermes account that may place calls. No call was " +
      "placed. Please sign in with your Hermes account.",
    kyc:
      "Outbound calls require a verified identity for your Hermes account. No call was " +
      "placed. Please complete the verification in the Hermes dashboard.",
    keine_identitaet:
      "Your Hermes account has no registered name for the call disclosure. No call was " +
      "placed. Please add your name in the Hermes dashboard.",
    denylist:
      "This number cannot be called (emergency, premium-rate or service number). No call " +
      "was placed.",
    format: "The destination number is not in a valid international format. No call was placed.",
    land: "Calls to this country are not enabled for your Hermes account. No call was placed.",
    stundenlimit:
      "The hourly limit for outbound calls has been reached. No call was placed. Please " +
      "try again later.",
    ziel_limit:
      "The repeat limit for this destination has been reached. No call was placed. Please " +
      "try again later.",
    abo:
      "Outbound calls are not enabled for your Hermes account. No call was placed. Please " +
      "check your account status in the Hermes dashboard.",
    allowlist:
      "Outbound calls are not enabled for your Hermes account. No call was placed. Please " +
      "check your account status in the Hermes dashboard.",
    billing_hold:
      "Outbound calls are on hold because of an open payment issue. No call was placed. " +
      "Please check your payment details in the Hermes dashboard.",
    keine_tenant_nummer:
      "Your Hermes account has no active phone number to call from. No call was placed. " +
      "Please check your number in the Hermes dashboard.",
    herkunft:
      "Your Hermes number cannot be used to call this destination country. No call was placed.",
    ani_not_owned:
      "The line for outgoing calls is temporarily unavailable. No call was placed. Please " +
      "try again later.",
    budget_tenant:
      "Your monthly cost limit has been reached. No call was placed. Details are shown in " +
      "the Hermes dashboard.",
    reserve_erschoepft:
      "Your monthly cost limit has been reached. No call was placed. Details are shown in " +
      "the Hermes dashboard.",
    reserve_ueber_rest:
      "This call does not fit into the remaining monthly cost limit. No call was placed. " +
      "Details are shown in the Hermes dashboard.",
    minutes:
      "The call minutes included for the current billing period are used up. No call was " +
      "placed. More minutes become available when the next billing period starts.",
    reserve_error: "The call could not be prepared. No call was placed. Please try again.",
    gate_error:
      "The safety check could not be completed right now. No call was placed. Please try " +
      "again later.",
  }),
  fr: Object.freeze({
    frozen:
      "Les appels sortants sont temporairement suspendus par l'opérateur Hermes. Aucun " +
      "appel n'a été passé. Veuillez réessayer plus tard.",
    tenant_unbekannt:
      "Cette connexion n'est associée à aucun compte Hermes autorisé à passer des appels. " +
      "Aucun appel n'a été passé. Veuillez vous connecter avec votre compte Hermes.",
    kyc:
      "Les appels sortants nécessitent une identité vérifiée pour ce compte Hermes. Aucun " +
      "appel n'a été passé. Veuillez terminer la vérification dans le tableau de bord Hermes.",
    keine_identitaet:
      "Aucun nom n'est enregistré pour ce compte Hermes pour l'annonce de l'appel. Aucun " +
      "appel n'a été passé. Veuillez ajouter votre nom dans le tableau de bord Hermes.",
    denylist:
      "Ce numéro ne peut pas être appelé (numéro d'urgence, à taxation spéciale ou de " +
      "service). Aucun appel n'a été passé.",
    format:
      "Le numéro de destination n'est pas dans un format international valide. Aucun appel " +
      "n'a été passé.",
    land:
      "Les appels vers ce pays ne sont pas activés pour ce compte Hermes. Aucun appel n'a " +
      "été passé.",
    stundenlimit:
      "La limite horaire d'appels sortants est atteinte. Aucun appel n'a été passé. " +
      "Veuillez réessayer plus tard.",
    ziel_limit:
      "La limite de répétition pour cette destination est atteinte. Aucun appel n'a été " +
      "passé. Veuillez réessayer plus tard.",
    abo:
      "Les appels sortants ne sont pas activés pour ce compte Hermes. Aucun appel n'a été " +
      "passé. Veuillez vérifier l'état du compte dans le tableau de bord Hermes.",
    allowlist:
      "Les appels sortants ne sont pas activés pour ce compte Hermes. Aucun appel n'a été " +
      "passé. Veuillez vérifier l'état du compte dans le tableau de bord Hermes.",
    billing_hold:
      "Les appels sortants sont suspendus en raison d'un problème de paiement en cours. " +
      "Aucun appel n'a été passé. Veuillez vérifier vos informations de paiement dans le " +
      "tableau de bord Hermes.",
    keine_tenant_nummer:
      "Ce compte Hermes n'a pas de numéro de téléphone actif pour appeler. Aucun appel n'a " +
      "été passé. Veuillez vérifier votre numéro dans le tableau de bord Hermes.",
    herkunft:
      "Le numéro Hermes de ce compte ne peut pas être utilisé pour appeler ce pays de " +
      "destination. Aucun appel n'a été passé.",
    ani_not_owned:
      "La ligne pour les appels sortants est temporairement indisponible. Aucun appel n'a " +
      "été passé. Veuillez réessayer plus tard.",
    budget_tenant:
      "La limite de coût mensuelle de ce compte est atteinte. Aucun appel n'a été passé. " +
      "Les détails sont affichés dans le tableau de bord Hermes.",
    reserve_erschoepft:
      "La limite de coût mensuelle de ce compte est atteinte. Aucun appel n'a été passé. " +
      "Les détails sont affichés dans le tableau de bord Hermes.",
    reserve_ueber_rest:
      "Cet appel dépasse la limite de coût mensuelle restante. Aucun appel n'a été passé. " +
      "Les détails sont affichés dans le tableau de bord Hermes.",
    minutes:
      "Les minutes d'appel incluses pour la période de facturation en cours sont épuisées. " +
      "Aucun appel n'a été passé. De nouvelles minutes seront disponibles à la prochaine " +
      "période de facturation.",
    reserve_error: "L'appel n'a pas pu être préparé. Aucun appel n'a été passé. Veuillez réessayer.",
    gate_error:
      "Le contrôle de sécurité n'a pas pu être terminé pour le moment. Aucun appel n'a été " +
      "passé. Veuillez réessayer plus tard.",
  }),
});
