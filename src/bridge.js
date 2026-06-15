// Audio-Bridge: Twilio Media Streams <-> OpenAI Realtime API (VOICE_ENGINE=realtime).
// Audio laeuft als G.711 u-law 8kHz base64 in BEIDE Richtungen 1:1 durch
// (input_audio_format = output_audio_format = g711_ulaw) -> kein Transcoding, minimale Latenz.
// Audio laeuft NIEMALS durch MCP.
import WebSocket, { WebSocketServer } from "ws";
import { config } from "./config.js";
import * as store from "./store.js";
import { toolDefs, execTool, disclosureSentence, systemPrompt } from "./claude.js";
import { safeEqual } from "./util.js";
import { voiceControl, mediaTransport } from "./telephony/registry.js";
import { PROVIDER } from "./store/defaults.js";
import { MEDIA_EVENT } from "./telephony/media-events.js";

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
  for (const [provider, p] of Object.entries(MEDIA_PATH))
    if (pathname === p) return provider;
  return null;
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
  return systemPrompt(call) + "\n\nSPRECHWEISE: natuerlich, zuegig, kurze Saetze. Mache kleine Pausen moeglich, lass dich unterbrechen.";
}

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
    let activeResponse = false; // laeuft gerade eine KI-Ausgabe?
    let endTimer = null; // Max-Dauer
    let hangupTimer = null;
    let closed = false;

    const log = (...a) => console.log("[bridge]", call?.id || "?", ...a);

    function hangup(reason) {
      // HEIKLE STELLE 2: Call-Ende. Vier Ausloeser: (a) Gegenseite legt auf (Twilio 'stop'),
      // (b) Max-Dauer-Timer, (c) cancel_call via API, (d) die KI ruft das end_call-Tool auf.
      // Bei (d) warten wir kurz, damit der letzte Audio-Puffer (Verabschiedung) noch abgespielt wird.
      log("hangup:", reason);
      const sid = call?.twilioSid;
      // Provider-aware: ueber denselben Provider beenden, ueber den der Call laeuft
      // (call.provider). Fehlender Provider -> Twilio-Default (byte-identisch).
      if (sid) voiceControl(call?.provider).endCall(sid).catch(() => {});
    }

    function finalize(status) {
      if (closed) return;
      closed = true;
      clearTimeout(endTimer);
      clearTimeout(hangupTimer);
      try { openaiWs?.close(); } catch {}
      try { providerWs.close(); } catch {}
      if (call) {
        store.endCallRecord(call.id, status);
        onCallEnded?.(store.getCall(call.id)); // -> Summary + SMS (server.js)
      }
    }

    function connectOpenAI() {
      openaiWs = new WebSocket(
        `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(config.realtimeModel)}`,
        { headers: { Authorization: `Bearer ${config.openaiApiKey}`, "OpenAI-Beta": "realtime=v1" } }
      );

      openaiWs.on("open", () => {
        openaiWs.send(JSON.stringify({
          type: "session.update",
          session: {
            modalities: ["text", "audio"],
            instructions: instructions(call),
            voice: config.realtimeVoice,
            input_audio_format: "g711_ulaw",
            output_audio_format: "g711_ulaw",
            input_audio_transcription: { model: "whisper-1" },
            turn_detection: { type: "server_vad" },
            tools: realtimeTools(call.tenantId),
            tool_choice: "auto",
          },
        }));
        // KI spricht zuerst. Bei Outbound: fest verdrahteter Offenlegungssatz als allererster Satz.
        const opener = call.direction === "outbound"
          ? `Beginne das Gespraech JETZT. Dein erster Satz muss exakt lauten: "${disclosureSentence(call)}" Nenne danach kurz dein Anliegen.`
          : "Der Anrufer ist in der Leitung. Begruesse ihn jetzt entsprechend deiner Anweisungen.";
        openaiWs.send(JSON.stringify({ type: "response.create", response: { instructions: opener } }));
      });

      openaiWs.on("message", (buf) => {
        let ev;
        try { ev = JSON.parse(buf.toString()); } catch { return; }

        switch (ev.type) {
          // ---- Audio KI -> Telefonie (beide Schema-Varianten: beta + GA) ----
          // Frame-Aufbau provider-spezifisch ueber Port 4 (Adapter), Rest agnostisch.
          case "response.audio.delta":
          case "response.output_audio.delta":
            if (streamRef && ev.delta)
              providerWs.send(JSON.stringify(media.buildMediaFrame({ payload: ev.delta, streamRef })));
            break;

          case "response.created":
            activeResponse = true;
            break;

          // HEIKLE STELLE 1: Barge-in. Spricht der Angerufene, waehrend die KI redet:
          // 1) laufende Response bei OpenAI abbrechen, 2) beim Provider den bereits
          // gepufferten (noch nicht abgespielten) Audio-Stream verwerfen (clearPlayback).
          // Ohne (2) redet die KI scheinbar weiter, weil der Provider puffert.
          case "input_audio_buffer.speech_started":
            if (activeResponse) openaiWs.send(JSON.stringify({ type: "response.cancel" }));
            if (streamRef) providerWs.send(JSON.stringify(media.clearPlayback({ streamRef })));
            break;

          // ---- Transkripte fortlaufend in den Call-Record ----
          case "conversation.item.input_audio_transcription.completed":
            if (ev.transcript?.trim()) store.addTranscript(call.id, "caller", ev.transcript.trim());
            break;
          case "response.audio_transcript.done":
          case "response.output_audio_transcript.done":
            if (ev.transcript?.trim()) store.addTranscript(call.id, "agent", ev.transcript.trim());
            break;

          // ---- Tool-Aufrufe der KI (gleiche Tools wie Budget-Engine) ----
          case "response.done": {
            activeResponse = false;
            const items = ev.response?.output || [];
            for (const item of items) {
              if (item.type !== "function_call") continue;
              let args = {};
              try { args = JSON.parse(item.arguments || "{}"); } catch {}
              if (item.name === "end_call") {
                // (d) KI signalisiert Zielerreichung -> 2,5s Puffer fuer die Verabschiedung
                hangupTimer = setTimeout(() => hangup("end_call von KI"), 2500);
              } else {
                const result = execTool(call, item.name, args);
                openaiWs.send(JSON.stringify({
                  type: "conversation.item.create",
                  item: { type: "function_call_output", call_id: item.call_id, output: String(result) },
                }));
                openaiWs.send(JSON.stringify({ type: "response.create" }));
              }
            }
            break;
          }

          case "error":
            console.error("[bridge] OpenAI error:", ev.error?.message || ev);
            break;
        }
      });

      // Stirbt die OpenAI-Verbindung waehrend des Gespraechs (z.B. Key/Quota),
      // nicht den Anrufer in Stille haengen lassen, sondern auflegen.
      openaiWs.on("close", () => {
        log("OpenAI WS zu");
        if (!closed) hangup("openai-verbindung-weg");
      });
      openaiWs.on("error", (e) => { console.error("[bridge] OpenAI WS:", e.message); hangup("openai-error"); });
    }

    // ---- Provider-Media-Stream-Events (Frame-Schicht ueber Port 4) ----
    providerWs.on("message", (buf) => {
      let raw;
      try { raw = JSON.parse(buf.toString()); } catch { return; }
      const frame = media.parseMediaFrame(raw);

      switch (frame.event) {
        case MEDIA_EVENT.START: {
          streamRef = frame.streamRef;
          call = store.getCall(frame.callId);
          if (!call) { log("unbekannte call_id, trenne"); return providerWs.close(); }
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
          log("Stream gestartet,", call.direction, call.direction === "outbound" ? call.to : call.from);
          // Max-Dauer hart durchsetzen (zusaetzlich zu Provider timeLimit)
          endTimer = setTimeout(() => hangup("Max-Dauer erreicht"), (call.maxDurationS || config.maxCallDurationS) * 1000);
          connectOpenAI();
          break;
        }
        case MEDIA_EVENT.MEDIA:
          // Audio Anrufer -> OpenAI, 1:1 als u-law base64
          if (openaiWs?.readyState === WebSocket.OPEN)
            openaiWs.send(JSON.stringify({ type: "input_audio_buffer.append", audio: frame.payload }));
          break;
        case MEDIA_EVENT.STOP: // (a) Gegenseite hat aufgelegt
          finalize(call?.status === "cancelled" ? "cancelled" : "completed");
          break;
      }
    });

    providerWs.on("close", () => finalize("completed"));
    providerWs.on("error", () => finalize("failed"));
  });

  return wss;
}
