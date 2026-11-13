export async function getBackendStatus({
  apiUrl = process.env.INTERNAL_API_URL,
  request = fetch,
} = {}) {
  if (!apiUrl) return { connected: false };

  try {
    const response = await request(`${apiUrl.replace(/\/$/, '')}/api/hello`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });

    if (!response.ok) return { connected: false };

    const payload = await response.json();
    return typeof payload.message === 'string'
      ? { connected: true, message: payload.message }
      : { connected: false };
  } catch {
    return { connected: false };
  }
}
