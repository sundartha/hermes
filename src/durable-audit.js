export function makeDurableAudit({ audit, auditStoreRef, tenantId = null }) {
  const meldeSchreibfehler = (err) =>
    console.error("[audit] durabler Eintrag fehlgeschlagen:", err.message);
  return (action, req, detail = "") => {
    audit(action, req, detail);
    const sink = auditStoreRef.current;
    if (!sink) return;
    try {
      Promise.resolve(sink.record({ action, tenantId, detail: detail || null }))
        .catch(meldeSchreibfehler);
    } catch (err) {
      meldeSchreibfehler(err);
    }
  };
}
