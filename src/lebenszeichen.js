const LOG_VORSILBE = "[lebenszeichen] Meldung gescheitert:";
const UNBEKANNTE_FEHLERART = "unbekannt";

function fehlerart(fehler) {
  const code = fehler?.cause?.code ?? fehler?.code;
  return typeof code === "string" ? code : String(fehler?.name ?? UNBEKANNTE_FEHLERART);
}

async function meldeHerzschlag(adresse, fristMs) {
  try {
    const antwort = await fetch(adresse, { signal: AbortSignal.timeout(fristMs) });
    await antwort.body?.cancel();
    if (!antwort.ok) console.warn(`${LOG_VORSILBE} HTTP ${antwort.status}`);
  } catch (fehler) {
    console.warn(`${LOG_VORSILBE} ${fehlerart(fehler)}`);
  }
}

export function starteLebenszeichen({ herzschlagUrl, herzschlagTaktMs, herzschlagFristMs }) {
  const adresse = herzschlagUrl.trim();
  if (!adresse) return;
  setInterval(() => void meldeHerzschlag(adresse, herzschlagFristMs), herzschlagTaktMs).unref();
}
