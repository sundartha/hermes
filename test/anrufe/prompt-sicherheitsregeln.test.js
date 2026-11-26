import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir, seedState, seedCall } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.js";

const OWNER = "Jonas";

let systemPrompt;
before(async () => {
  process.env.DATA_DIR = tempDataDir(
    seedState({
      calls: [],
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: "Jonas Beispiel" }],
    }),
  );
  await import("../../src/config.ts");
  ({ systemPrompt } = await import("../../src/claude.js"));
});

const ZEILEN = {
  de: [
    `- Du gibst KEINE persönlichen Daten von ${OWNER} heraus: keine Adresse, keine E-Mail, keine private Nummer.`,
    "- Du nennst NIEMALS Bank- oder Zahlungsdaten und sagst keine Zahlung zu.",
    `- Du hast KEINEN Kalenderzugriff und siehst keine Termine von ${OWNER}.`,
    "- Du buchst KEINE Termine fest. Einen Terminwunsch nimmst du mit allen Angaben als Nachricht auf: Tag, Uhrzeit, und bis wann er gilt.",
  ],
  en: [
    `- You give out NO personal data about ${OWNER}: no address, no email, no private number.`,
    "- You NEVER state bank or payment details and never promise a payment.",
    `- You have NO calendar access and cannot see ${OWNER}'s appointments.`,
    "- You do NOT book appointments firmly. You take an appointment request down as a message with all details: day, time, and how long it's valid.",
  ],
  fr: [
    `- Tu ne communiques AUCUNE donnée personnelle de ${OWNER} : ni adresse, ni e-mail, ni numéro privé.`,
    "- Tu ne donnes JAMAIS de coordonnées bancaires ou de paiement et ne promets aucun paiement.",
    `- Tu n'as AUCUN accès à l'agenda et tu ne vois pas les rendez-vous de ${OWNER}.`,
    "- Tu ne réserves AUCUN rendez-vous de manière ferme. Tu notes une demande de rendez-vous comme message avec tous les détails : jour, heure, et jusqu'à quand elle est valable.",
  ],
};

for (const [language, zeilen] of Object.entries(ZEILEN)) {
  for (const direction of ["outbound", "inbound"]) {
    test(`Prompt ${language}/${direction} enthält die Sicherheitsregeln mit dem Namen des Inhabers`, () => {
      const prompt = systemPrompt(seedCall({ tenantId: BOOTSTRAP_TENANT_ID, language, direction }));
      for (const zeile of zeilen) assert.ok(prompt.includes(zeile), zeile);
    });
  }
}
