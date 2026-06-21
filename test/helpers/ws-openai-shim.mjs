// Test-Shim fuer das "ws"-Modul (NUR im A3-Charakterisierungs-Test, kein Produktionscode).
//
// Problem: src/bridge.js oeffnet die OpenAI-Realtime-Verbindung mit
//   `new WebSocket("wss://api.openai.com/v1/realtime?...")`
// fest verdrahtet (auswaerts). Es gibt keine Unit-Naht, um diese Verbindung von
// aussen zu kontrollieren (genau das stellt bridge-hardening.test.js fest: der
// OpenAI-Handler ist "im gespawnten Server nicht injizierbar"). Um den HEUTIGEN
// inline Event-Handler zu charakterisieren, ohne Produktionscode anzufassen, wird
// dieses Shim per Loader-Hook (module.register) NUR fuer den "ws"-Import von
// bridge.js untergeschoben.
//
// Strategie: jede Verbindung zu api.openai.com wird durch einen steuerbaren
// In-Memory-Fake ersetzt (onmessage/onopen/onclose/onerror von aussen ausloesbar,
// readyState frei setzbar fuer den canSend-Guard). JEDE andere URL (der Provider-
// Client im Test, der WebSocketServer der Bridge) geht 1:1 an die echte
// ws-Implementierung -> die reale upgrade/connection-Strecke bleibt unangetastet.
import { EventEmitter } from "node:events";

// Echte ws-Implementierung als file:-URL (vom Test VOR register() in __REAL_WS_URL
// gelegt). Bewusst ueber die URL statt ueber den Specifier "ws" geladen, damit der
// Loader-Hook (der "ws" auf dieses Shim umlenkt) hier NICHT erneut greift und keine
// Endlos-Rekursion entsteht.
const RealWS = (await import(process.env.__REAL_WS_URL)).default;

const OPENAI_HOST = "api.openai.com";

// Registry aller erzeugten OpenAI-Fakes in Erzeugungsreihenfolge. Der Test wartet,
// bis connectOpenAI() einen Fake angelegt hat, greift ihn und treibt die Events.
export const openAiSockets = [];
export function resetOpenAiSockets() {
  openAiSockets.length = 0;
}

// Minimaler Stellvertreter fuer einen ws-Client zur OpenAI-Realtime-API. Deckt
// genau die Oberflaeche ab, die bridge.js nutzt: .on(...) (via EventEmitter),
// .send(...), .close(...) und das Feld .readyState (gelesen von canSend).
export class FakeOpenAiSocket extends EventEmitter {
  constructor(url) {
    super();
    this.url = url;
    this.readyState = RealWS.OPEN; // canSend(ws) === true, bis der Test es aendert
    this.sent = []; // jede .send()-Nutzlast in Aufrufreihenfolge
  }

  send(data) {
    this.sent.push(data);
  }

  close(code, reason) {
    if (this.readyState === RealWS.CLOSED) return;
    this.readyState = RealWS.CLOSED;
    this.emit("close", code ?? 1000, Buffer.from(reason ?? ""));
  }
}

// Drop-in-Ersatz fuer ws.WebSocket. Konstruktor verzweigt nach Ziel-URL:
// api.openai.com -> steuerbarer Fake (in openAiSockets registriert), sonst ein
// echter ws-Client. Ein Basis-Konstruktor (kein extends) darf ein Objekt
// zurueckgeben; dieses wird zum Ergebnis von `new WebSocket(...)`.
class WebSocket {
  constructor(address, ...rest) {
    if (typeof address === "string" && address.includes(OPENAI_HOST)) {
      const fake = new FakeOpenAiSocket(address);
      openAiSockets.push(fake);
      return fake;
    }
    return new RealWS(address, ...rest);
  }
}

// readyState-Konstanten gespiegelt, damit canSend() (ws.readyState === WebSocket.OPEN)
// ueber den Default-Import dieselbe Zahl vergleicht wie die echte ws-Implementierung.
WebSocket.CONNECTING = RealWS.CONNECTING;
WebSocket.OPEN = RealWS.OPEN;
WebSocket.CLOSING = RealWS.CLOSING;
WebSocket.CLOSED = RealWS.CLOSED;

export default WebSocket;
// bridge.js importiert `{ WebSocketServer }` benannt -> echte Server-Klasse durchreichen
// (die reale upgrade/connection-Strecke der Bridge bleibt unveraendert).
export const WebSocketServer = RealWS.WebSocketServer;
