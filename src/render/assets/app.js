// Progressive enhancement: without JS everything is simply shown unfiltered.
(function () {
  'use strict';

  var form = document.getElementById('filters');
  var counts = document.getElementById('counts');
  var container = document.getElementById('movies');

  // Install UX and offline support are independent of the filters, so they are
  // wired up before the filter elements are required.
  setupInstall();
  registerServiceWorker();
  setupPosterFallback();
  setupLanguage();

  if (!form || !container || !counts) return;

  var audioInputs = form.querySelectorAll('input[name="audio"]');
  var kidsInput = document.getElementById('filter-kids');
  var searchInput = document.getElementById('movie-search');
  var empty = document.getElementById('empty');
  var emptyPast = document.getElementById('empty-past');
  var cityNav = document.getElementById('cities');
  var pageDate = container.getAttribute('data-date');

  /**
   * "Now" in Europe/Belgrade, never the visitor's own zone: someone opening the
   * page from London at 21:00 must still see Belgrade's evening. sv-SE gives an
   * ISO-shaped "2026-08-19 23:17".
   */
  function belgradeNow() {
    try {
      var text = new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Europe/Belgrade',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date());
      var date = text.slice(0, 10);
      var time = text.slice(11, 16);
      // Some engines render midnight as 24:00 rather than 00:00.
      if (time.indexOf('24:') === 0) time = '00:' + time.slice(3);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
      return { date: date, time: time };
    } catch (err) {
      // No Intl time zone support: show everything rather than risk hiding a
      // screening that has not started.
      return null;
    }
  }

  /** "21:45" → minutes since midnight, or -1 when unparseable. */
  function toMinutes(text) {
    if (!text || !/^\d{2}:\d{2}$/.test(text)) return -1;
    return Number(text.slice(0, 2)) * 60 + Number(text.slice(3, 5));
  }

  // Folds a typed query the same way the server folds each movie's
  // data-search haystack (see transliterate() in core/titles.ts): lowercase,
  // the five Serbian Latin diacritics mapped explicitly since đ has no
  // precomposed NFD decomposition, then NFD-strip any other accents so a
  // plain-typed query still matches an accented original title.
  var LATIN_DIACRITICS = { č: 'c', ć: 'c', ž: 'z', š: 's', đ: 'dj' };
  function foldSearchText(text) {
    var lower = String(text || '').toLowerCase();
    var out = '';
    for (var i = 0; i < lower.length; i++) {
      var ch = lower.charAt(i);
      out += LATIN_DIACRITICS[ch] || ch;
    }
    try {
      out = out.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    } catch (err) {
      /* normalize() unsupported: fall back to the un-stripped fold */
    }
    return out.trim();
  }

  /**
   * Cutoff in minutes since midnight, or null when nothing should be hidden.
   * A screening survives its own start time by GRACE_MINUTES: you can still
   * walk into a film that began twenty minutes ago, and the cinemas keep
   * selling those tickets.
   */
  var GRACE_MINUTES = 60;
  function pastCutoff() {
    if (!pageDate) return null;
    var now = belgradeNow();
    // Only the current day prunes. A past day is left intact so a stale or
    // shared link still reads as a record of that day rather than an empty page.
    if (!now || now.date !== pageDate) return null;
    // Goes negative in the first hour after midnight, which correctly hides nothing.
    return toMinutes(now.time) - GRACE_MINUTES;
  }

  // Kept in the rendered HTML so this file carries no display copy of its own.
  var startedLabel = container.getAttribute('data-started-label') || '';

  /**
   * Flags a screening that has begun but is still inside the grace window, and
   * takes its href away: the chip stays readable, but those seats are no longer
   * on sale, so a link would lead to a booking page that cannot serve it.
   */
  function markStarted(showtime, started) {
    if (started === showtime.hasAttribute('data-started')) return;
    if (started) {
      showtime.setAttribute('data-started', '1');
      showtime.setAttribute('data-href', showtime.getAttribute('href') || '');
      showtime.removeAttribute('href');
      showtime.setAttribute('aria-disabled', 'true');
      if (startedLabel) showtime.title += ' · ' + startedLabel;
    } else {
      showtime.removeAttribute('data-started');
      var href = showtime.getAttribute('data-href');
      if (href) showtime.setAttribute('href', href);
      showtime.removeAttribute('data-href');
      showtime.removeAttribute('aria-disabled');
      if (startedLabel) showtime.title = showtime.title.replace(' · ' + startedLabel, '');
    }
  }

  // The city tabs are the registry: each carries its id and its slug, so the
  // client never needs a hardcoded copy of the city list.
  var cityTabs = cityNav ? cityNav.querySelectorAll('.citytab') : [];
  var slugToCity = {};
  var defaultCity = null;
  for (var c = 0; c < cityTabs.length; c++) {
    var id = cityTabs[c].getAttribute('data-city');
    var slug = (cityTabs[c].getAttribute('href') || '').split('grad=')[1] || id;
    slugToCity[slug] = id;
    if (cityTabs[c].getAttribute('aria-current') === 'page') defaultCity = id;
  }

  /** '' (any language), 'dubbed' or 'subtitled' - whichever radio is checked. */
  function selectedAudio() {
    for (var a = 0; a < audioInputs.length; a++) {
      if (audioInputs[a].checked) return audioInputs[a].value;
    }
    return '';
  }

  /** Anything but the two known modes falls back to the unfiltered "Sve" option. */
  function selectAudio(value) {
    var wanted = value === 'dubbed' || value === 'subtitled' ? value : '';
    for (var a = 0; a < audioInputs.length; a++) {
      audioInputs[a].checked = audioInputs[a].value === wanted;
    }
  }

  var params = new URLSearchParams(window.location.search);
  selectAudio(params.get('audio'));
  kidsInput.checked = params.get('kids') === '1';
  // Restored verbatim (not folded) so the box shows exactly what was typed;
  // apply() folds it again on every run for matching.
  if (searchInput && params.get('q')) searchInput.value = params.get('q');

  // An explicit ?grad= wins over the stored preference, so a shared link always
  // shows the sender what they saw; otherwise fall back to last choice.
  var city = slugToCity[params.get('grad')] || readStoredCity() || defaultCity;
  var citySlug = slugFor(city);

  function slugFor(cityId) {
    for (var slug in slugToCity) {
      if (slugToCity[slug] === cityId) return slug;
    }
    return cityId;
  }

  function readStoredCity() {
    var stored = read('kokice.city');
    for (var i = 0; i < cityTabs.length; i++) {
      if (cityTabs[i].getAttribute('data-city') === stored) return stored;
    }
    return null;
  }

  function storeCity(cityId) {
    store('kokice.city', cityId);
  }

  function applyCityChrome() {
    for (var i = 0; i < cityTabs.length; i++) {
      var active = cityTabs[i].getAttribute('data-city') === city;
      cityTabs[i].className = 'citytab' + (active ? ' citytab--active' : '');
      if (active) cityTabs[i].setAttribute('aria-current', 'page');
      else cityTabs[i].removeAttribute('aria-current');
    }
    // Subtitles and stale-data notices are per city and live outside #movies.
    var scoped = document.querySelectorAll('.subtitle[data-city], .notice[data-city]');
    for (var j = 0; j < scoped.length; j++) {
      scoped[j].hidden = scoped[j].getAttribute('data-city') !== city;
    }
  }

  function apply() {
    var audioMode = selectedAudio();
    var kidsOnly = kidsInput.checked;
    var searchTerm = searchInput ? foldSearchText(searchInput.value) : '';
    var visibleMovies = 0;
    var visibleShowtimes = 0;
    var unknownAudio = 0;
    var cutoff = pastCutoff();
    var hidPast = false;

    applyCityChrome();

    var movies = container.querySelectorAll('.movie');
    for (var i = 0; i < movies.length; i++) {
      var movie = movies[i];

      if (kidsOnly && movie.getAttribute('data-kid-friendly') !== '1') {
        movie.hidden = true;
        continue;
      }

      // Instant substring match against the pre-folded title+original-title
      // haystack, so it filters titles regardless of case or diacritics.
      if (searchTerm && (movie.getAttribute('data-search') || '').indexOf(searchTerm) === -1) {
        movie.hidden = true;
        continue;
      }

      var shownInMovie = 0;
      var cinemas = movie.querySelectorAll('.cinema');
      for (var j = 0; j < cinemas.length; j++) {
        var cinema = cinemas[j];
        // City is a property of the cinema block, so it joins the same loop and
        // the empty-card handling below falls out for free.
        if (cinema.getAttribute('data-city') !== city) {
          cinema.hidden = true;
          continue;
        }
        var shownInCinema = 0;
        var showtimes = cinema.querySelectorAll('.showtime');
        for (var k = 0; k < showtimes.length; k++) {
          var showtime = showtimes[k];
          // The chains disagree about how much of the past they publish -
          // Cineplexx prunes, CineStar keeps hours of started screenings - so
          // the cutoff is applied here rather than trusted from the source.
          var start = toMinutes(showtime.getAttribute('data-time'));
          var past = cutoff !== null && start >= 0 && start < cutoff;
          if (past) hidPast = true;
          markStarted(
            showtime,
            cutoff !== null && !past && start >= 0 && start < cutoff + GRACE_MINUTES,
          );
          var audio = showtime.getAttribute('data-audio');
          var unknown = !past && audio === 'unknown';
          if (unknown) unknownAudio++;
          // "Bez sinhronizacije" hides only a confirmed dubbed chip, so domaći
          // films and chips with no stated language stay visible.
          var wrongAudio =
            audioMode === 'dubbed'
              ? audio !== 'dubbed'
              : audioMode === 'subtitled' && audio === 'dubbed';
          var hide = past || wrongAudio;
          showtime.hidden = hide;
          if (!hide) shownInCinema++;
        }
        cinema.hidden = shownInCinema === 0;
        shownInMovie += shownInCinema;
      }

      movie.hidden = shownInMovie === 0;
      if (!movie.hidden) {
        visibleMovies++;
        visibleShowtimes += shownInMovie;
      }
    }

    var text =
      countText(counts.getAttribute('data-plural-movies'), visibleMovies) +
      ' · ' +
      countText(counts.getAttribute('data-plural-showtimes'), visibleShowtimes);

    // Only the dubbed mode hides unknown-language chips - the other two show them,
    // so the notice would be describing screenings that are right there on screen.
    if (audioMode === 'dubbed' && unknownAudio > 0) {
      text += ' · ' + countText(counts.getAttribute('data-plural-unknown'), unknownAudio);
    }
    counts.textContent = text;

    // "Nothing found" and "the day is over" are different facts. The second is
    // only claimed when the time filter is genuinely the reason, so it is not
    // shown when the user's own filters emptied the page.
    var dayIsOver = visibleMovies === 0 && hidPast && !audioMode && !kidsOnly && !searchTerm;
    if (empty) empty.hidden = visibleMovies > 0 || dayIsOver;
    if (emptyPast) emptyPast.hidden = !dayIsOver;

    syncUrl(audioMode, kidsOnly, searchInput ? searchInput.value : '');
  }

  // The page ships its own plural templates ("{n} film|{n} filma|{n} filmova"),
  // so this file holds no display copy and needs no per-language build.
  var pluralRule = counts.getAttribute('data-plural-rule') === 'en' ? 'en' : 'sr';

  function countText(template, n) {
    var forms = String(template || '{n}').split('|');
    var index = pluralRule === 'en' ? enForm(n) : srForm(n);
    var form = forms[Math.min(index, forms.length - 1)];
    return form.replace('{n}', n);
  }

  function enForm(n) {
    return n === 1 ? 0 : 1;
  }

  function srForm(n) {
    var mod10 = n % 10;
    var mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return 0;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 1;
    return 2;
  }

  function syncUrl(audioMode, kidsOnly, rawSearch) {
    var next = new URLSearchParams();
    if (city !== defaultCity) next.set('grad', citySlug);
    if (audioMode) next.set('audio', audioMode);
    if (kidsOnly) next.set('kids', '1');
    // Carried in the URL, not just component state, so it survives the real
    // page navigation a day-tab click causes (R-7.9) - unlike the city
    // switch, which never navigates and so needs no such round-trip.
    var trimmedSearch = (rawSearch || '').trim();
    if (trimmedSearch) next.set('q', trimmedSearch);
    var query = next.toString();
    var url = window.location.pathname + (query ? '?' + query : '');
    window.history.replaceState(null, '', url);

    // Keep city and filter state when switching days. The end-of-day message
    // links to tomorrow too, so it is kept in step - and so does the language
    // switcher, which is a real navigation into the other tree and would
    // otherwise silently reset the reader's city, filters and search term.
    var tabs = document.querySelectorAll('.daytab, [data-daylink], [data-langlink]');
    for (var i = 0; i < tabs.length; i++) {
      var href = tabs[i].getAttribute('href').split('?')[0];
      tabs[i].setAttribute('href', query ? href + '?' + query : href);
    }
  }

  // The tabs are real links so they survive a reload and can be shared; JS
  // intercepts them to switch in place instead of re-fetching the same page.
  for (var t = 0; t < cityTabs.length; t++) {
    cityTabs[t].addEventListener('click', function (event) {
      event.preventDefault();
      city = this.getAttribute('data-city');
      citySlug = slugFor(city);
      storeCity(city);
      apply();
    });
  }

  form.addEventListener('change', apply);
  if (searchInput) searchInput.addEventListener('input', apply);
  apply();

  // A page left open should not keep advertising a screening that has aged out,
  // and it must survive midnight. Re-filter when the cutoff actually moves,
  // rather than on a blind interval.
  var lastCutoff = pastCutoff();
  window.setInterval(function () {
    var next = pastCutoff();
    if (next !== lastCutoff) {
      lastCutoff = next;
      apply();
    }
  }, 60000);

  // Installability: Chrome/Android fires beforeinstallprompt and we can install
  // in one tap. Everywhere else - notably iOS Safari, which has no such event -
  // the button reveals the manual steps instead of hiding itself.
  function setupInstall() {
    var wrapper = document.getElementById('install');
    var button = document.getElementById('install-button');
    var hint = document.getElementById('install-hint');
    if (!wrapper || !button || !hint) return;

    var standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;
    if (standalone) {
      wrapper.hidden = true;
      return;
    }

    var deferred = null;

    window.addEventListener('beforeinstallprompt', function (event) {
      event.preventDefault();
      deferred = event;
      hint.hidden = true;
    });

    button.addEventListener('click', function () {
      if (deferred) {
        deferred.prompt();
        deferred.userChoice.then(function () {
          deferred = null;
          wrapper.hidden = true;
        });
        return;
      }
      hint.hidden = !hint.hidden;
      button.setAttribute('aria-expanded', hint.hidden ? 'false' : 'true');
    });

    window.addEventListener('appinstalled', function () {
      wrapper.hidden = true;
    });
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', function () {
      // GitHub Pages serves sw.js itself with a multi-hour Cache-Control, so a
      // browser can keep re-fetching the *old* worker straight from its own
      // HTTP cache and never notice a new one exists - the VERSION-derived
      // Cache Storage key (R-9.7a) never even gets a chance to change. A
      // per-build version tag on the registration URL is a request the
      // browser has never cached, so it always reaches the network (R-9.7b).
      var meta = document.querySelector('meta[name="sw-version"]');
      var version = meta ? meta.getAttribute('content') : '';
      // Pages in the /en/ tree sit one directory down while sw.js stays at the
      // site root, so the path is rendered into the page rather than assumed -
      // registering a bare 'sw.js' from /en/ asks for /en/sw.js and 404s.
      var pathMeta = document.querySelector('meta[name="sw-path"]');
      var path = (pathMeta && pathMeta.getAttribute('content')) || 'sw.js';
      var url = version ? path + '?v=' + encodeURIComponent(version) : path;
      navigator.serviceWorker.register(url).catch(function () {
        /* offline support is optional */
      });
    });
  }

  // A dead poster link (source sites go stale) otherwise shows the browser's
  // broken-image icon and alt text, which the hover zoom then blows up to a
  // large size. Swap it for the same empty placeholder a missing poster gets.
  // 'error' does not bubble, so listen on the document in the capture phase.
  function setupPosterFallback() {
    document.addEventListener(
      'error',
      function (event) {
        var img = event.target;
        if (!img || img.tagName !== 'IMG' || !img.classList.contains('poster')) return;
        var placeholder = document.createElement('div');
        placeholder.className = 'poster poster--empty';
        placeholder.setAttribute('aria-hidden', 'true');
        img.replaceWith(placeholder);
      },
      true,
    );
  }

  /**
   * Serbian and English are separate documents, so the switcher is a real link
   * and is never intercepted - the click navigates, this only records the
   * choice so the next visit to the root lands in the same language.
   *
   * The visitor's own `navigator.language` is deliberately not consulted
   * (R-19.6): a stored preference is something they asked for, a guessed one
   * is something that happens to them. Only an explicit choice ever redirects,
   * only once, and only away from the default tree - so a crawler, which has
   * no localStorage, always sees Serbian at `/` and English at `/en/`.
   */
  function setupLanguage() {
    var nav = document.getElementById('langs');
    if (!nav) return;
    var current = document.documentElement.lang.indexOf('sr') === 0 ? 'sr' : 'en';
    var links = nav.querySelectorAll('[data-langlink]');

    for (var i = 0; i < links.length; i++) {
      links[i].addEventListener('click', function () {
        store('kokice.lang', this.getAttribute('data-lang'));
      });
    }

    if (current !== 'sr' || read('kokice.lang') !== 'en') return;
    // Redirecting mid-session would fight a reader who just switched back, so
    // the hop is allowed once per tab and the query string is carried across.
    try {
      if (window.sessionStorage.getItem('kokice.lang.hopped')) return;
      window.sessionStorage.setItem('kokice.lang.hopped', '1');
    } catch (err) {
      return;
    }
    var target = nav.querySelector('[data-lang="en"]');
    if (target) window.location.replace(target.getAttribute('href') + window.location.search);
  }

  function read(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (err) {
      return null;
    }
  }

  function store(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (err) {
      /* private mode; the URL still carries the choice */
    }
  }
})();
