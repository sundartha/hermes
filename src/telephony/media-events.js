// Neutrale Media-Event-Typen (Port 4). Provider-agnostisch: der Adapter
// uebersetzt die Provider-Events (Telnyx start/media/stop) darauf. OTHER = vom
// Core ignoriert (kein stiller Fehler bei unbekannten Provider-Events).
export const MEDIA_EVENT = Object.freeze({
  START: "start",
  MEDIA: "media",
  STOP: "stop",
  OTHER: "other",
});
