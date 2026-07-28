# @rockcoredev/http

Легковесный изоморфный HTTP-клиент на TypeScript поверх `fetch`.

Подходит для Node.js 18+, браузера и edge/runtime окружений.

## Что умеет

- Типизированные запросы и ответы
- `json`-body с авто-`content-type`
- Query-параметры
- Таймаут на запрос
- Retry с backoff
- Ограничение запросов в секунду (RPS)
- Proxy-конфиг для Node/undici-сценариев
- `HttpError` с деталями ответа
- Встроенный справочник HTTP-кодов

## Установка

```bash
yarn add @rockcoredev/http
```

## Быстрый старт

```ts
import { createHttpClient } from '@rockcoredev/http';

type User = {
  id: string;
  name: string;
};

const http = createHttpClient({
  baseUrl: 'https://api.example.com',
  timeoutMs: 5000,
  headers: {
    authorization: 'Bearer <token>'
  }
});

const user = await http.get<User>('/users/1');

await http.post('/users', {
  json: { name: 'Alice' }
});
```

## Основное использование

### GET с query

```ts
const users = await http.get<Array<{ id: string; name: string }>>('/users', {
  query: {
    page: 1,
    limit: 20,
    active: true
  }
});
```

### POST с JSON

```ts
const created = await http.post<{ id: string }>('/users', {
  json: { name: 'Bob' }
});
```

### Произвольный метод через `request`

```ts
const result = await http.request<{ ok: boolean }>('/resources/1', {
  method: 'PATCH',
  json: { enabled: false }
});
```

## Обработка ошибок

Для не-2xx ответов бросается `HttpError`:

```ts
import { HttpError } from '@rockcoredev/http';

try {
  await http.get('/private');
} catch (error) {
  if (error instanceof HttpError) {
    console.error(error.status); // 401
    console.error(error.statusText); // Unauthorized
    console.error(error.url);
    console.error(error.body); // parsed JSON/text if possible
  }
}
```

## Retry

По умолчанию retry применяется к идемпотентным методам и retryable HTTP-кодам.

```ts
const http = createHttpClient({
  baseUrl: 'https://api.example.com',
  retry: {
    attempts: 3,
    delayMs: 200,
    backoffFactor: 2,
    maxDelayMs: 2000
  }
});
```

Отключить retry для конкретного запроса:

```ts
await http.get('/health', { retry: false });
```

## Лимит запросов (RPS)

```ts
const http = createHttpClient({
  baseUrl: 'https://api.example.com',
  requestsPerSecond: 10
});
```

Этот лимит общий для всех параллельных запросов данного экземпляра клиента.

## Proxy (Node/undici-сценарии)

```ts
const http = createHttpClient({
  baseUrl: 'https://api.example.com',
  proxy: {
    headers: {
      'x-proxy-auth': 'proxy-token'
    },
    dispatcher: myUndiciDispatcher
  }
});
```

Отключить proxy для конкретного вызова:

```ts
await http.get('/public', { proxy: false });
```

## Справочник HTTP-кодов

Пакет экспортирует справочник и хелперы:

- `HTTP_STATUS_TEXTS`
- `getHttpStatusText(code)`
- `RETRYABLE_HTTP_STATUS_CODES`
- `isRetryableHttpStatusCode(code)`

Пример:

```ts
import {
  getHttpStatusText,
  isRetryableHttpStatusCode
} from '@rockcoredev/http';

getHttpStatusText(404); // 'Not Found'
isRetryableHttpStatusCode(503); // true
```

## API справка

### `createHttpClient(config?)`

- `baseUrl?: string`
- `headers?: HeadersInit`
- `timeoutMs?: number`
- `fetchFn?: typeof fetch` (удобно для тестов)
- `requestsPerSecond?: number`
- `retry?: RetryConfig`
- `proxy?: ProxyConfig`

### Методы клиента

- `request<T>(path, options?)`
- `get<T>(path, options?)`
- `post<T>(path, options?)`
- `put<T>(path, options?)`
- `patch<T>(path, options?)`
- `delete<T>(path, options?)`

### `RequestOptions`

Надстройка над `RequestInit`:

- `query?: Record<string, ...>`
- `json?: unknown`
- `timeoutMs?: number`
- `retry?: RetryConfig | false`
- `proxy?: ProxyConfig | false`

### `RetryConfig`

- `attempts?: number`
- `delayMs?: number`
- `maxDelayMs?: number`
- `backoffFactor?: number`
- `retryOnStatuses?: number[]`
- `retryOnMethods?: string[]`

### `ProxyConfig`

- `headers?: HeadersInit`
- `dispatcher?: unknown`

## Требования

- Node.js `>=18` (или современный runtime с `fetch`, `AbortController`, `Headers`)

## Для разработки библиотеки

```bash
yarn install
yarn lint
yarn typecheck
yarn test:run
yarn build
yarn check:pkg
```

## Публикация

- После мержа PR в `master` запускается workflow `Release`.
- `Release` поднимает patch-версию в `package.json`, пушит коммит `chore(release): bump version to vX.Y.Z` и затем явно вызывает workflow `Publish` через `workflow_dispatch`.
- `Publish` отдельно собирает и публикует пакет в npm.
- Публикация выполняется только если версия из `package.json` еще не существует в npm.
- Публикация настроена через npm Trusted Publishing (GitHub OIDC), `NPM_TOKEN` не нужен.
- В npm нужно один раз связать пакет `@rockcoredev/http` с этим GitHub-репозиторием как trusted publisher.
