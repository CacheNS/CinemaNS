import { setTimeout as delay } from 'node:timers/promises';

const DEFAULT_TIMEOUT_MS = Number(process.env['REQUEST_TIMEOUT_MS'] ?? 20_000);
const USER_AGENT =
  process.env['USER_AGENT'] ??
  'CinemaNS/1.0 (+https://github.com/CacheNS/CinemaNS) hourly repertoire aggregator';

/** Minimum gap between requests to the same host, so we stay a polite guest. */
const HOST_DELAY_MS = 300;

const lastRequestByHost = new Map<string, number>();
const inFlightByHost = new Map<string, Promise<unknown>>();

async function politeGate(host: string): Promise<void> {
  const previous = inFlightByHost.get(host) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  inFlightByHost.set(
    host,
    previous.then(() => gate),
  );
  await previous;

  const last = lastRequestByHost.get(host);
  if (last !== undefined) {
    const wait = HOST_DELAY_MS - (Date.now() - last);
    if (wait > 0) await delay(wait);
  }
  lastRequestByHost.set(host, Date.now());
  // Release the gate on the next tick so callers queue rather than pile up.
  queueMicrotask(release);
}

export interface FetchOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
  /** Treat these status codes as an empty (not failed) result. */
  acceptEmptyStatus?: number[];
}

export class HttpError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
  ) {
    super(`HTTP ${status} for ${url}`);
    this.name = 'HttpError';
  }
}

async function fetchOnce(url: string, options: FetchOptions): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  try {
    return await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'sr-RS,sr;q=0.9,en;q=0.8',
        ...options.headers,
      },
      signal: controller.signal,
      redirect: 'follow',
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function request(url: string, options: FetchOptions): Promise<Response> {
  const host = new URL(url).host;
  const retries = options.retries ?? 2;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await delay(500 * 2 ** (attempt - 1));
    await politeGate(host);
    try {
      const response = await fetchOnce(url, options);
      if (response.ok) return response;
      if (options.acceptEmptyStatus?.includes(response.status)) return response;
      // 4xx other than 429 will not improve on retry.
      if (response.status < 500 && response.status !== 429) {
        throw new HttpError(url, response.status);
      }
      lastError = new HttpError(url, response.status);
    } catch (error) {
      if (error instanceof HttpError && error.status < 500 && error.status !== 429) {
        throw error;
      }
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function fetchText(url: string, options: FetchOptions = {}): Promise<string> {
  const response = await request(url, options);
  return response.text();
}

export async function fetchJson<T>(url: string, options: FetchOptions = {}): Promise<T> {
  const response = await request(url, {
    ...options,
    headers: { Accept: 'application/json', ...options.headers },
  });
  return (await response.json()) as T;
}

/** Runs tasks with bounded concurrency, preserving input order in the output. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function run(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]!, index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}
