import { HttpError } from './errors';
import { getHttpStatusText, RETRYABLE_HTTP_STATUS_CODES } from './http-status';
import type {
  HttpClient,
  HttpClientConfig,
  ProxyConfig,
  QueryParams,
  RequestOptions,
  RetryConfig
} from './types';

const DEFAULT_TIMEOUT_MS = 30_000;
const JSON_CONTENT_TYPE = 'application/json';
const DEFAULT_RETRY_STATUSES = [...RETRYABLE_HTTP_STATUS_CODES];
const DEFAULT_RETRY_METHODS = ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE'];
const DEFAULT_RETRY_DELAY_MS = 150;
const DEFAULT_RETRY_BACKOFF_FACTOR = 2;
const DEFAULT_MAX_RETRY_DELAY_MS = 5000;

function appendQuery(url: URL, query?: QueryParams): void {
  if (!query) {
    return;
  }

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined) {
          url.searchParams.append(key, String(item));
        }
      }
      continue;
    }

    if (value === null) {
      url.searchParams.append(key, '');
      continue;
    }

    url.searchParams.append(key, String(value));
  }
}

function getBaseOrigin(): string | undefined {
  if (typeof globalThis.location !== 'undefined') {
    return globalThis.location.origin;
  }
  return undefined;
}

function createRequestUrl(path: string, baseUrl?: string, query?: QueryParams): URL {
  const fallbackBase = getBaseOrigin();

  if (!baseUrl && !fallbackBase && !/^https?:\/\//i.test(path)) {
    throw new Error('Absolute URL or baseUrl is required in non-browser runtime.');
  }

  const url = baseUrl
    ? new URL(path, baseUrl)
    : /^https?:\/\//i.test(path)
      ? new URL(path)
      : new URL(path, fallbackBase);

  appendQuery(url, query);
  return url;
}

function mergeHeaders(defaultHeaders?: HeadersInit, requestHeaders?: HeadersInit): Headers {
  const headers = new Headers(defaultHeaders);
  if (requestHeaders) {
    const next = new Headers(requestHeaders);
    for (const [key, value] of next.entries()) {
      headers.set(key, value);
    }
  }
  return headers;
}

function mergeSignals(timeoutSignal: AbortSignal, userSignal?: AbortSignal): AbortSignal {
  if (!userSignal) {
    return timeoutSignal;
  }

  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any([timeoutSignal, userSignal]);
  }

  if (userSignal.aborted) {
    return userSignal;
  }

  const controller = new AbortController();
  const abort = (): void => controller.abort();
  timeoutSignal.addEventListener("abort", abort, { once: true });
  userSignal.addEventListener("abort", abort, { once: true });
  return controller.signal;
}

async function parseResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204 || response.status === 205) {
    return undefined;
  }

  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes(JSON_CONTENT_TYPE)) {
    return response.json();
  }

  if (contentType.startsWith('text/')) {
    return response.text();
  }

  if (!contentType) {
    const text = await response.text();
    return text.length > 0 ? text : undefined;
  }

  return response.arrayBuffer();
}

function createRequestInit(
  defaultHeaders: HeadersInit | undefined,
  options: RequestOptions | undefined,
  timeoutMs: number,
  proxy: ProxyConfig | undefined
): RequestInit {
  const proxyHeaders = proxy?.headers;
  const headers = mergeHeaders(mergeHeaders(defaultHeaders, proxyHeaders), options?.headers);
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = mergeSignals(timeoutSignal, options?.signal ?? undefined);

  const init: RequestInit = {
    method: options?.method ?? 'GET',
    headers,
    credentials: options?.credentials,
    cache: options?.cache,
    integrity: options?.integrity,
    keepalive: options?.keepalive,
    mode: options?.mode,
    redirect: options?.redirect,
    referrer: options?.referrer,
    referrerPolicy: options?.referrerPolicy,
    signal
  };

  if (options?.json !== undefined) {
    if (!headers.has('content-type')) {
      headers.set('content-type', JSON_CONTENT_TYPE);
    }
    init.body = JSON.stringify(options.json);
  } else if (options?.body !== undefined) {
    init.body = options.body;
  }

  if (proxy?.dispatcher) {
    (init as RequestInit & { dispatcher?: unknown }).dispatcher = proxy.dispatcher;
  }

  return init;
}

function normalizeMethod(method: string | undefined): string {
  return (method ?? 'GET').toUpperCase();
}

function resolveRetryConfig(
  defaultRetry: RetryConfig | undefined,
  requestRetry: RetryConfig | false | undefined
): Required<RetryConfig> | null {
  if (requestRetry === false) {
    return null;
  }

  const retry = { ...defaultRetry, ...requestRetry };
  const attempts = Math.max(0, Math.floor(retry.attempts ?? 0));

  return {
    attempts,
    delayMs: retry.delayMs ?? DEFAULT_RETRY_DELAY_MS,
    maxDelayMs: retry.maxDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS,
    backoffFactor: retry.backoffFactor ?? DEFAULT_RETRY_BACKOFF_FACTOR,
    retryOnStatuses: retry.retryOnStatuses ?? DEFAULT_RETRY_STATUSES,
    retryOnMethods: (retry.retryOnMethods ?? DEFAULT_RETRY_METHODS).map((item) => item.toUpperCase())
  };
}

function shouldRetryError(error: unknown): boolean {
  if (error instanceof HttpError) {
    return false;
  }

  if (error instanceof DOMException && error.name === 'AbortError') {
    return false;
  }

  if (error instanceof Error && error.name === 'AbortError') {
    return false;
  }

  return true;
}

function shouldRetryStatus(status: number, retryOnStatuses: number[]): boolean {
  return retryOnStatuses.includes(status);
}

function computeRetryDelayMs(retry: Required<RetryConfig>, attempt: number): number {
  const exponentialDelay = retry.delayMs * retry.backoffFactor ** Math.max(0, attempt - 1);
  return Math.min(exponentialDelay, retry.maxDelayMs);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createRateLimiter(requestsPerSecond: number | undefined): () => Promise<void> {
  if (!requestsPerSecond || requestsPerSecond <= 0) {
    return async () => {};
  }

  const intervalMs = 1000 / requestsPerSecond;
  let nextAvailableAt = 0;
  let queue = Promise.resolve();

  return async () => {
    const task = queue.then(async () => {
      const now = Date.now();
      const startAt = Math.max(now, nextAvailableAt);
      const waitMs = startAt - now;
      nextAvailableAt = startAt + intervalMs;

      if (waitMs > 0) {
        await sleep(waitMs);
      }
    });

    queue = task.catch(() => {});
    await task;
  };
}

function resolveProxyConfig(
  defaultProxy: ProxyConfig | undefined,
  requestProxy: ProxyConfig | false | undefined
): ProxyConfig | undefined {
  if (requestProxy === false) {
    return undefined;
  }

  if (!defaultProxy && !requestProxy) {
    return undefined;
  }

  return {
    ...defaultProxy,
    ...requestProxy
  };
}

function withMethod(method: string, options?: RequestOptions): RequestOptions {
  return {
    ...options,
    method
  };
}

export function createHttpClient(config: HttpClientConfig = {}): HttpClient {
  const {
    baseUrl,
    headers: defaultHeaders,
    timeoutMs: defaultTimeoutMs = DEFAULT_TIMEOUT_MS,
    fetchFn = fetch,
    proxy: defaultProxy,
    retry: defaultRetry,
    requestsPerSecond
  } = config;
  const rateLimit = createRateLimiter(requestsPerSecond);

  const request = async <T = unknown>(path: string, options: RequestOptions = {}): Promise<T> => {
    const url = createRequestUrl(path, baseUrl, options.query);
    const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
    const method = normalizeMethod(options.method);
    const retry = resolveRetryConfig(defaultRetry, options.retry);
    const proxy = resolveProxyConfig(defaultProxy, options.proxy);
    const retryableMethod = retry ? retry.retryOnMethods.includes(method) : false;

    let attempt = 0;

    while (true) {
      await rateLimit();
      const init = createRequestInit(defaultHeaders, options, timeoutMs, proxy);

      try {
        const response = await fetchFn(url, init);

        if (response.ok) {
          return (await parseResponseBody(response)) as T;
        }

        const canRetry =
          retry !== null &&
          retryableMethod &&
          attempt < retry.attempts &&
          shouldRetryStatus(response.status, retry.retryOnStatuses);

        if (canRetry) {
          void response.body?.cancel();
          attempt += 1;
          await sleep(computeRetryDelayMs(retry, attempt));
          continue;
        }

        const parsedBody = await parseResponseBody(response);
        const statusText = response.statusText || getHttpStatusText(response.status) || 'Unknown Status';
        throw new HttpError(
          `Request failed with status ${response.status} ${statusText}`,
          {
            status: response.status,
            statusText,
            url: url.toString(),
            response,
            body: parsedBody
          }
        );
      } catch (error) {
        const canRetry =
          retry !== null && retryableMethod && attempt < retry.attempts && shouldRetryError(error);

        if (!canRetry) {
          throw error;
        }

        attempt += 1;
        await sleep(computeRetryDelayMs(retry, attempt));
      }
    }
  };

  return {
    request,
    get: <T = unknown>(path: string, options?: RequestOptions): Promise<T> =>
      request<T>(path, withMethod('GET', options)),
    post: <T = unknown>(path: string, options?: RequestOptions): Promise<T> =>
      request<T>(path, withMethod('POST', options)),
    put: <T = unknown>(path: string, options?: RequestOptions): Promise<T> =>
      request<T>(path, withMethod('PUT', options)),
    patch: <T = unknown>(path: string, options?: RequestOptions): Promise<T> =>
      request<T>(path, withMethod('PATCH', options)),
    delete: <T = unknown>(path: string, options?: RequestOptions): Promise<T> =>
      request<T>(path, withMethod('DELETE', options))
  };
}
