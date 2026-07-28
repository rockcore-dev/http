import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHttpClient, getHttpStatusText, isRetryableHttpStatusCode } from '../src';

describe('createHttpClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('performs GET and parses JSON response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          'content-type': 'application/json'
        }
      })
    );

    const client = createHttpClient({
      baseUrl: 'https://api.example.com',
      fetchFn: fetchMock
    });

    const data = await client.get<{ ok: boolean }>('/health');

    expect(data).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0].toString()).toBe('https://api.example.com/health');
  });

  it('merges query params and serializes json body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ created: true }), {
        status: 201,
        headers: {
          'content-type': 'application/json'
        }
      })
    );

    const client = createHttpClient({
      baseUrl: 'https://api.example.com',
      headers: {
        'x-api-key': 'abc'
      },
      fetchFn: fetchMock
    });

    await client.post('/users', {
      query: {
        role: 'admin',
        tags: ['a', 'b']
      },
      json: { name: 'Alice' }
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url.toString()).toBe('https://api.example.com/users?role=admin&tags=a&tags=b');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify({ name: 'Alice' }));
    expect(new Headers(init?.headers).get('x-api-key')).toBe('abc');
    expect(new Headers(init?.headers).get('content-type')).toContain('application/json');
  });

  it('throws HttpError for non-ok responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'nope' }), {
        status: 400,
        statusText: 'Bad Request',
        headers: {
          'content-type': 'application/json'
        }
      })
    );

    const client = createHttpClient({
      baseUrl: 'https://api.example.com',
      fetchFn: fetchMock
    });

    await expect(client.get('/users/1')).rejects.toMatchObject({
      status: 400,
      statusText: 'Bad Request',
      body: { message: 'nope' }
    });
  });

  it('fills status text from http status reference when response statusText is empty', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'missing' }), {
        status: 404,
        headers: {
          'content-type': 'application/json'
        }
      })
    );

    const client = createHttpClient({
      baseUrl: 'https://api.example.com',
      fetchFn: fetchMock
    });

    await expect(client.get('/users/404')).rejects.toMatchObject({
      status: 404,
      statusText: 'Not Found'
    });
  });

  it('uses request timeout signal', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          'content-type': 'application/json'
        }
      })
    );

    const client = createHttpClient({
      baseUrl: 'https://api.example.com',
      fetchFn: fetchMock,
      timeoutMs: 1000
    });

    await client.get('/ping');

    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('retries retryable status codes and succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'temporary' }), {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'content-type': 'application/json' }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      );

    const client = createHttpClient({
      baseUrl: 'https://api.example.com',
      fetchFn: fetchMock,
      retry: {
        attempts: 1,
        delayMs: 1
      }
    });

    const data = await client.get<{ ok: boolean }>('/health');
    expect(data).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('applies proxy headers and dispatcher to request init', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    });
    const dispatcher = { name: 'proxy-dispatcher' };

    const client = createHttpClient({
      baseUrl: 'https://api.example.com',
      fetchFn: fetchMock,
      proxy: {
        dispatcher,
        headers: { 'x-proxy-auth': 'secret-token' }
      }
    });

    await client.get('/proxy-check');
    const [, init] = fetchMock.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);

    expect(headers.get('x-proxy-auth')).toBe('secret-token');
    expect((init as RequestInit & { dispatcher?: unknown }).dispatcher).toBe(dispatcher);
  });

  it('limits requests per second across concurrent calls', async () => {
    vi.useFakeTimers();

    const fetchMock = vi.fn().mockImplementation(async () => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    });

    const client = createHttpClient({
      baseUrl: 'https://api.example.com',
      fetchFn: fetchMock,
      requestsPerSecond: 1
    });

    const first = client.get('/one');
    const second = client.get('/two');

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await Promise.all([first, second]);
  });

  it('exports http status helpers and retryable status checks', () => {
    expect(getHttpStatusText(200)).toBe('OK');
    expect(getHttpStatusText(999)).toBeUndefined();
    expect(isRetryableHttpStatusCode(503)).toBe(true);
    expect(isRetryableHttpStatusCode(404)).toBe(false);
  });
});
