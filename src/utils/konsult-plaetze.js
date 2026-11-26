export const konsultPlatzFrei = (zeilen, { callId, tenantId, jeAnruf, jeMandant }) =>
  zeilen.filter((zeile) => zeile.callId === callId).length < jeAnruf &&
  zeilen.filter((zeile) => zeile.tenantId === tenantId).length < jeMandant;

export function makeKonsultPlaetze({ jetztMs = Date.now } = {}) {
  const plaetze = new Map();
  let zaehler = 0;

  const aktuelle = () => {
    const jetzt = jetztMs();
    for (const [platzId, platz] of plaetze) if (platz.ablaufMs <= jetzt) plaetze.delete(platzId);
    return [...plaetze.values()];
  };

  function belegen({ callId, tenantId, jeAnruf, jeMandant, haltefristMs }) {
    if (!konsultPlatzFrei(aktuelle(), { callId, tenantId, jeAnruf, jeMandant })) return Promise.resolve(null);
    zaehler += 1;
    plaetze.set(zaehler, { callId, tenantId, ablaufMs: jetztMs() + haltefristMs });
    return Promise.resolve(zaehler);
  }

  function freigeben(platzId) {
    plaetze.delete(platzId);
    return Promise.resolve();
  }

  const offenJeAnruf = (callId) => aktuelle().filter((platz) => platz.callId === callId).length;

  return { belegen, freigeben, offenJeAnruf };
}

export const konsultPlaetze = makeKonsultPlaetze();
