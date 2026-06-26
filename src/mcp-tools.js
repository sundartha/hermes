// MCP-Tool-Definitionen (gemeinsam fuer stdio-Transport und Streamable HTTP /mcp).
// Die Tools sprechen mit der REST-API des Gateways.
import { z } from "zod";
import { uiRendererFor } from "./ui/registry.js";
import { WIDGET_CALL_STATUS, WIDGET_TRANSCRIPT } from "./ui/adapters/mcp-native.js";

// Letzte N Transkriptzeilen fuer get_call_status (G25, kein Magic-Wert im Slice).
const LAST_TRANSCRIPT_LINES = 6;

// Zur Aufrufzeit lesen (server.js setzt GATEWAY_URL ggf. erst beim Start)
const GATEWAY = () => (process.env.GATEWAY_URL || "http://localhost:3000").replace(/\/$/, "");

// identity (optional): wird als interner X-Internal-Identity-Header an die
// localhost-REST-API gereicht (Rechteprofile, Phase 2). Das Gateway akzeptiert
// den Header nur von localhost-Sockets. Ohne identity -> Owner-Verhalten.
async function api(method, path, body, identity) {
  const headers = { "Content-Type": "application/json" };
  if (identity) headers["X-Internal-Identity"] = identity;
  const res = await fetch(GATEWAY() + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

const text = (s) => ({
  content: [{ type: "text", text: typeof s === "string" ? s : JSON.stringify(s, null, 2) }],
});
// Fehler-Tool-Ergebnis (MCP-Konvention isError): der LLM-Client sieht eine klare,
// generische Meldung statt eines process-level Crashes. KEIN roher Gateway-Body.
const errText = (s) => ({ content: [{ type: "text", text: s }], isError: true });
const fmt = (iso) =>
  new Date(iso).toLocaleString("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

// AC5 Result-Guard: prueft, ob das api()-Ergebnis die erwarteten Felder mit dem
// erwarteten Typ traegt, BEVOR ein Handler verschachtelt deref't. api() degradiert
// bei Parse-Fehler zu `{}` (mcp-tools.js: res.json().catch(() => ({}))); ein blinder
// Deref (`s.calendar.length`, `r.callId`) crasht darauf mit TypeError. Geprueft wird
// Existenz/Typ, NICHT Nicht-Leere (leerer Kalender `[]` bleibt valide). Wirft eine
// generische, provider-freie Tool-Fehlermeldung (kein roher Gateway-Body, Regel 5).
function requireFields(obj, specs) {
  if (obj == null || typeof obj !== "object")
    throw new Error(
      "Der Telefon-Agent hat keine gueltige Antwort geliefert. Bitte spaeter erneut versuchen.",
    );
  for (const [field, type] of Object.entries(specs)) {
    const v = obj[field];
    const ok =
      type === "array"
        ? Array.isArray(v)
        : type === "object"
          ? v != null && typeof v === "object"
          : typeof v === type;
    if (!ok)
      throw new Error(
        "Der Telefon-Agent hat eine unvollstaendige Antwort geliefert. Bitte spaeter erneut versuchen.",
      );
  }
  return obj;
}

// Status-Mapping laut Vertrag: dialing | in_progress | completed | failed | cancelled
function mapStatus(c) {
  if (c.status === "active") return c.answeredAt ? "in_progress" : "dialing";
  return c.status;
}
function durationS(c) {
  const start = c.answeredAt || c.startedAt;
  const end = c.endedAt || new Date().toISOString();
  return Math.max(0, Math.round((new Date(end) - new Date(start)) / 1000));
}

// Daten-Kontrakt get_call_status (P1-Spec Abschnitt 5): GENAU diese Felder duerfen
// nach aussen (structuredContent + Text + Widget). Whitelist, keine Blacklist. Sitzt
// NACH der Tenant-Aufloesung (Gateway) und VOR jeder Sicht - eine einzige Stelle.
// Kein Secret/Identitaet/Audio/Cross-Tenant-Feld passiert diese Funktion.
function pickCallStatus(callId, c) {
  return {
    call_id: callId,
    status: mapStatus(c),
    duration_s: durationS(c),
    last_transcript_lines: c.transcript
      .slice(-LAST_TRANSCRIPT_LINES)
      .map((t) => `${t.role === "agent" ? "Agent" : "Gegenseite"}: ${t.text}`),
  };
}

// outputSchema fuer get_call_status: validiert GENAU die Whitelist (Stufe 0,
// schema-validiert). Modul-Konstante (G35, an einer Stelle).
const CALL_STATUS_OUTPUT = {
  call_id: z.string(),
  status: z.string(),
  duration_s: z.number(),
  last_transcript_lines: z.array(z.string()),
};

// Daten-Kontrakt get_transcript (Strategie Abschnitt 5.1, DSGVO): GENAU diese Felder
// duerfen nach aussen (structuredContent + Text + Widget). Das Roh-Transkript
// (c.transcript: role/text/t) wird NIE durchgereicht - es wird serverseitig nach der
// Summary gepurged (P8a) und faellt hier per Whitelist (nicht Blacklist) ohnehin raus.
// EIN Filter, VOR jeder Sicht (Pre-Mortem #1).
function pickTranscript(callId, c) {
  return {
    call_id: callId,
    result_summary:
      c.summary ||
      "(Noch keine Zusammenfassung verfuegbar - ggf. 5 Sekunden warten und erneut aufrufen.)",
    objective_achieved: c.objectiveAchieved ?? "unclear",
  };
}

// outputSchema fuer get_transcript: validiert GENAU die Whitelist. objective_achieved
// ist true|false|"unclear" (Bool oder String), daher union.
const TRANSCRIPT_OUTPUT = {
  call_id: z.string(),
  result_summary: z.string(),
  objective_achieved: z.union([z.boolean(), z.string()]),
};

// ctx (Phase 2): { identity, allowCalendar }. identity wird per Closure an jeden
// REST-Aufruf gehaengt (X-Internal-Identity). allowCalendar steuert, ob das
// get_calendar-Tool ueberhaupt registriert wird. stdio ruft registerTools(server)
// ohne ctx -> identity null (Owner), allowCalendar true.
export function registerTools(server, { identity = null, allowCalendar = true, uiHost = null } = {}) {
  const call = (method, path, body) => api(method, path, body, identity);
  const uiRenderer = uiRendererFor(uiHost); // null = Stufe-0-only (fail-closed)

  // Stufe 1 fuer EIN Widget aktivieren - geteilt von ALLEN UI-Tools (G5/S2, keine
  // Duplizierung der Anhang-Logik). Registriert die statische ui://-Resource am Server
  // UND liefert das _meta-Fragment fuer den Tool-Deskriptor - aber NUR wenn der
  // Renderer das Widget kennt und der Host faehig ist. Sonst {} (kein _meta, keine
  // Resource = fail-closed Stufe-0-only, AC3). Der Name nennt den Seiteneffekt
  // (Registrierung, N7); idempotent pro Server-Instanz (stateless: frischer Server je
  // Request).
  const enableWidgetUi = (widgetId) => {
    if (!uiRenderer || !uiRenderer.hasWidget(widgetId)) return {};
    uiRenderer.registerResource(server, widgetId);
    return { _meta: uiRenderer.toolMeta(widgetId) };
  };

  // AC6 per-handler Throw-Schutz (gilt stdio UND HTTP /mcp, da registerTools geteilt
  // ist): wickelt JEDEN Handler in ein catch. Ein Tool-Throw (Gateway-Fehler,
  // Result-Guard, Deref) wird zu einer sauberen MCP-Fehlerantwort (isError) statt
  // einer process-level unhandled rejection. requireFields-Meldungen sind bereits
  // generisch; alles andere bekommt eine stabile, provider-freie Meldung (kein Leak).
  // EINE Fehlerhuelle, geteilt von tool() und uiTool() (G5/S2 - keine Duplizierung).
  const wrapHandler =
    (handler) =>
    async (...args) => {
      try {
        return await handler(...args);
      } catch (err) {
        return errText(
          err?.message ||
            "Der Telefon-Agent ist momentan nicht erreichbar. Bitte spaeter erneut versuchen.",
        );
      }
    };

  // Bestands-Tools: positionsbasiertes server.tool (frozen API, kein outputSchema/_meta).
  const tool = (name, desc, schema, handler) => server.tool(name, desc, schema, wrapHandler(handler));

  // Wie tool(), aber ueber registerTool(config) -> erlaubt outputSchema (Stufe 0
  // schema-validiert) und _meta.ui.resourceUri (Stufe 1). config ohne _meta ->
  // Stufe-0-only. Dieselbe Fehlerhuelle wie tool() (Single Source via wrapHandler).
  const uiTool = (name, config, handler) =>
    server.registerTool(name, config, wrapHandler(handler));

  tool(
    "place_call",
    "Startet einen echten Telefonanruf des KI-Agenten an eine Telefonnummer und verfolgt dabei das angegebene Ziel. Welche Ziele erlaubt sind, entscheidet der Server ueber seine Safety-Gates (Rechteprofil/Allowlist, Denylist, Land, Limits) - einfach aufrufen; unerlaubte Ziele weist der Server mit einer klaren Meldung ab. Gibt sofort eine call_id zurueck. WICHTIG: Danach alle ~10 Sekunden get_call_status aufrufen, bis status=completed, und erst dann mit get_transcript das Ergebnis holen.",
    {
      to: z
        .string()
        .describe(
          "Zielrufnummer in E.164, z.B. +4917212345678. Wird serverseitig durch die Safety-Gates geprueft (Rechteprofil/Allowlist, Denylist, Land).",
        ),
      objective: z
        .string()
        .describe(
          "Das Ziel des Anrufs in einem Satz, z.B. 'Vereinbare einen Friseurtermin fuer Samstag vormittag.'",
        ),
      briefing: z
        .string()
        .optional()
        .describe("Kontext fuer den Agenten (Namen, Vorlieben, Hintergrund)."),
      constraints: z
        .string()
        .optional()
        .describe("Einschraenkungen, z.B. 'Nicht vor 10 Uhr, maximal 40 Euro.'"),
      language: z.string().optional().describe("Gespraechssprache, Default 'de'."),
      max_duration_s: z
        .number()
        .optional()
        .describe("Maximale Gespraechsdauer in Sekunden (Default 180, Max 300)."),
    },
    async (args) => {
      const r = await call("POST", "/api/calls", args);
      requireFields(r, { callId: "string" });
      return text({ call_id: r.callId, status: "dialing" });
    },
  );

  // Stufe 1 NUR wenn ein faehiger Renderer das Widget kennt (Capability vorhanden).
  // enableWidgetUi registriert die Resource und liefert das _meta; sonst {} (AC3).
  uiTool(
    "get_call_status",
    {
      description:
        "Liefert den Live-Zustand eines Anrufs: status (dialing|in_progress|completed|failed|cancelled), Dauer und die letzten Transkriptzeilen. Waehrend eines laufenden Anrufs alle ~10 Sekunden aufrufen.",
      inputSchema: { call_id: z.string().describe("Die call_id aus place_call") },
      outputSchema: CALL_STATUS_OUTPUT,
      ...enableWidgetUi(WIDGET_CALL_STATUS),
    },
    async ({ call_id }) => {
      const c = await call("GET", `/api/calls/${call_id}`);
      requireFields(c, { transcript: "array" });
      const data = pickCallStatus(call_id, c); // EIN Filter, VOR Text + structuredContent
      // Textblock bleibt die heutige 3-Feld-Sicht (Legacy/stdio byte-kompatibel, AC8);
      // structuredContent ist die SSOT-Obermenge inkl. call_id (Whitelist).
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status: data.status,
                duration_s: data.duration_s,
                last_transcript_lines: data.last_transcript_lines,
              },
              null,
              2,
            ),
          },
        ],
        structuredContent: data,
      };
    },
  );

  uiTool(
    "get_transcript",
    {
      description:
        "Liefert nach Gespraechsende die Ergebnis-Zusammenfassung und ob das Ziel erreicht wurde. Aus Datenschutzgruenden wird das Roh-Transkript nach der Zusammenfassung nicht aufbewahrt (Datenminimierung) und NICHT zurueckgegeben - nur Zusammenfassung und Ziel-Status. Erst aufrufen, wenn get_call_status status=completed meldet.",
      inputSchema: { call_id: z.string().describe("Die call_id aus place_call") },
      outputSchema: TRANSCRIPT_OUTPUT,
      ...enableWidgetUi(WIDGET_TRANSCRIPT),
    },
    async ({ call_id }) => {
      const c = await call("GET", `/api/calls/${call_id}`);
      if (c.status === "active")
        return text({
          error: "Anruf laeuft noch. Bitte get_call_status pollen und spaeter erneut versuchen.",
        });
      // Validiert, dass ein echtes Call-Objekt zurueckkam (transcript-Feld vorhanden);
      // das Roh-Transkript selbst wird bewusst NICHT durchgereicht (Whitelist unten).
      requireFields(c, { transcript: "array" });
      const data = pickTranscript(call_id, c); // EIN Whitelist-Filter, VOR Text + structuredContent + Widget
      // Textblock = Summary/Ziel-Sicht (kein call_id, analog get_call_status);
      // structuredContent ist die SSOT-Obermenge inkl. call_id (Whitelist). Roh-
      // Transkript taucht in KEINER Sicht auf (DSGVO).
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { result_summary: data.result_summary, objective_achieved: data.objective_achieved },
              null,
              2,
            ),
          },
        ],
        structuredContent: data,
      };
    },
  );

  tool(
    "cancel_call",
    "Bricht einen laufenden Anruf sauber ab.",
    { call_id: z.string().describe("Die call_id aus place_call") },
    async ({ call_id }) => {
      await call("POST", `/api/calls/${call_id}/cancel`);
      return text({ status: "cancelled" });
    },
  );

  tool(
    "get_my_number",
    "Liefert die Rufnummer des Telefon-Agenten (die Twilio-Nummer).",
    {},
    async () => {
      const s = await call("GET", "/api/state");
      requireFields(s, { agent: "object" });
      return text({ number: s.agent.number });
    },
  );

  // ---- Bonus-Tools (ueber den Brief hinaus, fuer die Hermes-Demo) ----
  tool(
    "list_calls",
    "Listet die letzten Telefonate des Agenten (inbound und outbound) mit Status und Summary.",
    {},
    async () => {
      const s = await call("GET", "/api/state");
      requireFields(s, { calls: "array" });
      if (!s.calls.length) return text("Noch keine Anrufe.");
      return text(
        s.calls
          .map(
            (c) =>
              `[${c.id}] ${c.direction === "outbound" ? "->" : "<-"} ${c.direction === "outbound" ? c.to : c.from} | ${mapStatus(c)} | ${fmt(c.startedAt)}${c.summary ? " | " + c.summary : ""}`,
          )
          .join("\n"),
      );
    },
  );

  tool("list_action_items", "Listet offene Action Items aus allen Telefonaten.", {}, async () => {
    const s = await call("GET", "/api/state");
    requireFields(s, { actionItems: "array" });
    const open = s.actionItems.filter((a) => !a.done);
    if (!open.length) return text("Keine offenen Action Items.");
    return text(
      open
        .map((a) => `[${a.id}] ${a.type === "appointment" ? "(Termin) " : ""}${a.text}`)
        .join("\n"),
    );
  });

  // Kalender-Tool nur registrieren, wenn das Profil es erlaubt (Phase 2). Ein
  // restriktives Profil sieht get_calendar gar nicht erst.
  if (allowCalendar)
    tool("get_calendar", "Zeigt die naechsten Kalendereintraege des Besitzers.", {}, async () => {
      const s = await call("GET", "/api/state");
      // Existenz/Typ pruefen, NICHT Nicht-Leere: leerer Kalender ([]) ist valide
      // und behaelt den bestehenden "Kalender ist leer."-Pfad.
      requireFields(s, { calendar: "array" });
      if (!s.calendar.length) return text("Kalender ist leer.");
      return text(
        s.calendar.map((e) => `${e.title}: ${fmt(e.start)} bis ${fmt(e.end)}`).join("\n"),
      );
    });

  tool(
    "get_agent_status",
    "Status des Telefon-Agenten: Rufnummer, Voice-Engine, Modell, Kosten/Budget, Berechtigungen.",
    {},
    async () => {
      const s = await call("GET", "/api/state");
      requireFields(s, { agent: "object", usage: "object", settings: "object" });
      return text(
        `Agent-Nummer: ${s.agent.number}\nBesitzer: ${s.agent.owner}\nVoice-Engine: ${s.agent.voiceEngine}\nModell: ${s.agent.model}\n` +
          `Calls bisher: ${s.usage.calls}\nKI-Kosten: ${s.usage.costEur.toFixed(3)} EUR von max. ${s.usage.maxBudgetEur} EUR\n` +
          `Allowlist: ${s.agent.allowedNumbers?.join(", ") || "(leer - Outbound gesperrt)"}\n` +
          `Berechtigungen: Kalender=${s.settings.allowCalendar}, Buchen=${s.settings.allowBooking}, Summaries=${s.settings.allowSummaries}, PersoenlicheDaten=${s.settings.allowPersonalData}, Bankdaten=${s.settings.allowBankData}`,
      );
    },
  );
}
