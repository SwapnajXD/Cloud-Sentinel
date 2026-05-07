export async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const text = await response.text();

  if (!text.trim()) {
    throw new Error(`Empty response from ${typeof input === 'string' ? input : response.url || 'request'}`);
  }

  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw new Error(`Invalid JSON response from ${typeof input === 'string' ? input : response.url || 'request'}`);
  }
}
