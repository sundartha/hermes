import assert from "node:assert/strict";
import { test } from "node:test";

import { entferneKlammern } from "../../src/i18n/audio-tags.ts";
import {
  afterGreeting,
  besitzerEroeffnung,
  besitzerFrage,
  drittEroeffnung,
  kiHinweisKernFor,
  kiHinweisRahmenFor,
} from "../../src/i18n/eroeffnung.ts";
import {
  makeCallFailedSummary,
  makeFailureSentence,
  makeStatusBody,
} from "../../src/i18n/failure-reason-texts.ts";
import { GATE_TEXTS } from "../../src/i18n/gate-texts.ts";
import { MCP_ERROR_CODE, MCP_TEXTS } from "../../src/i18n/mcp-texts.ts";

const SPRACHEN = ["de", "en", "fr"];

const EROEFFNUNG = {
  de: {
    kern: "der KI-Assistent von",
    rahmen: { pre: "ich bin Hermes, der KI-Assistent von ", post: "" },
    besitzer: "Hey, hier ist Hermes, dein KI-Assistent.",
    frage: "Wie kann ich dir helfen?",
    mitName: "Hallo, ich rufe an – ich bin Hermes, der KI-Assistent von Anna, und ich fasse das Gespräch für Jo zusammen.",
    ohneName: "Hallo, wegen Termin – ich bin Hermes, der KI-Assistent von Anna, und ich fasse das Gespräch für meinen Auftraggeber zusammen.",
    pflicht: "Hallo, wegen Termin – ich bin Hermes, der KI-Assistent von Anna",
  },
  en: {
    kern: "the AI assistant of",
    rahmen: { pre: "I am Hermes, the AI assistant of ", post: "" },
    besitzer: "Hey, it's Hermes, your AI assistant.",
    frage: "How can I help you?",
    mitName: "Hello, ich rufe an – I am Hermes, the AI assistant of Anna, and I will summarise this conversation for Jo.",
    ohneName: "Hello, wegen Termin – I am Hermes, the AI assistant of Anna, and I will summarise this conversation for the person I represent.",
    pflicht: "Hello, wegen Termin – I am Hermes, the AI assistant of Anna",
  },
  fr: {
    kern: "l'assistant IA de",
    rahmen: { pre: "je suis Hermes, l'assistant IA de ", post: "" },
    besitzer: "Salut, c'est Hermes, ton assistant IA.",
    frage: "Comment je peux t'aider ?",
    mitName: "Bonjour, ich rufe an – je suis Hermes, l'assistant IA de Anna, et je résume cette conversation pour Jo.",
    ohneName: "Bonjour, wegen Termin – je suis Hermes, l'assistant IA de Anna, et je résume cette conversation pour mon mandant.",
    pflicht: "Bonjour, wegen Termin – je suis Hermes, l'assistant IA de Anna",
  },
};

for (const sprache of SPRACHEN) {
  test(`Eröffnung ${sprache}: Sätze an Dritte und an den Besitzer stehen wörtlich fest`, () => {
    const soll = EROEFFNUNG[sprache];
    assert.equal(kiHinweisKernFor(sprache), soll.kern);
    assert.deepEqual(kiHinweisRahmenFor(sprache), soll.rahmen);
    assert.equal(besitzerEroeffnung({ language: sprache, firstName: " Jo " }), soll.besitzer);
    assert.equal(besitzerEroeffnung({ language: sprache, firstName: "  " }), "");
    assert.equal(besitzerEroeffnung({ language: sprache, firstName: "{{vorname" }), "");
    assert.equal(besitzerFrage(sprache), soll.frage);
    const mitName = drittEroeffnung({ language: sprache, ownerName: "Anna", firstName: "Jo", reason: "Ich rufe an." });
    assert.equal(mitName.text, soll.mitName);
    for (const firstName of [null, undefined, ""]) {
      const ohne = drittEroeffnung({ language: sprache, ownerName: "Anna", firstName, reason: "Wegen Termin!" });
      assert.deepEqual(ohne, { text: soll.ohneName, pflichtsatz: soll.pflicht });
    }
  });
}

test("Eröffnung: unbekannte Sprache wirft, Anlass wird kleingeschrieben außer bei I", () => {
  assert.throws(() => kiHinweisKernFor("xx"), { name: "TypeError", message: "Unbekannte Sprache: xx" });
  assert.deepEqual(["", "Ich", "I am", "Idee", "Idea"].map(afterGreeting), ["", "ich", "I am", "idee", "idea"]);
});

test("Fehlergrund-Sätze: bekannter Grund, unbekannter Grund und fehlender Grund", () => {
  const bundle = { reasonLabel: "r:", phrases: { busy: "b" } };
  const satz = makeFailureSentence(bundle);
  assert.deepEqual([satz("busy:x"), satz("zzz"), satz(null)], ["b", null, null]);
  assert.equal(makeFailureSentence({ reasonLabel: "r", phrases: {} })("toString"), null);
  assert.equal(makeStatusBody("S:", bundle)("T", "failed", "busy"), "T (S: failed, r: b)");
  assert.equal(makeStatusBody("S:", bundle)("T", "failed", "zzz"), "T (S: failed)");
  const zusammenfassung = makeCallFailedSummary("Lead.", bundle);
  assert.deepEqual([zusammenfassung(null), zusammenfassung("busy"), zusammenfassung("zzz")], [null, "Lead. r: b", "Lead."]);
});

test("Klammer-Tags werden entfernt, fehlende Werte werden leer", () => {
  assert.equal(entferneKlammern(" a [x] b [y]\n"), "a b");
  assert.equal(entferneKlammern(null), "");
  assert.equal(entferneKlammern(undefined), "");
  assert.equal(entferneKlammern(5), "5");
});

const GATE = {
  de: [
    "Nummer +1 ist gesperrt (Notruf-/Premium-/Service-Nummer). Anruf verweigert.",
    "Laendervorwahl von +2 ist nicht erlaubt. Anruf verweigert.",
    "Dein Budget-Limit ist erreicht: 3 von 4 EUR verbraucht.",
    "Dieser Anruf passt nicht mehr in dein Budget: es fehlen 5 EUR. Aktueller Spend-Monat endet am M.",
    "Dein Budget ist erschoepft: es fehlen 6 EUR. Aktueller Spend-Monat endet am N.",
  ],
  en: [
    "Number +1 is blocked (emergency/premium/service number). Call refused.",
    "Country code of +2 is not allowed. Call refused.",
    "Your budget limit is reached: 3 of 4 EUR used.",
    "This call no longer fits your budget: 5 EUR short. The current spend month ends on M.",
    "Your budget is exhausted: 6 EUR short. The current spend month ends on N.",
  ],
  fr: [
    "Le numéro +1 est bloqué (numéro d'urgence/surtaxé/de service). Appel refusé.",
    "L'indicatif pays de +2 n'est pas autorisé. Appel refusé.",
    "Votre limite de budget est atteinte : 3 sur 4 EUR utilisés.",
    "Cet appel ne tient plus dans votre budget : il manque 5 EUR. Le mois de dépense en cours se termine le M.",
    "Votre budget est épuisé : il manque 6 EUR. Le mois de dépense en cours se termine le N.",
  ],
};

for (const sprache of SPRACHEN) {
  test(`Gate-Texte ${sprache}: Sperrgründe mit Nummer und Beträgen stehen wörtlich fest`, () => {
    const g = GATE_TEXTS[sprache];
    assert.deepEqual(
      [g.deniedNumber("+1"), g.countryBlocked("+2"), g.budgetCapReached("3", "4"), g.reserveOverRemaining("5", "M"), g.reserveExhausted("6", "N")],
      GATE[sprache],
    );
  });
}

const MCP = {
  de: {
    hinweis: "Hinweis: Die Rueckfrage an den Auftraggeber ist fuer diesen Anruf NICHT freigegeben (geschlossen: [a], [b]). Hermes kann bei einem Problem im Anruf nicht rueckfragen.",
    angaben: ["1 Angabe an den Anruf uebergeben.", "2 Angaben an den Anruf uebergeben."],
    darf: ["Darf x weitergeben", "Darf x, y und z weitergeben"],
    nutzung: "Monatsnutzung: 42 % des Minuten-Kontingents",
    zusammenfassung: ["Der Anruf ist nicht zustande gekommen. Grund: die Leitung war besetzt", "Der Anruf ist nicht zustande gekommen."],
    karte: "Nicht gesendet: das Feld F enthaelt offenbar eine Zahlungskartennummer. Hermes nimmt keine Zahlungskartendaten entgegen - bitte entfernen und erneut versuchen.",
    ausweis: "Nicht gesendet: das Feld F enthaelt offenbar eine behoerdliche Kennnummer (z.B. Sozialversicherungs-, Steuer- oder Ausweisnummer). Hermes nimmt solche Nummern nicht entgegen - bitte entfernen und erneut versuchen.",
    zugang: "Nicht gesendet: das Feld F enthaelt offenbar Zugangsdaten (Passwort, PIN, Einmalcode, Schluessel oder Token). Hermes nimmt keine Zugangsdaten entgegen - bitte entfernen und erneut versuchen.",
  },
  en: {
    hinweis: "Note: the consult question to the principal is NOT released for this call (closed: [a], [b]). Hermes cannot ask the principal if a problem comes up during the call.",
    angaben: ["1 detail passed on to the call.", "2 details passed on to the call."],
    darf: ["May share x", "May share x, y and z"],
    nutzung: "Monthly usage: 42% of your included minutes",
    zusammenfassung: ["The call did not go through. reason: the line was busy", "The call did not go through."],
    karte: "Not sent: the field F contains what looks like a payment card number. Hermes does not accept payment card data - remove it and try again.",
    ausweis: "Not sent: the field F contains what looks like a government identifier (such as a social security, tax, or passport number). Hermes does not accept such numbers - remove it and try again.",
    zugang: "Not sent: the field F contains what looks like a credential (password, PIN, one-time code, key, or token). Hermes does not accept credentials - remove it and try again.",
  },
  fr: {
    hinweis: "Remarque : la question au mandant n'est PAS autorisée pour cet appel (fermé : [a], [b]). Hermes ne peut pas interroger le mandant en cas de problème pendant l'appel.",
    angaben: ["1 information transmise à l'appel.", "2 informations transmises à l'appel."],
    darf: ["Peut partager x", "Peut partager x, y et z"],
    nutzung: "Utilisation mensuelle : 42 % des minutes incluses",
    zusammenfassung: ["L'appel n'a pas abouti. motif : la ligne était occupée", "L'appel n'a pas abouti."],
    karte: "Non envoyé : le champ F semble contenir un numéro de carte de paiement. Hermes n'accepte pas les données de carte de paiement - veuillez le supprimer et réessayer.",
    ausweis: "Non envoyé : le champ F semble contenir un identifiant officiel (par exemple un numéro de sécurité sociale, fiscal ou de passeport). Hermes n'accepte pas ces numéros - veuillez le supprimer et réessayer.",
    zugang: "Non envoyé : le champ F semble contenir des identifiants de connexion (mot de passe, code PIN, code à usage unique, clé ou jeton). Hermes n'accepte pas ces identifiants - veuillez les supprimer et réessayer.",
  },
};

for (const sprache of SPRACHEN) {
  test(`MCP-Texte ${sprache}: Hinweise, Zählformen, Berechtigungen und Sperrtexte stehen wörtlich fest`, () => {
    const t = MCP_TEXTS[sprache];
    const soll = MCP[sprache];
    assert.equal(t.consultNotReleasedHint(["a", "b"]), soll.hinweis);
    assert.deepEqual([t.consultAnswerAccepted(1), t.consultAnswerAccepted(2)], soll.angaben);
    assert.deepEqual([t.agentStatus.permissionsAllowed(["x"]), t.agentStatus.permissionsAllowed(["x", "y", "z"])], soll.darf);
    assert.equal(t.agentStatus.planUsage(42), soll.nutzung);
    assert.deepEqual([t.callFailedSummary("busy"), t.callFailedSummary("weird")], soll.zusammenfassung);
    assert.equal(t.callFailedSummary(null), null);
    const fehler = t.errors;
    assert.deepEqual(
      [MCP_ERROR_CODE.RESTRICTED_PAYMENT_CARD, MCP_ERROR_CODE.RESTRICTED_GOVERNMENT_ID, MCP_ERROR_CODE.RESTRICTED_CREDENTIAL].map((code) => fehler[code]("F")),
      [soll.karte, soll.ausweis, soll.zugang],
    );
  });
}
