import { setTimeout as delay } from 'node:timers/promises';

import { ImpersonateUnavailableError, fetchTextImpersonated } from './impersonate.js';

const DEFAULT_TIMEOUT_MS = Number(process.env['REQUEST_TIMEOUT_MS'] ?? 20_000);
const USER_AGENT =
  process.env['USER_AGENT'] ??
  'Kokice/1.0 (+https://kokice.org) hourly repertoire aggregator';

/**
 * Hard ceiling on any single response body. Cinema pages and API payloads are
 * tens of kilobytes; this is generous by three orders of magnitude and exists
 * only so a hostile or misconfigured upstream cannot stream until the runner
 * runs out of memory. The body is counted while streaming, so an oversized
 * response is abandoned rather than buffered and then rejected.
 */
const MAX_BODY_BYTES = Number(process.env['MAX_BODY_BYTES'] ?? 8 * 1024 * 1024);

/**
 * Redirects are followed by hand rather than by the runtime, so the hop count
 * is ours rather than a library default (undici allows 20), and so every hop
 * can be checked for a sane scheme. A cinema site that redirects more than a
 * few times is broken or hostile either way.
 */
const MAX_REDIRECTS = 5;

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

/**
 * Browser-shaped headers, sent to hosts behind bot protection. Measured on a CI
 * runner against CineStar: these alone do NOT clear Cloudflare's managed
 * challenge (403 with a "Just a moment..." body), because the challenge
 * fingerprints the TLS handshake rather than the headers — headless Chromium
 * was refused too, and only a replayed Chrome handshake got 200. They are still
 * sent because they cost nothing and satisfy weaker filters, but the actual
 * remedy is `tlsFallback`.
 */
const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'sr-RS,sr;q=0.9,en;q=0.8',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'sec-ch-ua': '"Chromium";v="120", "Not(A:Brand";v="24", "Google Chrome";v="120"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
};

export interface FetchOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
  /** Treat these status codes as an empty (not failed) result. */
  acceptEmptyStatus?: number[];
  /** Present as a browser. Needed for hosts behind bot protection. */
  browserLike?: boolean;
  /** Overrides the default response body ceiling for this request. */
  maxBytes?: number;
  /**
   * On 403, retry through a client that replays a real Chrome TLS handshake.
   * Only this clears Cloudflare's managed challenge; see BROWSER_HEADERS.
   */
  tlsFallback?: boolean;
}

export class HttpError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
  ) {
    super(`HTTP ${status} for ${redactQuery(url)}`);
    this.name = 'HttpError';
  }
}

/**
 * TMDb's URL carries `api_key` as a query parameter, so any message built from
 * a raw URL is one stray `console.error` away from printing the key into a
 * public CI log. Nothing does that today, but the query string adds nothing a
 * maintainer needs to diagnose a failing fetch, so it never reaches `.message`
 * at all rather than relying on every future call site to remember to redact.
 */
function redactQuery(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.search ? `${parsed.origin}${parsed.pathname} (upitni string sakriven)` : url;
  } catch {
    return url;
  }
}

/**
 * A response whose body has already been read under the request deadline.
 * `ok` means "usable" rather than strictly 2xx: a status the caller opted into
 * via `acceptEmptyStatus` counts as usable too.
 */
interface Fetched {
  status: number;
  ok: boolean;
  body: string;
}

export class ResponseTooLargeError extends Error {
  constructor(
    readonly url: string,
    readonly limit: number,
  ) {
    super(`Odgovor sa ${url} prelazi ${limit} bajtova`);
    this.name = 'ResponseTooLargeError';
  }
}

/**
 * Reads a body while counting bytes, aborting as soon as the cap is passed.
 * `response.text()` would buffer the whole thing first, which is exactly the
 * failure mode this exists to prevent.
 */
async function readCapped(
  url: string,
  response: Response,
  limit: number,
  signal: AbortSignal,
): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? Number.NaN);
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel();
    throw new ResponseTooLargeError(url, limit);
  }

  if (!response.body) return '';

  const chunks: Buffer[] = [];
  let total = 0;
  const reader = response.body.getReader();
  // Cancelling the reader unblocks a pending read, so an upstream that stalls
  // mid-body loses to the deadline instead of hanging the build forever.
  const onAbort = (): void => void reader.cancel().catch(() => undefined);
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (signal.aborted) throw new Error(`Isteklo vreme pri čitanju odgovora sa ${url}`);
      if (done) break;
      total += value.byteLength;
      if (total > limit) throw new ResponseTooLargeError(url, limit);
      chunks.push(Buffer.from(value));
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
    reader.releaseLock();
    if (total > limit) await response.body.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function requestHeaders(options: FetchOptions): Record<string, string> {
  return options.browserLike
    ? { ...BROWSER_HEADERS, ...options.headers }
    : {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'sr-RS,sr;q=0.9,en;q=0.8',
        ...options.headers,
      };
}

/**
 * One attempt: follows redirects by hand, then reads the body — all while the
 * abort timer is still armed. The timer used to be cleared as soon as headers
 * arrived, which left a stalled body able to hang the build indefinitely.
 */
async function fetchOnce(url: string, options: FetchOptions): Promise<Fetched> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  try {
    let current = url;
    for (let hop = 0; ; hop++) {
      const response = await fetch(current, {
        headers: requestHeaders(options),
        signal: controller.signal,
        redirect: 'manual',
      });

      const location = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && location) {
        if (hop >= MAX_REDIRECTS) {
          await response.body?.cancel();
          throw new Error(`Previše preusmeravanja za ${url}`);
        }
        const next = new URL(location, current);
        if (next.protocol !== 'http:' && next.protocol !== 'https:') {
          await response.body?.cancel();
          throw new Error(`Nedozvoljena šema u preusmeravanju za ${url}: ${next.protocol}`);
        }
        await response.body?.cancel();
        current = next.toString();
        continue;
      }

      const wanted = response.ok || options.acceptEmptyStatus?.includes(response.status);
      if (!wanted) {
        // Never download an error page; the status is the whole message.
        await response.body?.cancel().catch(() => undefined);
        return { status: response.status, ok: false, body: '' };
      }
      return {
        status: response.status,
        ok: true,
        body: await readCapped(
          current,
          response,
          options.maxBytes ?? MAX_BODY_BYTES,
          controller.signal,
        ),
      };
    }
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * 4xx normally means "asking again will not help", but a 403 from bot
 * protection is a scoring decision rather than a statement about the resource,
 * and it does sometimes pass on a later attempt.
 */
function worthRetrying(status: number): boolean {
  return status >= 500 || status === 429 || status === 403;
}

async function request(url: string, options: FetchOptions): Promise<Fetched> {
  const host = new URL(url).host;
  const retries = options.retries ?? 2;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await delay(500 * 2 ** (attempt - 1));
    await politeGate(host);
    try {
      const response = await fetchOnce(url, options);
      if (response.ok) return response;
      if (!worthRetrying(response.status)) {
        throw new HttpError(url, response.status);
      }
      lastError = new HttpError(url, response.status);
    } catch (error) {
      if (error instanceof HttpError && !worthRetrying(error.status)) {
        throw error;
      }
      // An oversized body will be oversized again; retrying only wastes time.
      if (error instanceof ResponseTooLargeError) throw error;
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function fetchText(url: string, options: FetchOptions = {}): Promise<string> {
  try {
    const response = await request(url, options);
    return response.body;
  } catch (error) {
    if (!options.tlsFallback || !(error instanceof HttpError) || error.status !== 403) {
      throw error;
    }
    try {
      return await fetchTextImpersonated(url);
    } catch (fallbackError) {
      // The original 403 is the more useful diagnosis; a missing interpreter is
      // only worth reporting because it explains why the fallback did nothing.
      if (fallbackError instanceof ImpersonateUnavailableError) throw error;
      throw fallbackError;
    }
  }
}

export async function fetchJson<T>(url: string, options: FetchOptions = {}): Promise<T> {
  const response = await request(url, {
    ...options,
    headers: { Accept: 'application/json', ...options.headers },
  });
  return JSON.parse(response.body) as T;
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
