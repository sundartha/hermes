// Geteilte Abrechnungsperioden-Ableitung: die Domaenen-Regel "Periodenstart =
// Periodenende minus EIN Monat (UTC-Kalender)" lebt an EINER Stelle. Genutzt von der
// Live-Anzeige (billing/meter.js, ISO) UND dem einmaligen Bestands-Backfill
// (db/migrate.js, Unix-Sekunden). Frueher in beiden Modulen dupliziert (G5/S2); hier
// extrahiert, beide Seiten wrappen nur noch das Rueckgabeformat. Driftet damit nicht
// mehr auseinander, wenn sich Kadenz oder Ueberlauf-Semantik aendert.
//
// Einzige Katalog-Kadenz ist "month"; der Monatsletzten-Ueberlauf (z.B. 31.->Vormonat)
// verschiebt das Fenster um wenige Tage - akzeptiert fuer Anzeige und Backfill (kein Gate).
// Folge-Ticket B2/B3: kanonische Laufzeit-Ableitung bzw. persistierter Stripe-Anker.

// s<->ms-Bruecke (Unix-Sekunden <-> Date-Millis). Benannte Konstante statt Magic 1000 (G25).
export const MS_PER_SECOND = 1000;

// Periodenstart als Date: Periodenende (Unix-Sekunden) minus ein Monat im UTC-Kalender.
// Reine Funktion, kein IO. Die Aufrufer formen das Date in ihr Zielformat (ISO bzw. Sekunden).
export function periodStartFromEnd(endSec) {
  const start = new Date(endSec * MS_PER_SECOND);
  start.setUTCMonth(start.getUTCMonth() - 1);
  return start;
}

// Periodenanker als ISO-8601 fuer das Minuten-Gate (B2) - spaeter teilt B3 die Anzeige
// denselben Anker, damit Gate-Fenster == Anzeige-Fenster ("Rest X Min, trotzdem geblockt"
// vermeiden). Praezedenz (Owner-Entscheidung 5.4, bindend, fail-closed):
//   (1) persistierter current_period_start (Stripe-Webhook, Unix-Sekunden) = autoritatives
//       Fenster.
//   (2) fehlt er, aber currentPeriodEnd liegt vor (Bestands-Abo vor B1a / Spalte noch NULL)
//       -> Anker daraus ABLEITEN (Bestands-Fallback) -> verhindert die Massensperrung
//       zahlender Bestandskunden beim Scharfschalten von PAYMENT_ENABLED.
//   (3) weder noch (frisches Abo, Webhook ausstehend) -> null.
// Liefert null bei (3); der Aufrufer reicht null als fehlenden Anker an planMinutesExceeded
// weiter -> dort fail-closed blocken (KEIN undefined, kein stilles used=0). Reine Funktion,
// kein IO. sub = store.tenantSubscription(tenantId)-Form ({currentPeriodStart,currentPeriodEnd}).
export function resolvePeriodStartIso({ currentPeriodStart, currentPeriodEnd } = {}) {
  if (currentPeriodStart != null)
    return new Date(currentPeriodStart * MS_PER_SECOND).toISOString();
  if (currentPeriodEnd != null) return periodStartFromEnd(currentPeriodEnd).toISOString();
  return null;
}
