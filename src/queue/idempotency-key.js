export function requireIdempotencyKey(idempotencyKey) {
  if (typeof idempotencyKey !== "string" || idempotencyKey === "")
    throw new TypeError("enqueue: idempotencyKey muss ein nicht-leerer String sein");
}
