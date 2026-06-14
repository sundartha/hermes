// Audio-Bridge: Twilio Media Streams <-> OpenAI Realtime API (VOICE_ENGINE=realtime).
// Audio laeuft als G.711 u-law 8kHz base64 in BEIDE Richtungen 1:1 durch
// (input_audio_format = output_audio_format = g711_ulaw) -> kein Transcoding, minimale Latenz.
// Audio laeuft NIEMALS durch MCP.
import WebSocket, { WebSocketServer } from "ws";
import { config } from "./config.js";
import * as store from "./store.js";
import { toolDefs, execTool, disclosureSentence, systemPrompt } from "./claude.js";
import { safeEqual } from "./util.js";
import { voiceControl } from "./telephony/registry.js";

// Claude-Tool-Schema (input_schema) -> Realtime-Function-Schema (parameters)
function realtimeTools() {
  return toolDefs().map((t) => ({
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
    if (new URL(req.url, "http://x").pathname !== "/media") return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  wss.on("connection", (twilioWs) => {
    let call = null;
    let streamSid = null;
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
      if (sid) voiceControl().endCall(sid).catch(() => {});
    }

    function finalize(status) {
      if (closed) return;
      closed = true;
      clearTimeout(endTimer);
      clearTimeout(hangupTimer);
      try { openaiWs?.close(); } catch {}
      try { twilioWs.close(); } catch {}
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
            tools: realtimeTools(),
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
          // ---- Audio KI -> Twilio (beide Schema-Varianten: beta + GA) ----
          case "response.audio.delta":
          case "response.output_audio.delta":
            if (streamSid && ev.delta)
              twilioWs.send(JSON.stringify({ event: "media", streamSid, media: { payload: ev.delta } }));
            break;

          case "response.created":
            activeResponse = true;
            break;

          // HEIKLE STELLE 1: Barge-in. Spricht der Angerufene, waehrend die KI redet:
          // 1) laufende Response bei OpenAI abbrechen, 2) bei Twilio den bereits
          // gepufferten (noch nicht abgespielten) Audio-Stream verwerfen ('clear').
          // Ohne (2) redet die KI scheinbar weiter, weil Twilio puffert.
          case "input_audio_buffer.speech_started":
            if (activeResponse) openaiWs.send(JSON.stringify({ type: "response.cancel" }));
            if (streamSid) twilioWs.send(JSON.stringify({ event: "clear", streamSid }));
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

    // ---- Twilio Media Stream Events ----
    twilioWs.on("message", (buf) => {
      let msg;
      try { msg = JSON.parse(buf.toString()); } catch { return; }

      switch (msg.event) {
        case "start": {
          streamSid = msg.start.streamSid;
          const callId = msg.start.customParameters?.call_id;
          call = store.getCall(callId);
          if (!call) { log("unbekannte call_id, trenne"); return twilioWs.close(); }
          // stream_token aus dem TwiML pruefen: ohne diese Pruefung koennte jeder
          // mit erratener call_id den Audio-Stream uebernehmen. Bei Ablehnung
          // call wieder auf null setzen, damit finalize() den echten Call-Record
          // nicht beendet (sonst koennte ein Angreifer aktive Calls abwuergen).
          const token = msg.start.customParameters?.stream_token || "";
          if (!call.streamToken || !safeEqual(token, call.streamToken)) {
            log("ungueltiges stream_token, trenne");
            call = null;
            return twilioWs.close();
          }
          call.twilioSid = msg.start.callSid || call.twilioSid;
          store.markAnswered(call.id);
          log("Stream gestartet,", call.direction, call.direction === "outbound" ? call.to : call.from);
          // Max-Dauer hart durchsetzen (zusaetzlich zu Twilio timeLimit)
          endTimer = setTimeout(() => hangup("Max-Dauer erreicht"), (call.maxDurationS || config.maxCallDurationS) * 1000);
          connectOpenAI();
          break;
        }
        case "media":
          // Audio Anrufer -> OpenAI, 1:1 als u-law base64
          if (openaiWs?.readyState === WebSocket.OPEN)
            openaiWs.send(JSON.stringify({ type: "input_audio_buffer.append", audio: msg.media.payload }));
          break;
        case "stop": // (a) Gegenseite hat aufgelegt
          finalize(call?.status === "cancelled" ? "cancelled" : "completed");
          break;
      }
    });

    twilioWs.on("close", () => finalize("completed"));
    twilioWs.on("error", () => finalize("failed"));
  });

  return wss;
}
