let abgewiesen = 0;

export function zaehleAbgewiesenenWebhook() {
  abgewiesen += 1;
}

export function abgewieseneWebhooks() {
  return abgewiesen;
}
