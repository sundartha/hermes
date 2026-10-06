export const GATE_TEXTS = Object.freeze({
  de: Object.freeze({
    kycInsufficient:
      "Verifikation unzureichend (KYC) fuer Outbound-Anrufe. Bitte Identitaet bestaetigen.",
    subscriptionInactive: "Abo inaktiv (Tenant gesperrt). Outbound-Anrufe sind gesperrt.",
    billingHold: "Outbound gesperrt: Zahlungsproblem. Bitte Zahlungsmittel/Betreiber pruefen.",
    notAuthorized:
      "Outbound nicht freigegeben: kein aktives Abo / keine Verifikation fuer diesen Tenant.",
    deniedNumber: (to) =>
      `Nummer ${to} ist gesperrt (Notruf-/Premium-/Service-Nummer). Anruf verweigert.`,
    countryBlocked: (to) =>
      `Laendervorwahl von ${to} ist nicht erlaubt. Anruf verweigert.`,
    hourLimit: "Stundenlimit fuer Outbound-Anrufe erreicht. Bitte spaeter erneut.",
    perTargetLimit: "Wiederhol-Limit fuer dieses Ziel erreicht. Bitte spaeter erneut.",
    budgetCapReached: (spentEur, capEur) =>
      `Dein Budget-Limit ist erreicht: ${spentEur} von ${capEur} EUR verbraucht.`,
    budgetUnreadable:
      "Dein Budget ist gesperrt: der Verbrauchsstand ist nicht lesbar. Bitte Betreiber kontaktieren.",
    reserveOverRemaining: (missingEur, monthEnd) =>
      `Dieser Anruf passt nicht mehr in dein Budget: es fehlen ${missingEur} EUR. Aktueller Spend-Monat endet am ${monthEnd}.`,
    reserveExhausted: (missingEur, monthEnd) =>
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
    deniedNumber: (to) =>
      `Number ${to} is blocked (emergency/premium/service number). Call refused.`,
    countryBlocked: (to) =>
      `Country code of ${to} is not allowed. Call refused.`,
    hourLimit: "Hourly limit for outbound calls reached. Please try again later.",
    perTargetLimit: "Repeat limit for this destination reached. Please try again later.",
    budgetCapReached: (spentEur, capEur) =>
      `Your budget limit is reached: ${spentEur} of ${capEur} EUR used.`,
    budgetUnreadable:
      "Your budget is locked: the usage total is unreadable. Please contact the operator.",
    reserveOverRemaining: (missingEur, monthEnd) =>
      `This call no longer fits your budget: ${missingEur} EUR short. The current spend month ends on ${monthEnd}.`,
    reserveExhausted: (missingEur, monthEnd) =>
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
    deniedNumber: (to) =>
      `Le numéro ${to} est bloqué (numéro d'urgence/surtaxé/de service). Appel refusé.`,
    countryBlocked: (to) =>
      `L'indicatif pays de ${to} n'est pas autorisé. Appel refusé.`,
    hourLimit: "Limite horaire d'appels sortants atteinte. Veuillez réessayer plus tard.",
    perTargetLimit: "Limite de rappels pour cette destination atteinte. Veuillez réessayer plus tard.",
    budgetCapReached: (spentEur, capEur) =>
      `Votre limite de budget est atteinte : ${spentEur} sur ${capEur} EUR utilisés.`,
    budgetUnreadable:
      "Votre budget est bloqué : le montant consommé est illisible. Veuillez contacter l'exploitant.",
    reserveOverRemaining: (missingEur, monthEnd) =>
      `Cet appel ne tient plus dans votre budget : il manque ${missingEur} EUR. Le mois de dépense en cours se termine le ${monthEnd}.`,
    reserveExhausted: (missingEur, monthEnd) =>
      `Votre budget est épuisé : il manque ${missingEur} EUR. Le mois de dépense en cours se termine le ${monthEnd}.`,
  }),
});
