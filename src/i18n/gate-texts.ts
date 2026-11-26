export const GATE_TEXTS = Object.freeze({
  de: Object.freeze({
    kycInsufficient:
      "Verifikation unzureichend (KYC) fuer Outbound-Anrufe. Bitte Identitaet bestaetigen.",
    subscriptionInactive: "Abo inaktiv (Tenant gesperrt). Outbound-Anrufe sind gesperrt.",
    billingHold: "Outbound gesperrt: Zahlungsproblem. Bitte Zahlungsmittel/Betreiber pruefen.",
    notAuthorized:
      "Outbound nicht freigegeben: kein aktives Abo / keine Verifikation fuer diesen Tenant.",
    deniedNumber: (to: string) =>
      `Nummer ${to} ist gesperrt (Notruf-/Premium-/Service-Nummer). Anruf verweigert.`,
    countryBlocked: (to: string) =>
      `Laendervorwahl von ${to} ist nicht erlaubt. Anruf verweigert.`,
    hourLimit: "Stundenlimit fuer Outbound-Anrufe erreicht. Bitte spaeter erneut.",
    perTargetLimit: "Wiederhol-Limit fuer dieses Ziel erreicht. Bitte spaeter erneut.",
    atCapacity: "Hermes ist gerade ausgelastet. Bitte in wenigen Minuten erneut versuchen.",
    queueUnavailable: "Anruf konnte nicht angelegt werden. Es wurde nicht gewaehlt, es entstehen keine Kosten.",
    concurrentLimit:
      "Fuer dieses Hermes-Konto laufen bereits so viele Anrufe gleichzeitig wie erlaubt. Bitte warten, bis ein laufender Anruf endet.",
    budgetCapReached: (spentEur: string, capEur: string) =>
      `Dein Budget-Limit ist erreicht: ${spentEur} von ${capEur} EUR verbraucht.`,
    budgetUnreadable:
      "Dein Budget ist gesperrt: der Verbrauchsstand ist nicht lesbar. Bitte Betreiber kontaktieren.",
    reserveOverRemaining: (missingEur: string, monthEnd: string) =>
      `Dieser Anruf passt nicht mehr in dein Budget: es fehlen ${missingEur} EUR. Aktueller Spend-Monat endet am ${monthEnd}.`,
    reserveExhausted: (missingEur: string, monthEnd: string) =>
      `Dein Budget ist erschoepft: es fehlen ${missingEur} EUR. Aktueller Spend-Monat endet am ${monthEnd}.`,
  }),
  en: Object.freeze({
    kycInsufficient:
      "Verification insufficient (KYC) for outbound calls. Please confirm your identity.",
    subscriptionInactive: "Subscription inactive (account suspended). Outbound calls are blocked.",
    billingHold:
      "Outbound blocked: payment problem. Please check your payment method or contact the operator.",
    notAuthorized:
      "Outbound not authorised: no active subscription / no verification for this account.",
    deniedNumber: (to: string) =>
      `Number ${to} is blocked (emergency/premium/service number). Call refused.`,
    countryBlocked: (to: string) =>
      `Country code of ${to} is not allowed. Call refused.`,
    hourLimit: "Hourly limit for outbound calls reached. Please try again later.",
    perTargetLimit: "Repeat limit for this destination reached. Please try again later.",
    atCapacity: "Hermes is at capacity right now. Please try again in a few minutes.",
    queueUnavailable: "The call could not be created. No call was dialled and you will not be charged.",
    concurrentLimit:
      "This Hermes account already has as many calls running at once as allowed. Please wait until a running call ends.",
    budgetCapReached: (spentEur: string, capEur: string) =>
      `Your budget limit is reached: ${spentEur} of ${capEur} EUR used.`,
    budgetUnreadable:
      "Your budget is locked: the usage total is unreadable. Please contact the operator.",
    reserveOverRemaining: (missingEur: string, monthEnd: string) =>
      `This call no longer fits your budget: ${missingEur} EUR short. The current spend month ends on ${monthEnd}.`,
    reserveExhausted: (missingEur: string, monthEnd: string) =>
      `Your budget is exhausted: ${missingEur} EUR short. The current spend month ends on ${monthEnd}.`,
  }),
  fr: Object.freeze({
    kycInsufficient:
      "Vérification insuffisante (KYC) pour les appels sortants. Veuillez confirmer votre identité.",
    subscriptionInactive: "Abonnement inactif (compte suspendu). Les appels sortants sont bloqués.",
    billingHold:
      "Sortant bloqué : problème de paiement. Veuillez vérifier votre moyen de paiement ou contacter l'exploitant.",
    notAuthorized:
      "Sortant non autorisé : aucun abonnement actif / aucune vérification pour ce compte.",
    deniedNumber: (to: string) =>
      `Le numéro ${to} est bloqué (numéro d'urgence/surtaxé/de service). Appel refusé.`,
    countryBlocked: (to: string) =>
      `L'indicatif pays de ${to} n'est pas autorisé. Appel refusé.`,
    hourLimit: "Limite horaire d'appels sortants atteinte. Veuillez réessayer plus tard.",
    perTargetLimit: "Limite de rappels pour cette destination atteinte. Veuillez réessayer plus tard.",
    atCapacity: "Hermes est actuellement à pleine capacité. Veuillez réessayer dans quelques minutes.",
    queueUnavailable: "L'appel n'a pas pu être créé. Aucun numéro n'a été composé et aucun frais ne sera facturé.",
    concurrentLimit:
      "Ce compte Hermes a déjà atteint le nombre d'appels simultanés autorisé. Veuillez attendre la fin d'un appel en cours.",
    budgetCapReached: (spentEur: string, capEur: string) =>
      `Votre limite de budget est atteinte : ${spentEur} sur ${capEur} EUR utilisés.`,
    budgetUnreadable:
      "Votre budget est bloqué : le montant consommé est illisible. Veuillez contacter l'exploitant.",
    reserveOverRemaining: (missingEur: string, monthEnd: string) =>
      `Cet appel ne tient plus dans votre budget : il manque ${missingEur} EUR. Le mois de dépense en cours se termine le ${monthEnd}.`,
    reserveExhausted: (missingEur: string, monthEnd: string) =>
      `Votre budget est épuisé : il manque ${missingEur} EUR. Le mois de dépense en cours se termine le ${monthEnd}.`,
  }),
});
