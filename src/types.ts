export type QueryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Array<string | number | boolean | null | undefined>;

export type QueryParams = Record<string, QueryValue>;

export interface ProxyConfig {
  dispatcher?: unknown;
  headers?: HeadersInit;
}

export interface RetryConfig {
  attempts?: number;
  delayMs?: number;
  maxDelayMs?: number;
  backoffFactor?: number;
  retryOnStatuses?: number[];
  retryOnMethods?: string[];
}

export interface HttpClientConfig {
  baseUrl?: string;
  headers?: HeadersInit;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  proxy?: ProxyConfig;
  retry?: RetryConfig;
  requestsPerSecond?: number;
}

export interface RequestOptions extends Omit<RequestInit, 'body' | 'headers'> {
  headers?: HeadersInit;
  query?: QueryParams;
  json?: unknown;
  body?: BodyInit | null;
  timeoutMs?: number;
  proxy?: ProxyConfig | false;
  retry?: RetryConfig | false;
}

export interface RequestResult<T> {
  data: T;
  response: Response;
}

export interface HttpClient {
  request<T = unknown>(path: string, options?: RequestOptions): Promise<T>;
  get<T = unknown>(path: string, options?: RequestOptions): Promise<T>;
  post<T = unknown>(path: string, options?: RequestOptions): Promise<T>;
  put<T = unknown>(path: string, options?: RequestOptions): Promise<T>;
  patch<T = unknown>(path: string, options?: RequestOptions): Promise<T>;
  delete<T = unknown>(path: string, options?: RequestOptions): Promise<T>;
}
