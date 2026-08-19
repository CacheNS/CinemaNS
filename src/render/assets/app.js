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

  if (!form || !container || !counts) return;

  var dubbedInput = document.getElementById('filter-dubbed');
  var kidsInput = document.getElementById('filter-kids');
  var empty = document.getElementById('empty');
  var cityNav = document.getElementById('cities');

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

  var params = new URLSearchParams(window.location.search);
  dubbedInput.checked = params.get('dubbed') === '1';
  kidsInput.checked = params.get('kids') === '1';

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
    try {
      var stored = window.localStorage.getItem('kokice.city');
      for (var i = 0; i < cityTabs.length; i++) {
        if (cityTabs[i].getAttribute('data-city') === stored) return stored;
      }
      return null;
    } catch (err) {
      return null;
    }
  }

  function storeCity(cityId) {
    try {
      window.localStorage.setItem('kokice.city', cityId);
    } catch (err) {
      /* private mode; the URL still carries the choice */
    }
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
    var dubbedOnly = dubbedInput.checked;
    var kidsOnly = kidsInput.checked;
    var visibleMovies = 0;
    var visibleShowtimes = 0;
    var unknownAudio = 0;

    applyCityChrome();

    var movies = container.querySelectorAll('.movie');
    for (var i = 0; i < movies.length; i++) {
      var movie = movies[i];

      if (kidsOnly && movie.getAttribute('data-kid-friendly') !== '1') {
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
          var unknown = showtime.getAttribute('data-audio') === 'unknown';
          if (unknown) unknownAudio++;
          var hide = dubbedOnly && showtime.getAttribute('data-audio') !== 'dubbed';
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

    var text = visibleMovies + ' ' + plural(visibleMovies, 'film', 'filma', 'filmova') +
      ' · ' + visibleShowtimes + ' ' + plural(visibleShowtimes, 'projekcija', 'projekcije', 'projekcija');

    if (dubbedOnly && unknownAudio > 0) {
      text += ' · ' + unknownAudio + ' ' +
        plural(unknownAudio, 'projekcija nema', 'projekcije nemaju', 'projekcija nema') +
        ' naznačen jezik i nisu prikazane';
    }
    counts.textContent = text;
    if (empty) empty.hidden = visibleMovies > 0;

    syncUrl(dubbedOnly, kidsOnly);
  }

  function plural(n, one, few, many) {
    var mod10 = n % 10;
    var mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
  }

  function syncUrl(dubbedOnly, kidsOnly) {
    var next = new URLSearchParams();
    if (city !== defaultCity) next.set('grad', citySlug);
    if (dubbedOnly) next.set('dubbed', '1');
    if (kidsOnly) next.set('kids', '1');
    var query = next.toString();
    var url = window.location.pathname + (query ? '?' + query : '');
    window.history.replaceState(null, '', url);

    // Keep city and filter state when switching days.
    var tabs = document.querySelectorAll('.daytab');
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
  apply();

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
      navigator.serviceWorker.register('sw.js').catch(function () {
        /* offline support is optional */
      });
    });
  }
})();
