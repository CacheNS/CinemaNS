import { spawn } from 'node:child_process';

/**
 * Cloudflare's managed challenge fingerprints the TLS handshake, so Node's
 * fetch is refused no matter what headers it sends. curl_cffi replays a real
 * Chrome handshake, which is the only thing observed to get through: a probe
 * on the CI runner returned 403 for Node fetch, 403 for curl with full browser
 * headers, 403 even for headless Chromium, and 200 for this.
 */
const SCRIPT = `
import sys
from curl_cffi import requests
r = requests.get(sys.argv[1], impersonate="chrome", timeout=45)
if r.status_code != 200:
    sys.stderr.write("status %d" % r.status_code)
    sys.exit(1)
sys.stdout.buffer.write(r.content)
`;

const CANDIDATES = ['python3', 'python'];

/**
 * The Python side already has a request timeout, but nothing bounded the child
 * process itself: an interpreter that hung after its request — or one blocked
 * writing to a full pipe — would stall the hourly build forever with no way to
 * reap it. These two ceilings make the subprocess as bounded as a native fetch.
 */
const SUBPROCESS_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

let cachedInterpreter: string | null | undefined;

function tryRun(command: string, args: string[]): Promise<{ ok: boolean; out: Buffer; err: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    let err = '';
    let size = 0;
    let settled = false;

    const finish = (result: { ok: boolean; out: Buffer; err: string }): void => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      // SIGKILL rather than SIGTERM: a wedged interpreter may never handle a
      // polite signal, and this path only runs when it is already misbehaving.
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      resolve(result);
    };

    const deadline = setTimeout(
      () =>
        finish({
          ok: false,
          out: Buffer.alloc(0),
          err: `nema odgovora nakon ${SUBPROCESS_TIMEOUT_MS} ms`,
        }),
      SUBPROCESS_TIMEOUT_MS,
    );

    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > MAX_OUTPUT_BYTES) {
        finish({ ok: false, out: Buffer.alloc(0), err: 'odgovor je prevelik' });
        return;
      }
      out.push(chunk);
    });
    // Bounded too, so a chatty failure cannot grow without limit.
    child.stderr.on('data', (chunk: Buffer) => {
      if (err.length < 4096) err += chunk.toString('utf8');
    });
    child.on('error', (error) => finish({ ok: false, out: Buffer.alloc(0), err: error.message }));
    child.on('close', (code) => finish({ ok: code === 0, out: Buffer.concat(out), err }));
  });
}

/** Finds a Python that can import curl_cffi, or null. Probed once per build. */
async function findInterpreter(): Promise<string | null> {
  if (cachedInterpreter !== undefined) return cachedInterpreter;
  if (process.env['KOKICE_DISABLE_IMPERSONATE'] === '1') {
    cachedInterpreter = null;
    return null;
  }
  for (const candidate of CANDIDATES) {
    const probe = await tryRun(candidate, ['-c', 'import curl_cffi']);
    if (probe.ok) {
      cachedInterpreter = candidate;
      return candidate;
    }
  }
  cachedInterpreter = null;
  return null;
}

export class ImpersonateUnavailableError extends Error {
  constructor() {
    super('curl_cffi nije dostupan (potreban je Python sa curl_cffi paketom)');
    this.name = 'ImpersonateUnavailableError';
  }
}

/**
 * Fetches a page using a browser TLS fingerprint. Throws
 * ImpersonateUnavailableError when no suitable Python is installed, so callers
 * can report the original HTTP failure instead of this one.
 */
export async function fetchTextImpersonated(url: string): Promise<string> {
  const interpreter = await findInterpreter();
  if (!interpreter) throw new ImpersonateUnavailableError();

  const result = await tryRun(interpreter, ['-c', SCRIPT, url]);
  if (!result.ok) throw new Error(`curl_cffi neuspeh za ${url}: ${result.err.trim()}`);
  return result.out.toString('utf8');
}

/** Test seam: forget the probed interpreter. */
export function resetInterpreterCache(): void {
  cachedInterpreter = undefined;
}
