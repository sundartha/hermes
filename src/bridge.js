// Audio-Bridge: Twilio Media Streams <-> OpenAI Realtime API (VOICE_ENGINE=realtime).
// Audio laeuft als G.711 u-law 8kHz base64 in BEIDE Richtungen 1:1 durch
// (input_audio_format = output_audio_format = g711_ulaw) -> kein Transcoding, minimale Latenz.
// Audio laeuft NIEMALS durch MCP.
import WebSocket, { WebSocketServer } from "ws";
import { config } from "./config.js";
import * as store from "./store.js";
import {
  toolDefs,
  execTool,
  disclosureSentence,
  systemPrompt,
  shapeForSpeech,
  shouldSuppressEndCall,
  END_CALL_WAIT_INSTRUCTION,
} from "./claude.js";
import { localeFor } from "./i18n/locales.js";
import { safeEqual } from "./util.js";
import { voiceControl, mediaTransport } from "./telephony/registry.js";
import { PROVIDER } from "./store/defaults.js";
import { MEDIA_EVENT } from "./telephony/media-events.js";
import { callMaxDurationMs } from "./telephony/call-duration.js";

// WS-Pfad -> Provider (explizit, fail-closed). EINZIGE Quelle der Pfade (G5):
// server.js importiert MEDIA_PATH fuer die <Stream>-URL, der upgrade-Handler
// leitet daraus den Provider ab. KEIN Feld-Sniffing am Frame - die Adapter-Wahl
// muss VOR dem ersten Frame feststehen (start parsen). Unbekannter Pfad -> null ->
// Verbindung wird verworfen (kein stiller Twilio-Default fuer einen fremden
// Stream-Pfad, Tenant-Verwechslungs-Risiko).
export const MEDIA_PATH = Object.freeze({
  [PROVIDER.TWILIO]: "/media",
  [PROVIDER.TELNYX]: "/media/telnyx",
});

function providerFromMediaPath(pathname) {
  for (const [provider, p] of Object.entries(MEDIA_PATH)) if (pathname === p) return provider;
  return null;
}

// OT-2 (P3): Send nur auf einen OPEN-Socket. Spiegelt den bestehenden Inbound-Audio-Guard
// und ersetzt die Magic-Number readyState===1 durch eine benannte, testbare Vorbedingung.
// Genutzt an allen vier openaiWs.send-Call-Sites (Barge-in, Tool-Result, Follow-up, Inbound).
export function canSend(ws) {
  return ws?.readyState === WebSocket.OPEN;
}

// Reicht ein function_call_output an OpenAI zurueck und stoesst die naechste Antwort an.
// Nur auf offenem Socket (canSend) - feuert sonst im Call-Ende-Race auf einen toten
// Socket (wirft). EINE Sende-Quelle fuer den generischen Tool-Pfad UND das unterdrueckte
// end_call (G5) - kein dupliziertes send-Paar. String(output): Bestandsverhalten.
function sendFunctionOutput(openaiWs, callId, output) {
  if (!canSend(openaiWs)) return;
  openaiWs.send(
    JSON.stringify({
      type: "conversation.item.create",
      item: { type: "function_call_output", call_id: callId, output: String(output) },
    }),
  );
  openaiWs.send(JSON.stringify({ type: "response.create" }));
}

// Claude-Tool-Schema (input_schema) -> Realtime-Function-Schema (parameters)
function realtimeTools(tenantId) {
  return toolDefs(tenantId).map((t) => ({
    type: "function",
    name: t.name,
    description: t.description,
    parameters: t.input_schema,
  }));
}

// Gleiche Persona/Regeln wie die Budget-Engine, plus Sprech-Hinweis fuer Speech-to-Speech.
function instructions(call) {
  return (
    systemPrompt(call) +
    "\n\nSPRECHWEISE: natuerlich, zuegig, kurze Saetze. Mache kleine Pausen moeglich, lass dich unterbrechen."
  );
}

// HEIKLE STELLE 2: Call-Ende-Puffer. Ruft die KI das end_call-Tool auf, wird NICHT sofort
// aufgelegt, sondern erst nach diesem Puffer - so spielt der letzte Audio-Frame (Verabschiedung)
// noch aus. Benannte Konstante statt Magic-Number; Wert unveraendert zum frueheren inline 2500.
const HANGUP_MS = 2500;

export function attachMediaBridge(httpServer, onCallEnded) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    const provider = providerFromMediaPath(new URL(req.url, "http://x").pathname);
    if (!provider) return socket.destroy(); // fail-closed: unbekannter Pfad -> kein Stream
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req, provider));
  });

  wss.on("connection", (providerWs, _req, provider) => {
    const media = mediaTransport(provider);
    let call = null;
    let streamRef = null;
    let openaiWs = null;
    let endTimer = null; // Max-Dauer (eigener Timer, NICHT Teil des Event-Handler-state)
    let closed = false;
    // Veraenderlicher per-Verbindung-state, den der OpenAI-Event-Handler UND finalize() teilen:
    // activeResponse (laeuft gerade eine KI-Ausgabe? -> Barge-in-Guard) und hangupTimer
    // (Call-Ende-Puffer). EIN Objekt statt loser Werte -> Lesen (naechstes Event, Barge-in) und
    // Schreiben (vorheriges Event) treffen denselben Slot, kein Wert-Desync.
    const state = { activeResponse: false, hangupTimer: null };

    const log = (...a) => console.log("[bridge]", call?.id || "?", ...a);

    function hangup(reason) {
      // HEIKLE STELLE 2: Call-Ende. Vier Ausloeser: (a) Gegenseite legt auf (Twilio 'stop'),
      // (b) Max-Dauer-Timer, (c) cancel_call via API, (d) die KI ruft das end_call-Tool auf.
      // Bei (d) warten wir kurz, damit der letzte Audio-Puffer (Verabschiedung) noch abgespielt wird.
      log("hangup:", reason);
      const sid = call?.twilioSid;
      // Provider-aware: ueber denselben Provider beenden, ueber den der Call laeuft
      // (call.provider). Fehlender Provider -> Twilio-Default (byte-identisch).
      if (sid)
        voiceControl(call?.provider)
          .endCall(sid)
          .catch(() => {});
    }

    function finalize(status) {
      if (closed) return;
      closed = true;
      clearTimeout(endTimer);
      clearTimeout(state.hangupTimer);
      try {
        openaiWs?.close();
      } catch {}
      try {
        providerWs.close();
      } catch {}
      if (call) {
        store.endCallRecord(call.id, status);
        onCallEnded?.(store.getCall(call.id)); // -> Summary + SMS (server.js)
      }
    }

    function connectOpenAI() {
      openaiWs = new WebSocket(
        `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(config.realtimeModel)}`,
        {
          headers: { Authorization: `Bearer ${config.openaiApiKey}`, "OpenAI-Beta": "realtime=v1" },
        },
      );

      // Per-Verbindung-Kontext, EINMAL gebaut und an den extrahierten handleOpenAiEvent(ev, ctx)
      // durchgereicht (Dependency-Injection statt Closure ueber den connection-Scope). Alle
      // veraenderlichen Slots leben in state -> Handler und finalize() teilen genau eine Quelle.
      const ctx = {
        call,
        streamRef,
        openaiWs,
        state,
        providerWs,
        hangup,
        media,
        store,
      };
      // Call-Ende-Puffer (HEIKLE STELLE 2): plant das Auflegen erst nach HANGUP_MS und legt den
      // Timer in state ab, damit finalize() ihn beim Aufraeumen clearen kann.
      ctx.scheduleHangup = (reason) => {
        ctx.state.hangupTimer = setTimeout(() => ctx.hangup(reason), HANGUP_MS);
      };

      openaiWs.on("open", () => {
        // Sprachabhaengige Realtime-Felder aus dem EINEN i18n-Bundle (Phase 5). localeFor
        // faellt fail-safe auf de zurueck (unbekannte/fehlende call.language -> Bestand).
        // DE: realtimeVoice/whisperLocale sind null -> config.realtimeVoice bzw. Whisper-
        // Auto-Detect (kein language-Feld) -> byte-identisch zum Bestand.
        const loc = localeFor(call.language);
        // Whisper-language nur setzen, wenn das Bundle einen ISO-Code liefert (FR/EN);
        // DE bleibt ohne language-Feld (Auto-Detect, Bestand).
        const transcription = { model: "whisper-1" };
        if (loc.whisperLocale) transcription.language = loc.whisperLocale;
        openaiWs.send(
          JSON.stringify({
            type: "session.update",
            session: {
              modalities: ["text", "audio"],
              instructions: instructions(call),
              voice: loc.realtimeVoice ?? config.realtimeVoice,
              input_audio_format: "g711_ulaw",
              output_audio_format: "g711_ulaw",
              input_audio_transcription: transcription,
              turn_detection: { type: "server_vad" },
              tools: realtimeTools(call.tenantId),
              tool_choice: "auto",
            },
          }),
        );
        // KI spricht zuerst. Bei Outbound: fest verdrahteter Offenlegungssatz (sprach-
        // abhaengig, kuratiert) als allererster Satz, eingebettet im sprachabhaengigen
        // Opener-Steuertext aus dem Bundle. Bei Inbound: sprachabhaengige Begruessung.
        const opener =
          call.direction === "outbound"
            ? loc.realtimeOpener.outbound(disclosureSentence(call))
            : loc.realtimeOpener.inbound;
        openaiWs.send(
          JSON.stringify({ type: "response.create", response: { instructions: opener } }),
        );
      });

      // Duenner Listener am Frame-Eingang: innerer JSON-Guard (Nicht-JSON still verwerfen) +
      // aeusserer Crash-Guard bleiben hier; die Event-Logik lebt im exportierten
      // handleOpenAiEvent(ev, ctx) am Datei-Ende (bekommt schon das geparste ev + ctx).
      openaiWs.on("message", (buf) => {
        let ev;
        try {
          ev = JSON.parse(buf.toString());
        } catch {
          return;
        }

        // OT-2 (P3): aeusserer Guard um die Event-Verarbeitung. Ein Throw aus store/execTool/
        // Event-Verarbeitung darf NICHT zum ws-Emitter entkommen (ein Node-Prozess bedient ALLE
        // Calls -> sonst Prozess-Crash). Secret-frei nur e.message; der Call degradiert, lebt.
        try {
          handleOpenAiEvent(ev, ctx);
        } catch (e) {
          console.error("[bridge] openai message handler:", e?.message || String(e));
        }
      });

      // Stirbt die OpenAI-Verbindung waehrend des Gespraechs (z.B. Key/Quota),
      // nicht den Anrufer in Stille haengen lassen, sondern auflegen.
      openaiWs.on("close", () => {
        log("OpenAI WS zu");
        if (!closed) hangup("openai-verbindung-weg");
      });
      openaiWs.on("error", (e) => {
        console.error("[bridge] OpenAI WS:", e.message);
        hangup("openai-error");
      });
    }

    // ---- Provider-Media-Stream-Events (Frame-Schicht ueber Port 4) ----
    providerWs.on("message", (buf) => {
      let raw;
      try {
        raw = JSON.parse(buf.toString());
      } catch {
        return;
      }

      // OT-2 (P3): aeusserer Guard um parseMediaFrame + switch. Ein malformter Frame oder ein
      // Throw aus store/markAnswered darf NICHT zum ws-Emitter entkommen (Prozess-Crash, ein
      // Node-Prozess bedient ALLE Calls). Secret-frei nur e.message; der Call degradiert, der
      // Prozess lebt. Innerer JSON.parse-catch bleibt unveraendert (filtert Nicht-JSON wie bisher).
      try {
        const frame = media.parseMediaFrame(raw);
        switch (frame.event) {
          case MEDIA_EVENT.START: {
            streamRef = frame.streamRef;
            call = store.getCall(frame.callId);
            if (!call) {
              log("unbekannte call_id, trenne");
              return providerWs.close();
            }
            // stream_token aus den start-Parametern pruefen: ohne diese Pruefung
            // koennte jeder mit erratener call_id den Audio-Stream uebernehmen. Bleibt
            // erste Stufe VOR markAnswered/connectOpenAI. Bei Ablehnung call wieder auf
            // null setzen, damit finalize() den echten Call-Record nicht beendet (sonst
            // koennte ein Angreifer aktive Calls abwuergen).
            if (!call.streamToken || !safeEqual(frame.streamToken || "", call.streamToken)) {
              log("ungueltiges stream_token, trenne");
              call = null;
              return providerWs.close();
            }
            // providerCallRef -> call.twilioSid (Bestandsfeldname, von hangup/finalize/store
            // gelesen; neutraler Port-Name ist providerCallRef, die Zuweisung ist die Bruecke).
            call.twilioSid = frame.providerCallRef || call.twilioSid;
            store.markAnswered(call.id);
            log(
              "Stream gestartet,",
              call.direction,
              call.direction === "outbound" ? call.to : call.from,
            );
            // Max-Dauer hart durchsetzen (zusaetzlich zu Provider timeLimit)
            endTimer = setTimeout(
              () => hangup("Max-Dauer erreicht"),
              callMaxDurationMs(call, config.maxCallDurationS),
            );
            connectOpenAI();
            break;
          }
          case MEDIA_EVENT.MEDIA:
            // Audio Anrufer -> OpenAI, 1:1 als u-law base64
            if (canSend(openaiWs))
              openaiWs.send(
                JSON.stringify({ type: "input_audio_buffer.append", audio: frame.payload }),
              );
            break;
          case MEDIA_EVENT.STOP: // (a) Gegenseite hat aufgelegt
            finalize(call?.status === "cancelled" ? "cancelled" : "completed");
            break;
        }
      } catch (e) {
        console.error("[bridge] provider message handler:", e?.message || String(e));
      }
    });

    providerWs.on("close", () => finalize("completed"));
    providerWs.on("error", () => finalize("failed"));
  });

  return wss;
}

// OpenAI-Realtime-Event-Handler, aus connectOpenAI extrahiert (A3-P2). Bekommt das bereits
// geparste Event und den per-Verbindung-Kontext ctx (siehe connectOpenAI). Verhaltens-erhaltend
// zum frueheren inline-switch; JSON- und Crash-Guard liegen beim Aufrufer (openaiWs.on("message")).
// canSend/execTool bleiben Modul-Funktionen. Exportiert, damit der Pfad ohne Server-Spawn,
// upgrade-Handshake oder echte WebSockets unit-testbar ist (Fake-ctx mit Spy-Sockets).
export function handleOpenAiEvent(ev, ctx) {
  const { call, streamRef, openaiWs, providerWs, media, store, state } = ctx;
  switch (ev.type) {
    // ---- Audio KI -> Telefonie (beide Schema-Varianten: beta + GA) ----
    // Frame-Aufbau provider-spezifisch ueber Port 4 (Adapter), Rest agnostisch.
    case "response.audio.delta":
    case "response.output_audio.delta":
      if (streamRef && ev.delta)
        providerWs.send(JSON.stringify(media.buildMediaFrame({ payload: ev.delta, streamRef })));
      break;

    case "response.created":
      state.activeResponse = true;
      break;

    // HEIKLE STELLE 1: Barge-in. Spricht der Angerufene, waehrend die KI redet:
    // 1) laufende Response bei OpenAI abbrechen, 2) beim Provider den bereits gepufferten
    // (noch nicht abgespielten) Audio-Stream verwerfen (clearPlayback). Ohne (2) redet die KI
    // scheinbar weiter, weil der Provider puffert. Reihenfolge: cancel VOR clearPlayback.
    case "input_audio_buffer.speech_started":
      // OT-2 (P3): cancel nur auf OPEN-Socket - feuert sonst im Barge-in-Race auf einen
      // bereits schliessenden Socket (wirft). Verhalten sonst unveraendert (Reihenfolge gleich).
      if (state.activeResponse && canSend(openaiWs))
        openaiWs.send(JSON.stringify({ type: "response.cancel" }));
      if (streamRef) providerWs.send(JSON.stringify(media.clearPlayback({ streamRef })));
      break;

    // ---- Transkripte fortlaufend in den Call-Record ----
    case "conversation.item.input_audio_transcription.completed":
      if (ev.transcript?.trim()) store.addTranscript(call.id, "caller", ev.transcript.trim());
      break;
    case "response.audio_transcript.done":
    case "response.output_audio_transcript.done":
      // I8-Paritaet: Agent-Text durch denselben Shaper wie die Budget-Engine (agentTurn),
      // damit Realtime-Transkripte im Dashboard/DSGVO-Export keine Markdown-Reste tragen.
      if (ev.transcript?.trim())
        store.addTranscript(call.id, "agent", shapeForSpeech(ev.transcript.trim()));
      break;

    // ---- Tool-Aufrufe der KI (gleiche Tools wie Budget-Engine) ----
    case "response.done": {
      state.activeResponse = false;
      const items = ev.response?.output || [];
      for (const item of items) {
        if (item.type !== "function_call") continue;
        let args = {};
        try {
          args = JSON.parse(item.arguments || "{}");
        } catch {}
        if (item.name === "end_call") {
          // Guard-Paritaet zur Budget-Engine (shouldSuppressEndCall, EINE Quelle): ein
          // Outbound-Call darf NICHT vor der ersten substanziellen Antwort beendet werden
          // (auch nicht waehrend/direkt nach der Offenlegung). Unterdrueckt -> Wait-Instruktion
          // zurueckspielen statt aufzulegen; sonst (d) HANGUP_MS-Puffer fuer die Verabschiedung.
          if (shouldSuppressEndCall(call)) {
            sendFunctionOutput(openaiWs, item.call_id, END_CALL_WAIT_INSTRUCTION);
          } else {
            ctx.scheduleHangup("end_call von KI");
          }
        } else {
          // OT-2 (P3): execTool laeuft immer (Seiteneffekt), nur der Send geht ueber den
          // OPEN-Guard (im Helfer gekapselt).
          const result = execTool(call, item.name, args);
          sendFunctionOutput(openaiWs, item.call_id, result);
        }
      }
      break;
    }

    case "error":
      console.error("[bridge] OpenAI error:", ev.error?.message || ev);
      break;
  }
}
