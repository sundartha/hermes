export async function devLoginCookie(antwort) {
  const gesetzt = antwort.headers.get("set-cookie");
  if (antwort.status !== 302 || !gesetzt) {
    throw new Error(
      `Dev-Login: Status ${antwort.status}, Cookie ${gesetzt ? "gesetzt" : "fehlt"}, Antwort: ${await antwort.text()}`,
    );
  }
  return gesetzt.split(";")[0];
}
