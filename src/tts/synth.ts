import { z } from "zod";

const TTS_PATH = "/v1/text-to-speech/";
const TTS_STREAM_SUFFIX = "/stream";
const DEFAULT_CONTENT_TYPE = "audio/mpeg";
const DETAIL_MAX_CHARS = 300;
const FEHLERNAME = z.object({ name: z.string() });

interface SynthOptionen {
  fetchImpl: (url: string, init: SynthAnfrage) => Promise<SynthAntwort>;
  apiKey: string;
  voiceId: string;
  model: string;
  apiBase: string;
  outputFormat: string;
  voiceSettings?: StimmEinstellungen;
  firstChunkTimeoutMs: number;
  totalTimeoutMs: number;
}

export interface StimmEinstellungen {
  stability: number;
  similarity_boost: number;
  speed?: number;
}

interface SynthAnfrage {
  method: string;
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
  fristMs: number;
}

interface SynthLeser {
  read: () => Promise<{ done: boolean; value?: Uint8Array }>;
}

interface SynthAntwort {
  ok: boolean;
  status: number;
  text?: () => Promise<string>;
  body?: { getReader?: () => SynthLeser | undefined } | null;
  headers: { get: (name: string) => string | null | undefined };
}

interface Frist {
  arm: (ms: number) => void;
  clear: () => void;
}

interface AudioErgebnis {
  bytes: Buffer;
  totalMs: number;
  complete: boolean;
}

type StreamGeoeffnet =
  | { ok: false; reason: string; detail?: string }
  | { ok: true; reader: SynthLeser; contentType: string };

export type SynthErgebnis =
  | { ok: false; reason: string; detail?: string }
  | { ok: true; contentType: string; firstChunkMs: number; audio: Promise<AudioErgebnis> };

function makeDeadline(controller: AbortController): Frist {
  let timer: NodeJS.Timeout | undefined;
  return {
    arm(ms: number): void {
      clearTimeout(timer);
      timer = setTimeout(() => {
        controller.abort();
      }, ms);
    },
    clear(): void {
      clearTimeout(timer);
    },
  };
}

function streamUrl({ apiBase, voiceId, outputFormat }: SynthOptionen): string {
  return (
    `${apiBase}${TTS_PATH}${encodeURIComponent(voiceId)}${TTS_STREAM_SUFFIX}` +
    `?output_format=${encodeURIComponent(outputFormat)}`
  );
}

function contentTypeOderVorgabe(wert: unknown): string {
  return typeof wert === "string" && wert !== "" ? wert : DEFAULT_CONTENT_TYPE;
}

async function errorDetail(res: SynthAntwort): Promise<string> {
  if (typeof res.text !== "function") return "";
  const body = await res.text().catch(() => "");
  return body.slice(0, DETAIL_MAX_CHARS);
}

async function drainRest({
  reader,
  firstChunk,
  startedAt,
  deadline,
}: {
  reader: SynthLeser;
  firstChunk: Uint8Array;
  startedAt: number;
  deadline: Frist;
}): Promise<AudioErgebnis> {
  const chunks = [firstChunk];
  let complete = true;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value?.length) chunks.push(value);
    }
  } catch {
    complete = false;
  } finally {
    deadline.clear();
  }
  return { bytes: Buffer.concat(chunks), totalMs: Date.now() - startedAt, complete };
}

async function openAudioStream(text: string, opts: SynthOptionen, signal: AbortSignal): Promise<StreamGeoeffnet> {
  const { fetchImpl, apiKey, model, voiceSettings } = opts;
  const res = await fetchImpl(streamUrl(opts), {
    method: "POST",
    headers: { "xi-api-key": apiKey, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: model, ...(voiceSettings ? { voice_settings: voiceSettings } : {}) }),
    signal,
    fristMs: opts.totalTimeoutMs,
  });
  if (!res.ok) return { ok: false, reason: `http_${String(res.status)}`, detail: await errorDetail(res) };
  const reader = res.body?.getReader?.();
  if (!reader) return { ok: false, reason: "no_stream" };
  return { ok: true, reader, contentType: contentTypeOderVorgabe(res.headers.get("content-type")) };
}

export async function synthesizeSpeechStream(text: string, opts: SynthOptionen): Promise<SynthErgebnis> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const deadline = makeDeadline(controller);
  deadline.arm(opts.firstChunkTimeoutMs);
  try {
    const stream = await openAudioStream(text, opts, controller.signal);
    if (!stream.ok) {
      deadline.clear();
      return stream;
    }
    const first = await stream.reader.read();
    deadline.clear();
    if (first.done || !first.value?.length) return { ok: false, reason: "empty_stream" };
    deadline.arm(Math.max(0, opts.totalTimeoutMs - (Date.now() - startedAt)));
    return {
      ok: true,
      contentType: stream.contentType,
      firstChunkMs: Date.now() - startedAt,
      audio: drainRest({ reader: stream.reader, firstChunk: first.value, startedAt, deadline }),
    };
  } catch (err) {
    deadline.clear();
    return { ok: false, reason: FEHLERNAME.safeParse(err).data?.name === "AbortError" ? "timeout" : "error" };
  }
}
