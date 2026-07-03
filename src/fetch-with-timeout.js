// Generischer Fetch-Wrapper mit hartem Timeout (P16 Review-Fix PROV-01/F3): kappt einen
// haengenden Provider-Request (Netzwerk-Partition/TLS-Hang/Provider-Outage ohne RST)
// spaetestens nach opts.timeoutMs. OHNE diesen Deckel settlet ein haengender Telnyx-/
// Stripe-fetch() NIE - und die Single-Flight-Kette um den Provisioning-Drain (single-
// flight.js) bliebe dann fuer immer haengen (jeder Folge-Trigger haengt sich mit an,
// bis der Prozess neu startet).
//
// AbortController ist Node-nativ (kein neuer Dependency, Konvention: wenige Deps). Der
// Timeout-Fehler traegt NUR den uebergebenen label-Kontext + die Frist - NIE die URL
// (Query-Strings koennen PII wie Telefonnummern tragen, Regel 4).
export async function fetchWithTimeout(input, init, { timeoutMs, label }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err) {
    if (err.name === "AbortError")
      throw new Error(`${label}: Timeout nach ${timeoutMs}ms (Provider antwortet nicht)`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
