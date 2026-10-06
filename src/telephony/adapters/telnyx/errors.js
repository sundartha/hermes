const ERROR_DETAIL_MAX_LEN = 200;

const EMPTY_ENVELOPE = Object.freeze({ text: "", code: null });

async function telnyxErrorEnvelope(res, { includeDetail = false } = {}) {
  let raw;
  try {
    raw = await res.text();
  } catch {
    return EMPTY_ENVELOPE;
  }
  if (!raw) return EMPTY_ENVELOPE;
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return EMPTY_ENVELOPE;
  }
  const errors = Array.isArray(body && body.errors) ? body.errors : [];
  const text = errors
    .map((e) => {
      if (!e) return "";
      const head = [e.code != null ? String(e.code) : "", e.title].filter(Boolean).join(" ");
      if (!includeDetail) return head;
      const detail = e.detail ? String(e.detail).slice(0, ERROR_DETAIL_MAX_LEN) : "";
      return [head, detail].filter(Boolean).join(": ");
    })
    .filter(Boolean)
    .join("; ");
  const firstWithCode = errors.find((e) => e && e.code != null);
  return { text, code: firstWithCode ? String(firstWithCode.code) : null };
}

export async function assertTelnyxOk(res, op, { includeDetail = false, attachStatus = false } = {}) {
  if (res.ok) return;
  const envelope = await telnyxErrorEnvelope(res, { includeDetail });
  const err = new Error(
    `Telnyx ${op} fehlgeschlagen: HTTP ${res.status}${envelope.text ? ` (${envelope.text})` : ""}`,
  );
  if (attachStatus) err.providerStatus = res.status;
  if (envelope.code) err.providerCode = envelope.code;
  throw err;
}
