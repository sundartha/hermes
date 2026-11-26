import assert from "node:assert/strict";
import { test } from "node:test";

import { afterGreeting, LOCALES } from "../../src/i18n/locales.ts";
import { storeOpsFacade } from "../helpers.js";

const SPRACHEN = ["de", "en", "fr"];

const BESITZER = {
  de: ["Hey, hier ist Hermes, dein KI-Assistent.", "Wie kann ich dir helfen?"],
  en: ["Hey, it's Hermes, your AI assistant.", "How can I help you?"],
  fr: ["Salut, c'est Hermes, ton assistant IA.", "Comment je peux t'aider ?"],
};

for (const sprache of SPRACHEN) {
  test(`Eröffnung ${sprache}: Begrüßung des Besitzers steht wörtlich fest und braucht einen echten Vornamen`, () => {
    const [satz, frage] = BESITZER[sprache];
    const locale = LOCALES[sprache];
    assert.equal(locale.ownerOpening(" Jo "), satz);
    assert.equal(locale.ownerOpening("  "), "");
    assert.equal(locale.ownerOpening("{{vorname"), "");
    assert.equal(locale.inboundEroeffnungOwner("Jo"), `${satz} ${frage}`);
    assert.equal(locale.inboundEroeffnungOwner(""), "");
  });
}

test("Eröffnung: Anlass wird kleingeschrieben außer bei I", () => {
  assert.deepEqual(["", "Ich", "I am", "Idee", "Idea"].map(afterGreeting), ["", "ich", "I am", "idee", "idea"]);
});

const STATUS = {
  de: ["T (Status: failed, Grund: die Leitung war besetzt)", "T (Status: failed)", "T (Status: failed, Grund: die Verbindung kam nicht zustande)"],
  en: ["T (status: failed, reason: the line was busy)", "T (status: failed)", "T (status: failed, reason: the connection could not be established)"],
  fr: ["T (statut : failed, motif : la ligne était occupée)", "T (statut : failed)", "T (statut : failed, motif : la connexion n'a pas pu être établie)"],
};

for (const sprache of SPRACHEN) {
  test(`Statuszeile ${sprache}: bekannter Grund nennt den Satz, unbekannter und fehlender Grund bleiben ohne`, () => {
    const body = LOCALES[sprache].postCall.statusBody;
    assert.deepEqual(
      [body("T", "failed", "busy"), body("T", "failed", "zzz"), body("T", "failed", "failed:x")],
      STATUS[sprache],
    );
    assert.equal(body("T", "failed", null), STATUS[sprache][1]);
    assert.equal(body("T", "failed", "toString"), STATUS[sprache][1]);
  });
}

test("Transkript und Zusammenfassung speichern keine Klammer-Tags", () => {
  const anruf = { id: "c1", transcript: [], summary: "" };
  const state = { calls: [anruf] };
  const speicher = storeOpsFacade(state);
  speicher.addTranscript("c1", "agent", " Hallo [warm] Welt [x]\n");
  speicher.addTranscript("c1", "agent", null);
  speicher.addTranscript("c1", "agent", 5);
  assert.deepEqual(anruf.transcript.map((z) => z.text), ["Hallo Welt", "", "5"]);
  speicher.recordProviderCallResult("c1", { summary: "Termin [freundlich] steht", objectiveAchieved: true });
  assert.equal(anruf.summary, "Termin steht");
  speicher.recordProviderCallResult("c1", { summary: "", objectiveAchieved: false });
  assert.equal(anruf.summary, "");
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
    const g = LOCALES[sprache].gates;
    assert.deepEqual(
      [g.deniedNumber("+1"), g.countryBlocked("+2"), g.budgetCapReached("3", "4"), g.reserveOverRemaining("5", "M"), g.reserveExhausted("6", "N")],
      GATE[sprache],
    );
  });
}

