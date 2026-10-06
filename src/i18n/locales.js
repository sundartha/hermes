import { DEFAULT_LANGUAGE, DEFAULT_GREETING } from "../store/defaults.js";
import { INBOUND_NOTICES } from "./inbound-notice.js";
import { PROMPT_DE } from "./prompts/de.js";
import { PROMPT_FR } from "./prompts/fr.js";
import { PROMPT_EN } from "./prompts/en.js";
import { MCP_TEXTS } from "./mcp-texts.js";
import { GATE_TEXTS } from "./gate-texts.js";
import { FAILURE_REASON_TEXTS, makeStatusBody } from "./failure-reason-texts.js";

const VOICE_PROFILE_DE = "de-female-neural";
const VOICE_PROFILE_FR = "fr-female-neural";
const VOICE_PROFILE_EN = "en-female-neural";

export const PERSONA_STYLE_IDS = Object.freeze(["warm-persoenlich", "formell-professionell"]);

const NEUTRAL_ADDRESS_CLAUSE_DE = "Sieze fremde Anrufer.";
const NEUTRAL_ADDRESS_CLAUSE_FR = "Vouvoie les interlocuteurs que tu ne connais pas.";
const NEUTRAL_ADDRESS_CLAUSE_EN = "Address unfamiliar callers politely.";

const STYLE_CLAUSES_DE = Object.freeze({
  "warm-persoenlich": "Triff einen warmen, persönlichen Ton und duze den Anrufer.",
  "formell-professionell": "Triff einen formellen, sachlichen Ton und sieze den Anrufer.",
});
const STYLE_CLAUSES_FR = Object.freeze({
  "warm-persoenlich": "Adopte un ton chaleureux et personnel et tutoie ton interlocuteur.",
  "formell-professionell": "Adopte un ton formel et neutre et vouvoie ton interlocuteur.",
});
const STYLE_CLAUSES_EN = Object.freeze({
  "warm-persoenlich": "Use a warm, personal tone and address the other person informally.",
  "formell-professionell": "Use a formal, neutral tone and address the other person politely.",
});

function makeStyleClause(clauses, neutralClause) {
  return (styleId) => clauses[styleId] || neutralClause;
}

const DISCLOSURE_OWNER_FALLBACK_DE = "meinem Auftraggeber";
const DISCLOSURE_OWNER_FALLBACK_FR = "mon mandant";
export const DISCLOSURE_OWNER_FALLBACK_EN = "its owner";

function makeDisclosure(satz, ownerFallback) {
  return (ownerName) => {
    const name = typeof ownerName === "string" ? ownerName.trim() : "";
    return satz(name || ownerFallback);
  };
}

const INBOUND_SELBSTVORSTELLUNG = Object.freeze({
  de: Object.freeze({ mitName: (name) => `der KI-Assistent von ${name}`, ohneName: "ein KI-Assistent" }),
  en: Object.freeze({ mitName: (name) => `${name}'s AI assistant`, ohneName: "an AI assistant" }),
  fr: Object.freeze({ mitName: (name) => `l'assistant IA de ${name}`, ohneName: "un assistant IA" }),
});
const INBOUND_NAME_SATZ_RAHMEN = Object.freeze({
  de: (wer) => `Hier ist ${wer}.`,
  en: (wer) => `This is ${wer}.`,
  fr: (wer) => `Ici ${wer}.`,
});
const INBOUND_GRUSS_SATZ_RAHMEN = Object.freeze({
  de: (wer) => `Hallo, hier ist ${wer}.`,
  en: (wer) => `Hello, this is ${wer}.`,
  fr: (wer) => `Bonjour, ici ${wer}.`,
});
const INBOUND_FEHLERTEIL = Object.freeze({
  de: "Es ist ein technischer Fehler aufgetreten, bitte rufen Sie später noch einmal an.",
  en: "A technical error has occurred, please call again later.",
  fr: "Une erreur technique est survenue, veuillez rappeler plus tard.",
});

const OWNER_OPENING_TEXTE = Object.freeze({
  de: (firstName) => `Hallo ${firstName}, hier ist dein KI-Assistent.`,
  en: (firstName) => `Hi ${firstName}, it's your AI assistant.`,
  fr: (firstName) => `Bonjour ${firstName}, c'est ton assistant IA.`,
});

const INBOUND_HINWEIS_SATZ = Object.freeze({
  de: "Das Gespräch wird transkribiert und zusammengefasst.",
  en: "This call is transcribed and summarised.",
  fr: "Cet appel est transcrit et résumé.",
});

const INBOUND_FRAGE = Object.freeze({
  de: "Wie kann ich helfen?",
  en: "How can I help?",
  fr: "Comment puis-je aider ?",
});

function makeInboundSelbstvorstellungsSatz(sprache, rahmen) {
  const { mitName, ohneName } = INBOUND_SELBSTVORSTELLUNG[sprache];
  return (ownerName) => {
    const name = typeof ownerName === "string" ? ownerName.trim() : "";
    return rahmen[sprache](name ? mitName(name) : ohneName);
  };
}
const makeInboundNameSatz = (sprache) => makeInboundSelbstvorstellungsSatz(sprache, INBOUND_NAME_SATZ_RAHMEN);
const makeInboundGrussSatz = (sprache) => makeInboundSelbstvorstellungsSatz(sprache, INBOUND_GRUSS_SATZ_RAHMEN);

const inboundEroeffnungsRest = (sprache) => `${INBOUND_HINWEIS_SATZ[sprache]} ${INBOUND_FRAGE[sprache]}`;

function makeInboundEroeffnung(sprache) {
  const gruss = makeInboundGrussSatz(sprache);
  return (ownerName) => `${gruss(ownerName)} ${inboundEroeffnungsRest(sprache)}`;
}

function makeInboundGrussSatzOwner(sprache) {
  return (firstName) => {
    const vorname = typeof firstName === "string" ? firstName.trim() : "";
    return vorname ? OWNER_OPENING_TEXTE[sprache](vorname) : "";
  };
}

function makeInboundEroeffnungOwner(sprache) {
  const kopf = makeInboundGrussSatzOwner(sprache);
  return (firstName) => {
    const satz = kopf(firstName);
    return satz ? `${satz} ${inboundEroeffnungsRest(sprache)}` : "";
  };
}

function makeInboundFehlersatz(sprache) {
  const nameSatz = makeInboundNameSatz(sprache);
  return (ownerName) => `${nameSatz(ownerName)} ${INBOUND_FEHLERTEIL[sprache]}`;
}

export const LOCALES = Object.freeze({
  de: Object.freeze({
    language: "de",
    dateLocale: "de-DE",
    sttLocale: "de-DE",
    voiceProfile: VOICE_PROFILE_DE,
    speechClause: "Nur natürlich gesprochenes Deutsch.",
    styleClause: makeStyleClause(STYLE_CLAUSES_DE, NEUTRAL_ADDRESS_CLAUSE_DE),
    bridgePhrase: (goal) =>
      /^ich\b/i.test(goal) ? `${goal}.` : `Es geht um Folgendes: ${goal}.`,
    openingQuestion: "Wie sieht es damit aus?",
    openingReasonFallback: "Ich rufe an, um ein kurzes Anliegen zu klären.",
    disclosure: makeDisclosure(
      (ownerName) =>
        `Guten Tag, hier spricht ein KI-Assistent im Auftrag von ${ownerName}. Das Gespräch wird für meinen Auftraggeber zusammengefasst.`,
      DISCLOSURE_OWNER_FALLBACK_DE,
    ),
    disclosureOwnerFallback: DISCLOSURE_OWNER_FALLBACK_DE,
    voicemailBody: (openingLine) =>
      `Ich hinterlasse diese Nachricht, weil niemand abgehoben hat. ${openingLine} Ich versuche es später noch einmal. Auf Wiederhören.`,
    ownerOpening: OWNER_OPENING_TEXTE.de,
    summarySystem: (owner) =>
      `Du fasst ein Telefonat des KI-Assistenten von ${owner} zusammen. Antworte NUR mit validem JSON: {"summary": "2-3 Saetze auf Deutsch", "actionItems": ["..."], "objective_achieved": true|false|"unclear", "outcome": "1 Satz", "commitments": ["..."], "counterparty_commitments": ["..."], "open_points": ["..."], "next_step": "..."|null, "facts": ["..."]}. Nenne in der summary konkrete Ergebnisse (vereinbartes Datum/Uhrzeit, Preis, Name der Kontaktperson), sofern im Transkript vorhanden, statt allgemeiner Umschreibungen. objective_achieved bewertet AUSSCHLIESSLICH den unter "Auftrag" genannten urspruenglichen Auftrag (bei Inbound-Calls: ob das Anliegen des Anrufers geloest wurde). Vom Assistenten oder Angerufenen selbst eroeffnete Nebenthemen (z.B. ein angebotener oder abgebrochener Termin-Folgeschritt) sind fuer diese Bewertung IRRELEVANT. true = der Auftrag wurde genug beantwortet, auch wenn der Anruf mitten in einem Folgeschritt endete; false = der Auftrag wurde klar nicht erreicht; "unclear" = aus dem Auftrag heraus echt nicht beurteilbar. Action Items nur, wenn ${owner} wirklich etwas tun muss (max. 3). Bereits fest gebuchte Termine sind KEIN Action Item. Ergebnis-Karte: outcome ist EIN Satz mit dem konkreten Ergebnis (vereinbartes Datum/Uhrzeit, Preis, Name) oder - wenn nichts erreicht wurde - woran es lag. commitments sind Zusagen, die der Assistent im Namen von ${owner} gemacht hat; counterparty_commitments sind Zusagen der Gegenstelle. open_points sind Fragen, die offen blieben. next_step ist der EINE naechste Schritt fuer ${owner}, sonst null. facts sind dauerhaft nuetzliche Angaben ueber die Gegenstelle (Oeffnungszeiten, Ansprechpartner, Preise). Jede Liste hoechstens 3 Eintraege, jeder Eintrag hoechstens 200 Zeichen. Erfinde nichts: fehlt eine Angabe im Transkript, bleibt die Liste leer bzw. das Feld null.`,
    summaryEvidenceClause:
      ' Ergaenze ausserdem "evidence": hoechstens 2 kurze, WOERTLICHE Zitate aus dem Transkript, die das Ergebnis belegen. Nur woertlich Gesagtes, nichts Zusammengefasstes.',
    llmDegradedSpeech:
      "Entschuldigung, ich kann Ihr Anliegen gerade nicht bearbeiten. Ich melde mich, sobald es wieder möglich ist. Auf Wiederhören.",
    turnErrorSpeech:
      "Entschuldigung, da ist ein technisches Problem aufgetreten. Bitte versuchen Sie es später erneut.",
    noSpeechReprompt: "Können Sie das bitte wiederholen?",
    noSpeechRepromptAgain: "Ich höre Sie leider immer noch nicht. Sind Sie noch in der Leitung?",
    noSpeechFarewell:
      "Ich kann Sie leider nicht hören. Ich versuche es später noch einmal. Auf Wiederhören.",
    capFarewellSpeech:
      "Ich muss das Gespräch jetzt leider beenden. Vielen Dank für Ihre Zeit. Auf Wiederhören.",
    budgetExhaustedHangup: "Das Demo-Budget ist aufgebraucht. Auf Wiederhören.",
    greetingDefault: DEFAULT_GREETING,
    inboundNotice: INBOUND_NOTICES.de,
    inboundGrussSatz: makeInboundGrussSatz("de"),
    inboundGrussSatzOwner: makeInboundGrussSatzOwner("de"),
    inboundHinweisSatz: INBOUND_HINWEIS_SATZ.de,
    inboundEroeffnung: makeInboundEroeffnung("de"),
    inboundEroeffnungOwner: makeInboundEroeffnungOwner("de"),
    inboundFehlersatz: makeInboundFehlersatz("de"),
    mcp: MCP_TEXTS.de,
    gates: GATE_TEXTS.de,
    greetingVariants: Object.freeze([
      "Guten Tag, Sie sprechen mit dem KI-Assistenten von {owner}. Ich nehme Ihre Nachricht für {owner} auf. Wie kann ich helfen?",
      "Hallo! Der KI-Assistent von {owner} hier. Wie kann ich Ihnen weiterhelfen?",
    ]),
    turnFallbackSpeech: {
      inbound: "Alles klar, vielen Dank für Ihren Anruf. Auf Wiederhören!",
      outbound: "Alles klar, vielen Dank für Ihre Zeit. Auf Wiederhören!",
    },
    consultFillerSpeech: "Einen kleinen Moment, ich prüfe das kurz. Sind Sie noch dran?",
    consultHoldSpeech: "Einen Moment noch, bitte. Ich bin gleich für Sie da.",
    prompt: PROMPT_DE,
    postCall: Object.freeze({
      cancelledTitle: "Anruf abgebrochen",
      failedTitle: "Anruf nicht zustande gekommen",
      statusBody: makeStatusBody("Status:", FAILURE_REASON_TEXTS.de),
      summaryTitle: "Neue Call Summary",
      subjectOutbound: (to) => `Anruf bei ${to}`,
      subjectInbound: (from) => `Anruf von ${from}`,
      actionItemsHeading: "Action Items:",
      mailTimeLabel: "Zeitpunkt:",
      mailDurationLabel: "Dauer:",
      notPlacedMailHint:
        "Der Fehler lag auf unserer Seite, nicht bei dir. Wir kuemmern uns darum; du kannst es spaeter erneut versuchen.",
      unsubscribeLinkLabel: "Abmelden:",
    }),
    newsletter: Object.freeze({
      confirmMailSubject: "Bestätigung: Anruf-Zusammenfassungen erhalten",
      confirmMailText: (ownerName, confirmUrl) =>
        `Hallo,\n\n${ownerName} hat diese E-Mail-Adresse eingetragen, um Anruf-Zusammenfassungen ` +
        `von Hermes zu erhalten. Bitte bestätige die Anmeldung über diesen Link:\n\n${confirmUrl}\n\n` +
        "Der Link ist 48 Stunden gültig. Wenn du das nicht warst, musst du nichts tun - " +
        "ohne Bestätigung wird die Adresse nicht verwendet.",
      confirmedPageTitle: "E-Mail bestätigt",
      confirmedPageBody: "Du erhältst ab jetzt Anruf-Zusammenfassungen.",
      invalidPageTitle: "Link ungültig",
      invalidPageBody: "Dieser Bestätigungslink ist ungültig oder abgelaufen.",
      unsubscribedPageTitle: "Abgemeldet",
      unsubscribedPageBody: "Du erhältst keine weiteren Anruf-Zusammenfassungen mehr.",
    }),
  }),
  fr: Object.freeze({
    language: "fr",
    dateLocale: "fr-FR",
    sttLocale: "fr-FR",
    voiceProfile: VOICE_PROFILE_FR,
    speechClause: "Réponds exclusivement en français parlé et naturel.",
    styleClause: makeStyleClause(STYLE_CLAUSES_FR, NEUTRAL_ADDRESS_CLAUSE_FR),
    bridgePhrase: (goal) =>
      /^(je\b|j')/i.test(goal) ? `${goal}.` : `Voici l'objet de mon appel : ${goal}.`,
    openingQuestion: "Qu'en est-il ?",
    openingReasonFallback: "J'appelle pour régler une petite demande.",
    disclosure: makeDisclosure(
      (ownerName) =>
        `Bonjour, ceci est un assistant IA mandaté par ${ownerName}. Cette conversation sera résumée pour mon mandant.`,
      DISCLOSURE_OWNER_FALLBACK_FR,
    ),
    disclosureOwnerFallback: DISCLOSURE_OWNER_FALLBACK_FR,
    voicemailBody: (openingLine) =>
      `Je laisse ce message parce que personne n'a décroché. ${openingLine} Je réessaierai plus tard. Au revoir.`,
    ownerOpening: OWNER_OPENING_TEXTE.fr,
    summarySystem: (owner) =>
      `Tu résumes un appel téléphonique de l'assistant IA de ${owner}. Réponds UNIQUEMENT avec du JSON valide : {"summary": "2-3 phrases en français", "actionItems": ["..."], "objective_achieved": true|false|"unclear", "outcome": "1 phrase", "commitments": ["..."], "counterparty_commitments": ["..."], "open_points": ["..."], "next_step": "..."|null, "facts": ["..."]}. Mentionne dans le résumé des résultats concrets (date/heure convenue, prix, nom de la personne de contact), si le transcript les contient, plutôt que des formulations générales. objective_achieved évalue EXCLUSIVEMENT la mission initiale (pour les appels entrants : si la demande de l'appelant a été résolue). Les sujets annexes ouverts par l'assistant ou l'interlocuteur lui-même (par ex. une prise de rendez-vous proposée ou interrompue) sont SANS PERTINENCE pour cette évaluation. true = la mission a été suffisamment traitée, même si l'appel s'est terminé au milieu d'une étape de suivi ; false = la mission n'a clairement pas été atteinte ; "unclear" = réellement impossible à juger à partir de la mission. N'ajoute des action items que si ${owner} doit réellement faire quelque chose (max. 3). Les rendez-vous déjà fermement réservés ne sont PAS un action item. Fiche de résultat : outcome est UNE phrase avec le résultat concret (date/heure convenue, prix, nom) ou - si rien n'a été obtenu - la raison. commitments sont les engagements pris par l'assistant au nom de ${owner} ; counterparty_commitments sont les engagements de l'interlocuteur. open_points sont les questions restées ouvertes. next_step est LA prochaine étape pour ${owner}, sinon null. facts sont des informations durablement utiles sur l'interlocuteur (horaires, contact, prix). Chaque liste contient au maximum 3 éléments, chaque élément au maximum 200 caractères. N'invente rien : si une information manque dans le transcript, la liste reste vide ou le champ reste null.`,
    summaryEvidenceClause:
      ' Ajoute aussi "evidence" : au maximum 2 courtes citations LITTÉRALES du transcript qui étayent le résultat. Uniquement des propos littéraux, rien de résumé.',
    llmDegradedSpeech:
      "Désolé, je ne peux pas traiter votre demande pour le moment. Je vous recontacte dès que possible. Au revoir.",
    turnErrorSpeech: "Désolé, un problème technique est survenu. Veuillez réessayer plus tard.",
    noSpeechReprompt: "Pouvez-vous répéter ?",
    noSpeechRepromptAgain: "Je ne vous entends toujours pas. Êtes-vous encore en ligne ?",
    noSpeechFarewell:
      "Je ne vous entends malheureusement pas. Je réessaierai plus tard. Au revoir.",
    capFarewellSpeech:
      "Je dois malheureusement terminer l'appel maintenant. Merci pour votre temps. Au revoir.",
    budgetExhaustedHangup: "Le budget de démonstration est épuisé. Au revoir.",
    greetingDefault:
      "Bonjour, vous êtes en relation avec l'assistant IA de {owner}. {owner} n'est pas disponible pour le moment. Je peux prendre un message pour {owner}. Comment puis-je vous aider ?",
    inboundNotice: INBOUND_NOTICES.fr,
    inboundGrussSatz: makeInboundGrussSatz("fr"),
    inboundGrussSatzOwner: makeInboundGrussSatzOwner("fr"),
    inboundHinweisSatz: INBOUND_HINWEIS_SATZ.fr,
    inboundEroeffnung: makeInboundEroeffnung("fr"),
    inboundEroeffnungOwner: makeInboundEroeffnungOwner("fr"),
    inboundFehlersatz: makeInboundFehlersatz("fr"),
    mcp: MCP_TEXTS.fr,
    gates: GATE_TEXTS.fr,
    greetingVariants: Object.freeze([
      "Bonjour, vous êtes bien en ligne avec l'assistant IA de {owner}. Je prends note de votre message pour {owner}. Comment puis-je vous aider ?",
      "Bonjour ! Ici l'assistant IA de {owner}. Comment puis-je vous aider ?",
    ]),
    turnFallbackSpeech: {
      inbound: "Très bien, merci pour votre appel. Au revoir !",
      outbound: "Très bien, merci pour votre temps. Au revoir !",
    },
    consultFillerSpeech: "Un petit instant, je vérifie cela. Vous êtes toujours là ?",
    consultHoldSpeech: "Encore un instant, s'il vous plaît. Je reviens tout de suite.",
    prompt: PROMPT_FR,
    postCall: Object.freeze({
      cancelledTitle: "Appel annulé",
      failedTitle: "Appel non abouti",
      statusBody: makeStatusBody("statut :", FAILURE_REASON_TEXTS.fr),
      summaryTitle: "Nouveau résumé d'appel",
      subjectOutbound: (to) => `Appel vers ${to}`,
      subjectInbound: (from) => `Appel de ${from}`,
      actionItemsHeading: "Actions à mener :",
      mailTimeLabel: "Heure :",
      mailDurationLabel: "Durée :",
      notPlacedMailHint:
        "L'erreur vient de chez nous, pas de vous. Nous nous en occupons ; vous pouvez réessayer plus tard.",
      unsubscribeLinkLabel: "Se désabonner :",
    }),
    newsletter: Object.freeze({
      confirmMailSubject: "Confirmation : recevoir les résumés d'appel",
      confirmMailText: (ownerName, confirmUrl) =>
        `Bonjour,\n\n${ownerName} a inscrit cette adresse e-mail pour recevoir les résumés ` +
        `d'appel de Hermes. Merci de confirmer votre inscription via ce lien :\n\n${confirmUrl}\n\n` +
        "Ce lien est valable 48 heures. Si ce n'était pas vous, vous n'avez rien à faire - " +
        "sans confirmation, l'adresse ne sera pas utilisée.",
      confirmedPageTitle: "E-mail confirmé",
      confirmedPageBody: "Vous recevrez désormais les résumés d'appel.",
      invalidPageTitle: "Lien invalide",
      invalidPageBody: "Ce lien de confirmation est invalide ou expiré.",
      unsubscribedPageTitle: "Désabonné",
      unsubscribedPageBody: "Vous ne recevrez plus de résumés d'appel.",
    }),
  }),
  en: Object.freeze({
    language: "en",
    dateLocale: "en-GB",
    sttLocale: "en-GB",
    voiceProfile: VOICE_PROFILE_EN,
    speechClause: "Reply only in natural, spoken English.",
    styleClause: makeStyleClause(STYLE_CLAUSES_EN, NEUTRAL_ADDRESS_CLAUSE_EN),
    bridgePhrase: (goal) =>
      /^i\b/i.test(goal) ? `${goal}.` : `Here's what I'm calling about: ${goal}.`,
    openingQuestion: "How does that look on your side?",
    openingReasonFallback: "I am calling to sort out a small matter with you.",
    disclosure: makeDisclosure(
      (ownerName) =>
        `Hello, this is an AI assistant calling on behalf of ${ownerName}. This conversation will be summarised for the person I represent.`,
      DISCLOSURE_OWNER_FALLBACK_EN,
    ),
    disclosureOwnerFallback: DISCLOSURE_OWNER_FALLBACK_EN,
    voicemailBody: (openingLine) =>
      `I am leaving this message because nobody picked up. ${openingLine} I will try again later. Goodbye.`,
    ownerOpening: OWNER_OPENING_TEXTE.en,
    summarySystem: (owner) =>
      `You are summarising a phone call made by ${owner}'s AI assistant. Reply ONLY with valid JSON: {"summary": "2-3 sentences in English", "actionItems": ["..."], "objective_achieved": true|false|"unclear", "outcome": "1 sentence", "commitments": ["..."], "counterparty_commitments": ["..."], "open_points": ["..."], "next_step": "..."|null, "facts": ["..."]}. State concrete outcomes in the summary (agreed date/time, price, contact person's name) if present in the transcript, instead of vague descriptions. objective_achieved judges ONLY the original objective (for inbound calls: whether the caller's request was resolved). Side topics opened by the assistant or the other party themselves (e.g. an offered or abandoned appointment follow-up) are IRRELEVANT to this judgement. true = the objective was answered well enough, even if the call ended in the middle of a follow-up step; false = the objective was clearly not achieved; "unclear" = genuinely impossible to judge from the objective. Only add action items if ${owner} really needs to do something (max. 3). Appointments that are already firmly booked are NOT an action item. Result card: outcome is ONE sentence with the concrete result (agreed date/time, price, name) or - if nothing was achieved - the reason why. commitments are promises the assistant made on behalf of ${owner}; counterparty_commitments are promises made by the other party. open_points are questions that stayed open. next_step is THE one next step for ${owner}, otherwise null. facts are durably useful details about the other party (opening hours, contact person, prices). Each list holds at most 3 entries, each entry at most 200 characters. Invent nothing: if a detail is missing from the transcript, the list stays empty or the field stays null.`,
    summaryEvidenceClause:
      ' Also add "evidence": at most 2 short, VERBATIM quotes from the transcript that support the outcome. Only verbatim wording, nothing summarised.',
    llmDegradedSpeech:
      "Sorry, I can't handle your request right now. I'll get back to you as soon as possible. Goodbye.",
    turnErrorSpeech: "Sorry, a technical problem occurred. Please try again later.",
    noSpeechReprompt: "Could you repeat that?",
    noSpeechRepromptAgain: "I still can't hear you. Are you still there?",
    noSpeechFarewell: "I'm afraid I can't hear you. I'll try again later. Goodbye.",
    capFarewellSpeech: "I have to end the call now. Thank you for your time. Goodbye.",
    budgetExhaustedHangup: "The demo budget has been used up. Goodbye.",
    greetingDefault:
      "Hi, this is the AI assistant of {owner}. {owner} can't take the call right now. I can take a message for {owner}. How can I help?",
    inboundNotice: INBOUND_NOTICES.en,
    inboundGrussSatz: makeInboundGrussSatz("en"),
    inboundGrussSatzOwner: makeInboundGrussSatzOwner("en"),
    inboundHinweisSatz: INBOUND_HINWEIS_SATZ.en,
    inboundEroeffnung: makeInboundEroeffnung("en"),
    inboundEroeffnungOwner: makeInboundEroeffnungOwner("en"),
    inboundFehlersatz: makeInboundFehlersatz("en"),
    mcp: MCP_TEXTS.en,
    gates: GATE_TEXTS.en,
    greetingVariants: Object.freeze([
      "Hello, you're through to {owner}'s AI assistant. I'll take a message for {owner}. How can I help?",
      "Hi there! This is {owner}'s AI assistant. How can I help you?",
    ]),
    turnFallbackSpeech: {
      inbound: "Alright, thank you for calling. Goodbye!",
      outbound: "Alright, thank you for your time. Goodbye!",
    },
    consultFillerSpeech: "One moment, I'm just checking that. Are you still there?",
    consultHoldSpeech: "Just one more moment, please. I'll be right with you.",
    prompt: PROMPT_EN,
    postCall: Object.freeze({
      cancelledTitle: "Call cancelled",
      failedTitle: "Call did not connect",
      statusBody: makeStatusBody("status:", FAILURE_REASON_TEXTS.en),
      summaryTitle: "New call summary",
      subjectOutbound: (to) => `Call to ${to}`,
      subjectInbound: (from) => `Call from ${from}`,
      actionItemsHeading: "Action items:",
      mailTimeLabel: "Time:",
      mailDurationLabel: "Duration:",
      notPlacedMailHint:
        "The problem was on our side, not yours. We are looking into it; you can try again later.",
      unsubscribeLinkLabel: "Unsubscribe:",
    }),
    newsletter: Object.freeze({
      confirmMailSubject: "Confirm: receive call summaries",
      confirmMailText: (ownerName, confirmUrl) =>
        `Hello,\n\n${ownerName} added this email address to receive call summaries from ` +
        `Hermes. Please confirm the signup via this link:\n\n${confirmUrl}\n\n` +
        "This link is valid for 48 hours. If this wasn't you, you don't need to do anything - " +
        "without confirmation, the address will not be used.",
      confirmedPageTitle: "Email confirmed",
      confirmedPageBody: "You will now receive call summaries.",
      invalidPageTitle: "Link invalid",
      invalidPageBody: "This confirmation link is invalid or has expired.",
      unsubscribedPageTitle: "Unsubscribed",
      unsubscribedPageBody: "You will no longer receive call summaries.",
    }),
  }),
});

export const SUPPORTED_LANGUAGES = Object.freeze(Object.keys(LOCALES));

export function supportedLanguageOf(wert) {
  if (typeof wert !== "string") return null;
  const code = wert.trim().toLowerCase();
  return SUPPORTED_LANGUAGES.find((unterstuetzt) => unterstuetzt === code) ?? null;
}

const DISCLOSURE_NAME_SENTINEL = "\u0000";
export function disclosurePrefixFor(language) {
  return localeFor(language).disclosure(DISCLOSURE_NAME_SENTINEL).split(DISCLOSURE_NAME_SENTINEL)[0];
}

export const LANGUAGE_FOR_COUNTRY = Object.freeze({
  DE: "de",
  AT: "de",
  CH: "de",
  FR: "fr",
  GB: "en",
  IE: "en",
});

export function languageForCountry(country) {
  return LANGUAGE_FOR_COUNTRY[String(country || "").toUpperCase()] || DEFAULT_LANGUAGE;
}

export function localeFor(language) {
  return LOCALES[language] || LOCALES[DEFAULT_LANGUAGE];
}
