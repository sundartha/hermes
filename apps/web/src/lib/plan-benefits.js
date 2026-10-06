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

export function planBenefitsText(slug, lang) {
  const benefits = PLAN_BENEFITS[slug];
  if (!benefits) throw new Error(`plan-benefits: keine Leistungs-Copy fuer Tarif "${slug}"`);
  return benefits[lang].map((line) => line.replace(/<[^>]+>/g, ""));
}
