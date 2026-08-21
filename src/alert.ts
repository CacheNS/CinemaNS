import { readFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { CINEMAS } from './core/types.js';
import type { CinemaId, Snapshot, SourceStatus } from './core/types.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/** A single failed run is usually a transient blip (R-11.8); only a repeat is worth paging anyone about. */
const ALERT_THRESHOLD = 2;

/**
 * One line per venue that has failed for `ALERT_THRESHOLD` builds in a row —
 * even a venue the UI never shows as broken, because R-11.2's cached fallback
 * quietly papered over it. That gap between "the site looks fine" and "a
 * scraper is actually failing" is exactly what this surfaces to a maintainer
 * instead of a reader.
 */
export function describeDegradedSources(
  sources: Partial<Record<CinemaId, SourceStatus>>,
): string[] {
  return Object.entries(sources)
    .filter(
      (entry): entry is [CinemaId, SourceStatus] =>
        Boolean(entry[1]?.error) && (entry[1]?.consecutiveFailures ?? 1) >= ALERT_THRESHOLD,
    )
    .map(([id, status]) => {
      const name = CINEMAS[id]?.name ?? id;
      const fallback = status.ok
        ? `koristi zastarele podatke od ${status.fetchedAt}`
        : 'nema nikakvih podataka';
      return `${name}: ${fallback} — ${status.error} (${status.consecutiveFailures}. uzastopni neuspeh)`;
    });
}

async function writeOutput(name: string, value: string): Promise<void> {
  const outputPath = process.env['GITHUB_OUTPUT'];
  if (!outputPath) return;
  if (!value.includes('\n')) {
    await appendFile(outputPath, `${name}=${value}\n`);
    return;
  }
  const delimiter = `ghadelimiter_${Math.random().toString(36).slice(2)}`;
  await appendFile(outputPath, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
}

async function main(): Promise<void> {
  const snapshot = JSON.parse(
    await readFile(path.join(ROOT, 'dist', 'data.json'), 'utf8'),
  ) as Snapshot;

  const degraded = describeDegradedSources(snapshot.sources);
  const body = degraded.length
    ? `${degraded.length} od ${
        Object.keys(snapshot.sources).length
      } izvora nije uspelo da osveži podatke u build-u od ${snapshot.generatedAt}:\n\n${degraded
        .map((line) => `- ${line}`)
        .join('\n')}`
    : `Svi izvori su uspešno osveženi u build-u od ${snapshot.generatedAt}.`;

  console.log(body);
  await writeOutput('degraded', String(degraded.length > 0));
  await writeOutput('body', body);
}

// Only run when invoked directly, same convention as build.ts.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
