export function requireIdempotencyKey(idempotencyKey: unknown): void {
  if (typeof idempotencyKey !== "string" || idempotencyKey === "")
    throw new TypeError("enqueue: idempotencyKey muss ein nicht-leerer String sein");
}
