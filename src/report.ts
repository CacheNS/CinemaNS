import { build } from './build.js';
import { CINEMAS, CINEMA_IDS } from './core/types.js';
import { formatDayLabel } from './core/dates.js';

async function main(): Promise<void> {
  const snapshot = await build();

  console.log('\n=== IZVORI ===');
  for (const id of CINEMA_IDS) {
    const status = snapshot.sources[id];
    const flag = status.ok ? (status.stale ? 'STARO' : 'OK') : 'GREŠKA';
    console.log(
      `${flag.padEnd(6)} ${CINEMAS[id].name.padEnd(24)} ${String(status.movieCount).padStart(3)} filmova ${String(
        status.showtimeCount,
      ).padStart(4)} projekcija${status.error ? ` — ${status.error}` : ''}`,
    );
  }

  console.log('\n=== PO DANIMA ===');
  for (const day of snapshot.days) {
    const showtimes = snapshot.movies
      .flatMap((movie) => movie.showtimes)
      .filter((showtime) => showtime.date === day);
    const movies = snapshot.movies.filter((movie) =>
      movie.showtimes.some((showtime) => showtime.date === day),
    );
    console.log(
      `${day} ${formatDayLabel(day, snapshot.days[0]).padEnd(22)} ${String(movies.length).padStart(
        3,
      )} filmova ${String(showtimes.length).padStart(4)} projekcija`,
    );
  }

  console.log('\n=== TMDb ===');
  console.log(
    `Razrešeno: ${snapshot.diagnostics.tmdbResolved}/${
      snapshot.diagnostics.tmdbResolved + snapshot.diagnostics.tmdbUnresolved
    }`,
  );
  if (snapshot.diagnostics.unresolvedTitles.length) {
    console.log('Nerazrešeni naslovi:');
    for (const title of snapshot.diagnostics.unresolvedTitles) console.log(`  - ${title}`);
  }

  console.log('\n=== SPAJANJE VIŠE BIOSKOPA ===');
  const shared = snapshot.movies.filter(
    (movie) => new Set(movie.showtimes.map((s) => s.cinemaId)).size > 1,
  );
  for (const movie of shared) {
    const cinemas = [...new Set(movie.showtimes.map((s) => s.cinemaId))].join(', ');
    console.log(`${movie.title} [${cinemas}] aliasi: ${movie.aliases.join(' | ')}`);
  }

  console.log('\n=== UZRAST ===');
  const noRating = snapshot.movies.filter((movie) => !movie.ageRating);
  const estimated = snapshot.movies.filter((movie) => movie.ageRating && !movie.ageRating.confident);
  console.log(`Bez oznake: ${noRating.length} · procena: ${estimated.length}`);
  for (const movie of noRating) console.log(`  ? ${movie.title}`);

  console.log('\n=== JEZIK PROJEKCIJA ===');
  const all = snapshot.movies.flatMap((movie) => movie.showtimes);
  for (const audio of ['dubbed', 'subtitled', 'unknown'] as const) {
    console.log(`${audio.padEnd(10)} ${all.filter((s) => s.audio === audio).length}`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
