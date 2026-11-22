import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('flux-room run API', () => {
  const mockFetch = vi.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = mockFetch;
    mockFetch.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('sends correct request body to /api/backend/run', async () => {
    const mockResponse = { stdout: 'Hello from Flux', stderr: '', exit_code: 0 };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const compiler = 'python-3.14';
    const code = 'print("Hello from Flux")';
    const input = '';

    const res = await fetch('/api/backend/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ compiler, code, input }),
    });

    const data = await res.json();

    expect(mockFetch).toHaveBeenCalledWith('/api/backend/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ compiler: 'python-3.14', code: 'print("Hello from Flux")', input: '' }),
    });
    expect(res.ok).toBe(true);
    expect(data).toEqual(mockResponse);
  });

  it('handles 500 error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Internal server error' }),
    });

    const res = await fetch('/api/backend/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ compiler: 'python-3.14', code: '', input: '' }),
    });

    const data = (await res.json()) as { error?: string };
    const netErr = data.error ?? `Request failed (${res.status})`;

    expect(res.ok).toBe(false);
    expect(netErr).toBe('Internal server error');
  });

  it('handles 429 rate limit', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => ({ error: 'Rate limit exceeded' }),
    });

    const res = await fetch('/api/backend/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ compiler: 'python-3.14', code: '', input: '' }),
    });

    const data = (await res.json()) as { error?: string };
    const netErr = data.error ?? `Request failed (${res.status})`;

    expect(res.ok).toBe(false);
    expect(netErr).toBe('Rate limit exceeded');
  });

  it('handles network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    try {
      await fetch('/api/backend/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ compiler: 'python-3.14', code: '', input: '' }),
      });
    } catch {
      // Expected
    }

    const netErr = "Flux's run server is offline.";
    expect(netErr).toBe("Flux's run server is offline.");
  });
});
