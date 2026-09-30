// Die drei Leistungen je Tarif, wie sie die Startseite unter der Minuten-Zeile
// zeigt (Handoff-Copy "Hermes Mobile v5"). Eine Quelle fuer die Handy-Startseite
// (components/MobileHome.astro) und die Fassungen fuer KI-Agenten
// (lib/agent-docs.js -> /index.md, /llms.txt, /llms-full.txt). Die erste
// Katalog-Leistung (Minuten) steht dort als eigene Zeile, darum fehlt sie hier.
// Schluessel = Tarif-Slug aus lib/plans.js (der Pro-Tarif heisst intern "business").
// EN darf <em> tragen; die Agenten-Fassungen entfernen das Markup.
export const PLAN_BENEFITS = Object.freeze({
  starter: Object.freeze({
    en: Object.freeze([
      "Answers every call for you",
      "Summarizes every call for you",
      "Email support",
    ]),
    de: Object.freeze([
      "Nimmt jeden Anruf für dich an",
      "Fasst jeden Anruf für dich zusammen",
      "E-Mail-Support",
    ]),
  }),
  business: Object.freeze({
    en: Object.freeze([
      "Answers <em>and</em> calls out for you",
      "Handles tasks independently for you",
      "Priority support",
    ]),
    de: Object.freeze([
      "Nimmt an <em>und</em> ruft für dich an",
      "Erledigt Aufgaben selbstständig",
      "Priority-Support",
    ]),
  }),
});

// Leistungen eines Tarifs als reiner Text (ohne <em>). Unbekannter Slug bricht ab,
// statt einen Tarif ohne Leistungen auszuliefern.
export function planBenefitsText(slug, lang) {
  const benefits = PLAN_BENEFITS[slug];
  if (!benefits) throw new Error(`plan-benefits: keine Leistungs-Copy fuer Tarif "${slug}"`);
  return benefits[lang].map((line) => line.replace(/<[^>]+>/g, ""));
}
