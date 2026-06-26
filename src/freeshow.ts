const DEFAULT_HOST = process.env.FREESHOW_HOST ?? "localhost";
const DEFAULT_PORT = parseInt(process.env.FREESHOW_PORT ?? "5506");

export async function callAction(
  action: string,
  data: Record<string, unknown> = {},
  host = DEFAULT_HOST,
  port = DEFAULT_PORT
): Promise<unknown> {
  const params = new URLSearchParams({ action, data: JSON.stringify(data) });
  const url = `http://${host}:${port}?${params}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FreeShow HTTP ${res.status}: ${await res.text()}`);
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}
