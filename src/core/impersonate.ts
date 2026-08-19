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

let cachedInterpreter: string | null | undefined;

function tryRun(command: string, args: string[]): Promise<{ ok: boolean; out: Buffer; err: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    let err = '';
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => (err += chunk.toString('utf8')));
    child.on('error', (error) => resolve({ ok: false, out: Buffer.alloc(0), err: error.message }));
    child.on('close', (code) => resolve({ ok: code === 0, out: Buffer.concat(out), err }));
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
