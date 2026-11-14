const ERROR_DETAIL_MAX_LEN = 200;

const EMPTY_ENVELOPE = Object.freeze({ text: "", code: null });

interface TelnyxFehler {
  code?: string | number | null;
  title?: string;
  detail?: string | number;
}

interface FehlerKoerper {
  errors?: (TelnyxFehler | null)[];
}

interface AntwortMitText {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}

interface ProviderFehler extends Error {
  providerStatus?: number;
  providerCode?: string;
}

const parseJson: (text: string) => FehlerKoerper | null = JSON.parse;

async function telnyxErrorEnvelope(
  res: AntwortMitText,
  { includeDetail = false }: { includeDetail?: boolean } = {},
): Promise<{ text: string; code: string | null }> {
  let raw: string;
  try {
    raw = await res.text();
  } catch {
    return EMPTY_ENVELOPE;
  }
  if (!raw) return EMPTY_ENVELOPE;
  let body: FehlerKoerper | null;
  try {
    body = parseJson(raw);
  } catch {
    return EMPTY_ENVELOPE;
  }
  const liste = body?.errors;
  const errors = Array.isArray(liste) ? liste : [];
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
  const firstWithCode = errors.find((e) => e?.code != null);
  return { text, code: firstWithCode ? String(firstWithCode.code) : null };
}

export async function assertTelnyxOk(
  res: AntwortMitText,
  op: string,
  { includeDetail = false, attachStatus = false }: { includeDetail?: boolean; attachStatus?: boolean } = {},
): Promise<void> {
  if (res.ok) return;
  const envelope = await telnyxErrorEnvelope(res, { includeDetail });
  const err: ProviderFehler = new Error(
    `Telnyx ${op} fehlgeschlagen: HTTP ${res.status.toString()}${envelope.text ? ` (${envelope.text})` : ""}`,
  );
  if (attachStatus) err.providerStatus = res.status;
  if (envelope.code) err.providerCode = envelope.code;
  throw err;
}
