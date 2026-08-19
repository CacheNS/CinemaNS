# Bioskopi u Novom Sadu

Objedinjen repertoar tri novosadska bioskopa na jednoj brzoj stranici:

| Bioskop | Izvor |
|---|---|
| Arena Cineplex Centar | HTML stranice filmova na `arenacineplex.com` |
| Cineplexx Promenada | JSON API `app.cineplexx.rs/api/v1` |
| CineStar BIG | HTML stranica `cinestarcinemas.rs/novi-sad-big` |

Prikazuje današnji dan i narednih 7 dana, grupisano po filmu, sa uzrasnim
oznakama, ocenom publike, trajanjem, formatom (2D/3D/4DX/IMAX/ScreenX) i
oznakom da li je projekcija sinhronizovana ili titlovana.

## Kako radi

Nema servera. GitHub Actions svakog sata pokrene build koji skenira sva tri
sajta, spoji filmove i generiše statične HTML stranice; GitHub Pages ih servira
sa CDN-a. Zahtev korisnika nikada ne pokreće skrejpovanje, pa je stranica
trenutna i ne može da "padne" — najgori slučaj je da su podaci malo stariji.

```
GitHub Actions (cron, na sat vremena)
  arena | cineplexx | cinestar  (paralelno)
            ↓
     TMDb (naslovi, uzrast, ocene)
            ↓
     spajanje po filmu → dist/ → GitHub Pages
```

### Spajanje naslova

Isti film se u svakom bioskopu piše drugačije, čas na srpskom, čas na engleskom
("SPAJDERMEN:NOVI DAN" / "Spajdermen: Novi dan 3D" / "Spider-Man: Brand New
Day"). Naslovi se prvo normalizuju (ćirilica → latinica, uklanjanje dijakritika
i oznaka formata), a zatim se, kada je TMDb dostupan, film svodi na TMDb id koji
je stvarni ključ spajanja. Bez TMDb ključa spajanje pada na poređenje svih
varijanti naslova (Dice sličnost). Izuzeci se ručno rešavaju u
`data/title-overrides.json` bez promene koda.

### Uzrast i ocene

Bioskopi ne objavljuju upotrebljivu uzrasnu oznaku (Cineplexx za svaki film
vraća `o.A.`), pa se koristi TMDb: sertifikacija po redosledu RS → HR → SI →
DE/AT → GB → US, svedena na broj godina. Kada sertifikata nema, koristi se
procena po žanru koja je vidljivo označena kao procena. Ocena publike je TMDb
`vote_average` i prikazuje se tek od 20 glasova naviše.

**Bez `TMDB_API_KEY` sajt i dalje radi**, ali nema uzrasnih oznaka ni ocena, a
filtriranje "Za decu" oslanja se samo na žanr.

## Lokalno pokretanje

```bash
npm install
cp .env.example .env      # pa upiši TMDB_API_KEY (opciono, ali preporučeno)

npm run build             # skrejpuje sve i generiše dist/
npm run serve             # http://localhost:3000
npm run report            # dijagnostika bez generisanja sajta
npm test                  # testovi na sačuvanim fixture fajlovima, bez mreže
```

`npm run report` ispisuje broj filmova i projekcija po bioskopu, pokrivenost
TMDb-om, koliko je filmova spojeno između bioskopa i koliko projekcija ima
nepoznat jezik — najbrži način da se vidi da li je neki parser pukao.

## Instalacija kao aplikacija

Sajt je PWA. Na Androidu (Chrome) dugme u podnožju pokreće pravu instalaciju.
Na iPhone-u Safari nema automatsku instalaciju, pa dugme prikazuje uputstvo:
**Podeli → „Dodaj na početni ekran“**. Instalirana verzija radi i offline sa
poslednje učitanim repertoarom.

## Deploy

`.github/workflows/build.yml` radi sve automatski. Potrebno je jednom podesiti:

1. **Settings → Pages → Source: GitHub Actions**
2. **Settings → Secrets and variables → Actions**
   - secret `TMDB_API_KEY`
   - (opciono) variable `CINEPLEXX_CLIENT_KEY`

Workflow svakog sata pokreće build, komituje `data/raw.json` (poslednji dobar
podatak, ujedno drži scheduled workflow živim) i deployuje `dist/`.

## Kada nešto pukne

Svaki bioskop je nezavisan adapter. Ako jedan sajt promeni HTML, build koristi
poslednje dobre podatke tog bioskopa i na stranici ispiše upozorenje da podaci
možda nisu ažurni; ostali bioskopi rade normalno. Build pada tek ako sva tri
izvora otkažu.

Provera Cineplexx API ugovora, ako njihov sajt prestane da vraća podatke:

```bash
curl -s https://app.cineplexx.rs/api/v1/cinemas \
  -H 'CINEPLEXX-Platform: WEB' \
  -H 'client-key: 308330b1-52a5-4883-aee3-304240c22ea1' | head -c 400
```

Novi Sad je `cinemaId` **1116**. Ako se `client-key` promeni, naći ga u JS
bundle-u sajta i postaviti kao `CINEPLEXX_CLIENT_KEY`.

## Struktura

```
src/adapters/   po jedan skrejper za svaki bioskop
src/core/       tipovi, datumi, HTTP, normalizacija naslova, spajanje, uzrast
src/tmdb/       TMDb klijent (pretraga, alternativni naslovi, sertifikacije)
src/render/     HTML, CSS, klijentski JS, PWA ikonice i manifest
fixtures/       sačuvani HTML/JSON za testove (bez mreže)
data/           raw.json (poslednji dobar podatak) i title-overrides.json
```
