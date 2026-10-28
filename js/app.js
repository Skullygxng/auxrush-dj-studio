//
//  app.js — AuxRush DJ Studio interface
//
//  Builds the two deck panels, wires every control to the audio engine, and
//  runs the display loop (playheads, waveforms, meters, Auto DJ).
//

(function () {
  'use strict';

  var engine = new window.AuxRush.Engine();
  var tracks = [];
  var nextId = 1;
  var views = {};
  var autoDJ = false;
  var autoDJBusy = false;
  var autoHistory = [];
  var autoMix = null;
  var lastAutoNext = 0;
  var recordings = [];
  var meterSegments = [];
  var fadeRAF = null;
  var lastDraw = 0;

  var VIEW_SECONDS = 8;

  // ------------------------------------------------------------- utilities

  function fmtTime(t) {
    if (!isFinite(t) || t < 0) t = 0;
    var s = Math.round(t);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function toast(message) {
    var el = document.getElementById('toast');
    el.textContent = message;
    el.classList.remove('hidden');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () {
      el.classList.add('hidden');
    }, 2400);
  }

  function deckAccent(id) {
    return id === 'a' ? '#22d3ee' : '#f472b6';
  }

  // --------------------------------------------------------- deck template

  function deckTemplate(id) {
    var label = id.toUpperCase();
    return '' +
      '<div class="deck" data-deck="' + id + '">' +
        '<div class="deck-head">' +
          '<span class="deck-badge">' + label + '</span>' +
          '<div class="deck-meta">' +
            '<div class="track-title">No track loaded</div>' +
            '<div class="track-artist">Open the library to load a track</div>' +
          '</div>' +
          '<div class="deck-readout">' +
            '<div class="bpm-value">--</div>' +
            '<div class="key-value">--</div>' +
            '<div class="time-value">0:00 / -0:00</div>' +
          '</div>' +
        '</div>' +

        '<div class="deck-stage">' +
          '<div class="platter">' +
            '<div class="platter-ring"></div>' +
            '<div class="platter-hub">' +
              '<span class="hub-bpm">--</span>' +
              '<span class="platter-bpm">BPM</span>' +
            '</div>' +
          '</div>' +
          '<div class="wave-wrap">' +
            '<canvas class="wave" width="600" height="90"></canvas>' +
          '</div>' +
        '</div>' +

        '<div class="deck-controls">' +
          '<div class="transport">' +
            '<button class="btn play" aria-label="Play or pause">▶</button>' +
            '<button class="btn cue">CUE</button>' +
            '<button class="btn sync">SYNC</button>' +
          '</div>' +
          '<div class="loops">' +
            '<button class="chip active" data-loop="0">OFF</button>' +
            '<button class="chip" data-loop="1">1</button>' +
            '<button class="chip" data-loop="2">2</button>' +
            '<button class="chip" data-loop="4">4</button>' +
            '<button class="chip" data-loop="8">8</button>' +
          '</div>' +
        '</div>' +

        '<div class="hotcues">' +
          '<button class="cue-slot" data-cue="0">1</button>' +
          '<button class="cue-slot" data-cue="1">2</button>' +
          '<button class="cue-slot" data-cue="2">3</button>' +
          '<button class="cue-slot" data-cue="3">4</button>' +
        '</div>' +

        '<div class="deck-mix">' +
          '<label class="knob"><span>FILTER</span>' +
            '<input type="range" class="f-filter" min="-1" max="1" step="0.01" value="0"></label>' +
          '<label class="knob"><span>LOW</span>' +
            '<input type="range" class="f-low" min="-12" max="12" step="0.5" value="0"></label>' +
          '<label class="knob"><span>MID</span>' +
            '<input type="range" class="f-mid" min="-12" max="12" step="0.5" value="0"></label>' +
          '<label class="knob"><span>HIGH</span>' +
            '<input type="range" class="f-high" min="-12" max="12" step="0.5" value="0"></label>' +
          '<label class="fader"><span>VOL</span>' +
            '<input type="range" class="f-vol" min="0" max="1" step="0.01" value="1"></label>' +
          '<div class="deck-meter"><div class="deck-meter-fill"></div></div>' +
          '<label class="fader"><span>PITCH</span>' +
            '<input type="range" class="f-pitch" min="-16" max="16" step="0.1" value="0"></label>' +
        '</div>' +
      '</div>';
  }

  function buildDeck(id) {
    var slot = document.querySelector('.deck-slot[data-deck="' + id + '"]');
    slot.innerHTML = deckTemplate(id);

    var panel = slot.firstElementChild;
    var view = {
      id: id,
      panel: panel,
      titleEl: panel.querySelector('.track-title'),
      artistEl: panel.querySelector('.track-artist'),
      bpmEl: panel.querySelector('.bpm-value'),
      keyEl: panel.querySelector('.key-value'),
      timeEl: panel.querySelector('.time-value'),
      hubBpm: panel.querySelector('.hub-bpm'),
      ring: panel.querySelector('.platter-ring'),
      canvas: panel.querySelector('.wave'),
      playBtn: panel.querySelector('.btn.play'),
      cueBtn: panel.querySelector('.btn.cue'),
      syncBtn: panel.querySelector('.btn.sync'),
      loopChips: Array.prototype.slice.call(panel.querySelectorAll('.chip')),
      cueSlots: Array.prototype.slice.call(panel.querySelectorAll('.cue-slot')),
      filter: panel.querySelector('.f-filter'),
      low: panel.querySelector('.f-low'),
      mid: panel.querySelector('.f-mid'),
      high: panel.querySelector('.f-high'),
      vol: panel.querySelector('.f-vol'),
      pitch: panel.querySelector('.f-pitch'),
      meterFill: panel.querySelector('.deck-meter-fill'),
      track: null,
      needsLoad: false,
      dragging: false,
      dragBase: 0,
      dragPos: 0
    };

    wireDeck(view);
    return view;
  }

  function applySettings(view, deck) {
    deck.setVolume(Number(view.vol.value));
    deck.setEQ(Number(view.low.value), Number(view.mid.value), Number(view.high.value));
    deck.setFilter(Number(view.filter.value));
    deck.setRate(1 + Number(view.pitch.value) / 100);
  }

  /** The engine's deck for a view, loading the pending track on first use. */
  function deckFor(view) {
    var deck = engine.deck(view.id);
    if (view.needsLoad && view.track) {
      deck.loadTrack(view.track);
      view.needsLoad = false;
    }
    applySettings(view, deck);
    return deck;
  }

  // ------------------------------------------------------------ deck wiring

  function wireDeck(view) {
    var id = view.id;

    view.playBtn.addEventListener('click', function () {
      if (!view.track) {
        openSheet();
        return;
      }
      var deck = deckFor(view);
      // Creating the engine also brings the other deck's track in, so both
      // panels keep their real BPM and key from the first tap.
      syncDecksWithViews();
      deck.toggle();
      // Browsers can start the context suspended; nudge it on the tap and say
      // so if the platform keeps it blocked.
      if (engine.ctx && engine.ctx.state !== 'running') {
        engine.ctx.resume().then(function () {
          if (engine.ctx.state !== 'running') {
            toast('Audio is blocked — tap play again');
          }
        }).catch(function () {
          toast('Audio is blocked — tap play again');
        });
      }
    });

    view.cueBtn.addEventListener('click', function () {
      if (!view.track) return;
      var deck = deckFor(view);
      var cue = view.track.cues[0];
      deck.seek(cue != null ? cue : 0);
    });

    view.syncBtn.addEventListener('click', function () {
      var deck = deckFor(view);
      var other = engine.decks[view.id === 'a' ? 'b' : 'a'];
      deck.syncTo(other);
      view.pitch.value = String(((deck.rate - 1) * 100).toFixed(1));
      view.syncBtn.classList.add('on');
      setTimeout(function () { view.syncBtn.classList.remove('on'); }, 900);
    });

    view.loopChips.forEach(function (chip, index) {
      chip.addEventListener('click', function () {
        if (!view.track) return;
        var beats = Number(chip.getAttribute('data-loop'));
        var deck = deckFor(view);
        deck.setLoop(beats);
        view.loopChips.forEach(function (c, j) {
          c.classList.toggle('active', j === index);
        });
      });
    });

    view.cueSlots.forEach(function (slot, index) {
      var holdTimer = null;

      slot.addEventListener('pointerdown', function () {
        holdTimer = setTimeout(function () {
          holdTimer = null;
          if (view.track) {
            view.track.cues[index] = null;
            updateCueButtons(view);
            toast('Cue ' + (index + 1) + ' cleared');
          }
        }, 600);
      });

      slot.addEventListener('pointerup', function () {
        if (holdTimer) {
          clearTimeout(holdTimer);
          holdTimer = null;
          jumpOrSetCue(view, index);
        }
      });

      slot.addEventListener('pointercancel', function () {
        if (holdTimer) {
          clearTimeout(holdTimer);
          holdTimer = null;
        }
      });
    });

    [view.filter, view.low, view.mid, view.high, view.vol, view.pitch].forEach(function (input) {
      input.addEventListener('input', function () {
        if (engine.decks) applySettings(view, engine.decks[view.id]);
      });
    });

    var canvas = view.canvas;

    canvas.addEventListener('pointerdown', function (event) {
      if (!view.track) return;
      view.dragging = true;
      var deck = engine.decks ? engine.decks[view.id] : null;
      view.dragBase = deck ? deck.position() : 0;
      view.dragPos = timeFromEvent(view, event, view.dragBase);
      try { canvas.setPointerCapture(event.pointerId); } catch (err) { /* older browsers */ }
    });

    canvas.addEventListener('pointermove', function (event) {
      if (!view.dragging) return;
      view.dragPos = timeFromEvent(view, event, view.dragBase);
    });

    canvas.addEventListener('pointerup', function (event) {
      if (!view.dragging) return;
      view.dragging = false;
      var deck = engine.decks ? engine.decks[view.id] : null;
      if (deck) deck.seek(view.dragPos);
      try { canvas.releasePointerCapture(event.pointerId); } catch (err) { /* ignore */ }
    });

    canvas.addEventListener('pointercancel', function () {
      view.dragging = false;
    });

    view.panel.addEventListener('dblclick', function () {
      if (!view.track) openSheet();
    });
  }

  function timeFromEvent(view, event, base) {
    var rect = view.canvas.getBoundingClientRect();
    var x = event.clientX - rect.left;
    var pxPerSec = rect.width / VIEW_SECONDS;
    var t = base + (x - rect.width / 2) / pxPerSec;
    var duration = view.track ? view.track.duration : 0;
    return window.AuxRush.clamp(t, 0, Math.max(0, duration - 0.05));
  }

  function jumpOrSetCue(view, index) {
    if (!view.track) return;
    var deck = deckFor(view);
    var cues = view.track.cues;
    if (cues[index] != null) {
      deck.seek(view.track.cues[index]);
    } else {
      view.track.cues[index] = deck.position();
      updateCueButtons(view);
      toast('Cue ' + (index + 1) + ' set');
    }
  }

  function updateCueButtons(view) {
    var cues = view.track ? view.track.cues : null;
    view.cueSlots.forEach(function (slot, index) {
      slot.classList.toggle('set', !!(cues && cues[index] != null));
    });
  }

  // -------------------------------------------------------------- loading

  function loadTrack(view, track) {
    view.track = track;
    view.needsLoad = true;
    if (!track.cues) track.cues = [null, null, null, null];

    view.titleEl.textContent = track.title;
    view.artistEl.textContent = track.artist + ' · ' + fmtTime(track.duration);
    view.bpmEl.textContent = track.bpm ? track.bpm.toFixed(1) : '--';
    view.keyEl.textContent = track.key && track.key.camelot ? track.key.camelot : '--';
    view.hubBpm.textContent = track.bpm ? String(Math.round(track.bpm)) : '--';
    view.timeEl.textContent = '0:00 / -' + fmtTime(track.duration);
    view.panel.classList.remove('playing');
    view.loopChips.forEach(function (chip, index) {
      chip.classList.toggle('active', index === 0);
    });
    view.pitch.value = '0';

    if (engine.decks) {
      deckFor(view);
      engine.decks[view.id].seek(0);
    }

    updateCueButtons(view);
    closeSheet();
    toast(track.title + ' → deck ' + view.id.toUpperCase());
  }

  function autoLoadStarters() {
    if (!tracks.length) return;
    if (!views.a.track) loadTrackSilently(views.a, tracks[0]);
    if (!views.b.track && tracks.length > 1) loadTrackSilently(views.b, tracks[1]);
  }

  function loadTrackSilently(view, track) {
    view.track = track;
    view.needsLoad = true;
    if (!track.cues) track.cues = [null, null, null, null];
    view.titleEl.textContent = track.title;
    view.artistEl.textContent = track.artist + ' · ' + fmtTime(track.duration);
    view.bpmEl.textContent = track.bpm ? track.bpm.toFixed(1) : '--';
    view.keyEl.textContent = track.key && track.key.camelot ? track.key.camelot : '--';
    view.hubBpm.textContent = track.bpm ? String(Math.round(track.bpm)) : '--';
    view.timeEl.textContent = '0:00 / -' + fmtTime(track.duration);
    updateCueButtons(view);
  }

  // -------------------------------------------------------------- library
  //
  //  Two tabs: the mixable audio library and a YouTube-style video shelf.
  //  Video audio lives inside YouTube's player and can't be routed into the
  //  decks, so videos are for watching — the decks stay for mixing.

  var libTab = 'mix';
  var libQuery = '';
  var videos = [];
  var currentVideo = null;

  function coverStyle(track) {
    var hue = (track.id * 47) % 360;
    var hue2 = (hue + 55) % 360;
    return 'linear-gradient(135deg, hsl(' + hue + ', 68%, 46%), hsl(' + hue2 + ', 72%, 24%))';
  }

  function loadVideos() {
    try {
      var raw = window.localStorage ? window.localStorage.getItem('auxrush.videos') : null;
      videos = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(videos)) videos = [];
    } catch (err) {
      videos = [];
    }
  }

  function saveVideos() {
    try {
      window.localStorage.setItem('auxrush.videos', JSON.stringify(videos));
    } catch (err) {
      /* private mode */
    }
  }

  function youtubeId(text) {
    var value = String(text || '').trim();
    if (!value) return null;
    var bare = value.match(/^[A-Za-z0-9_-]{11}$/);
    if (bare) return bare[0];
    var m = value.match(/(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  }

  function addVideoFromInput() {
    var input = document.getElementById('videoUrl');
    if (!input) return;
    var id = youtubeId(input.value);
    if (!id) {
      toast('That doesn’t look like a YouTube link');
      return;
    }
    for (var i = 0; i < videos.length; i++) {
      if (videos[i].videoId === id) {
        toast('Already in your videos');
        input.value = '';
        return;
      }
    }
    var video = { videoId: id, title: 'YouTube video', artist: 'YouTube' };
    videos.unshift(video);
    saveVideos();
    input.value = '';
    switchTab('videos');
    renderLibrary();
    playVideo(video);
    fetchVideoTitle(video);
  }

  function fetchVideoTitle(video) {
    if (!window.fetch) return;
    window.fetch('https://noembed.com/embed?url=https://www.youtube.com/watch?v=' + encodeURIComponent(video.videoId))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && data.title) {
          video.title = data.title;
          if (data.author_name) video.artist = data.author_name;
          saveVideos();
          renderLibrary();
          if (currentVideo === video) {
            document.getElementById('videoTitle').textContent = video.title;
          }
        }
      })
      .catch(function () {
        /* offline: keep the placeholder title */
      });
  }

  function playVideo(video) {
    currentVideo = video;
    var pane = document.getElementById('videoPane');
    var frame = document.getElementById('videoFrame');
    if (!pane || !frame) return;
    frame.innerHTML = '<iframe src="https://www.youtube.com/embed/' + video.videoId +
      '?autoplay=1&rel=0&playsinline=1" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>';
    pane.classList.remove('hidden');
    document.getElementById('videoTitle').textContent = video.title;
  }

  function stopVideo() {
    var frame = document.getElementById('videoFrame');
    var pane = document.getElementById('videoPane');
    if (frame) frame.innerHTML = '';
    if (pane) pane.classList.add('hidden');
    currentVideo = null;
  }

  function switchTab(tab) {
    libTab = tab;
    var tabMix = document.getElementById('tabMix');
    var tabVideos = document.getElementById('tabVideos');
    var addRow = document.getElementById('addVideoRow');
    var search = document.getElementById('libSearch');

    if (tabMix) tabMix.classList.toggle('active', tab === 'mix');
    if (tabVideos) tabVideos.classList.toggle('active', tab === 'videos');
    if (addRow) addRow.classList.toggle('hidden', tab !== 'videos');
    if (search) search.placeholder = tab === 'videos' ? 'Search your videos' : 'Search title, artist, key';
    if (tab === 'mix') stopVideo();
    renderLibrary();
  }

  function emptyTile(text) {
    var el = document.createElement('div');
    el.className = 'lib-empty';
    el.textContent = text;
    return el;
  }

  function trackCard(track) {
    var card = document.createElement('div');
    card.className = 'vid-card';

    var art = document.createElement('div');
    art.className = 'vid-thumb art';
    art.style.backgroundImage = coverStyle(track);

    var duration = document.createElement('span');
    duration.className = 'vid-badge';
    duration.textContent = fmtTime(track.duration);
    art.appendChild(duration);

    if (track.key && track.key.camelot) {
      var key = document.createElement('span');
      key.className = 'vid-badge key';
      key.textContent = track.key.camelot;
      art.appendChild(key);
    }
    card.appendChild(art);

    var body = document.createElement('div');
    body.className = 'vid-body';

    var title = document.createElement('div');
    title.className = 'vid-title';
    title.textContent = track.title;

    var meta = document.createElement('div');
    meta.className = 'vid-meta';
    meta.textContent = track.artist + ' · ' + (track.bpm > 0 ? Math.round(track.bpm) + ' BPM' : '—');

    body.appendChild(title);
    body.appendChild(meta);

    var actions = document.createElement('div');
    actions.className = 'vid-actions';

    var aBtn = document.createElement('button');
    aBtn.className = 'btn tiny accent';
    aBtn.textContent = 'Deck A';
    aBtn.addEventListener('click', function () { loadTrack(views.a, track); });

    var bBtn = document.createElement('button');
    bBtn.className = 'btn tiny accent b';
    bBtn.textContent = 'Deck B';
    bBtn.addEventListener('click', function () { loadTrack(views.b, track); });

    actions.appendChild(aBtn);
    actions.appendChild(bBtn);

    if (track.imported) {
      var del = document.createElement('button');
      del.className = 'btn tiny ghost';
      del.textContent = '✕';
      del.setAttribute('aria-label', 'Remove track');
      del.addEventListener('click', function () {
        var index = tracks.indexOf(track);
        if (index >= 0) tracks.splice(index, 1);
        renderLibrary();
      });
      actions.appendChild(del);
    }

    body.appendChild(actions);
    card.appendChild(body);
    return card;
  }

  function videoCard(video) {
    var card = document.createElement('div');
    card.className = 'vid-card';

    var thumb = document.createElement('div');
    thumb.className = 'vid-thumb';
    thumb.style.backgroundImage = 'url(https://img.youtube.com/vi/' + video.videoId + '/hqdefault.jpg)';

    var badge = document.createElement('span');
    badge.className = 'vid-badge';
    badge.textContent = 'VIDEO';
    thumb.appendChild(badge);
    card.appendChild(thumb);

    var body = document.createElement('div');
    body.className = 'vid-body';

    var title = document.createElement('div');
    title.className = 'vid-title';
    title.textContent = video.title;

    var meta = document.createElement('div');
    meta.className = 'vid-meta';
    meta.textContent = video.artist + ' · video (not mixable)';

    body.appendChild(title);
    body.appendChild(meta);

    var actions = document.createElement('div');
    actions.className = 'vid-actions';

    var play = document.createElement('button');
    play.className = 'btn tiny';
    play.textContent = 'Play';
    play.addEventListener('click', function () { playVideo(video); });

    var del = document.createElement('button');
    del.className = 'btn tiny ghost';
    del.textContent = 'Remove';
    del.addEventListener('click', function () {
      var index = videos.indexOf(video);
      if (index >= 0) videos.splice(index, 1);
      if (currentVideo === video) stopVideo();
      saveVideos();
      renderLibrary();
    });

    actions.appendChild(play);
    actions.appendChild(del);
    body.appendChild(actions);
    card.appendChild(body);
    return card;
  }

  function renderLibrary() {
    var list = document.getElementById('libraryList');
    if (!list) return;
    list.innerHTML = '';

    var query = libQuery.trim().toLowerCase();

    if (libTab === 'videos') {
      var shownVideos = videos.filter(function (video) {
        if (!query) return true;
        return (video.title + ' ' + video.artist).toLowerCase().indexOf(query) !== -1;
      });
      if (!shownVideos.length) {
        list.appendChild(emptyTile('No videos yet — paste a YouTube link above.'));
        return;
      }
      shownVideos.forEach(function (video) { list.appendChild(videoCard(video)); });
      return;
    }

    if (!tracks.length) {
      list.appendChild(emptyTile('Building the built-in tracks…'));
      return;
    }

    var shownTracks = tracks.filter(function (track) {
      if (!query) return true;
      var hay = (track.title + ' ' + track.artist + ' ' + (track.bpm || '') + ' ' +
        (track.key && track.key.camelot ? track.key.camelot : '')).toLowerCase();
      return hay.indexOf(query) !== -1;
    });

    if (!shownTracks.length) {
      list.appendChild(emptyTile('Nothing matches that search.'));
      return;
    }

    shownTracks.forEach(function (track) { list.appendChild(trackCard(track)); });
  }

  function setupLibrary() {
    loadVideos();
    var tabMix = document.getElementById('tabMix');
    var tabVideos = document.getElementById('tabVideos');
    var search = document.getElementById('libSearch');
    var addBtn = document.getElementById('addVideoBtn');
    var url = document.getElementById('videoUrl');

    if (tabMix) tabMix.addEventListener('click', function () { switchTab('mix'); });
    if (tabVideos) tabVideos.addEventListener('click', function () { switchTab('videos'); });
    if (search) {
      search.addEventListener('input', function () {
        libQuery = search.value || '';
        renderLibrary();
      });
    }
    if (addBtn) addBtn.addEventListener('click', addVideoFromInput);
    if (url) {
      url.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') addVideoFromInput();
      });
    }
  }

  function loadBuiltInTracks() {
    var hint = document.getElementById('libHint');
    var demos = window.AuxRush.DEMOS;
    var index = 0;

    function next() {
      if (index >= demos.length) {
        if (hint) hint.textContent = 'Built-in tracks · tap Deck A or Deck B';
        renderLibrary();
        autoLoadStarters();
        return;
      }

      var groove = demos[index];
      if (hint) hint.textContent = 'Building ' + groove.title + '…';

      window.AuxRush.renderDemo(groove, 24).then(function (buffer) {
        var analysis = window.AuxRush.analyzeBuffer(buffer);
        tracks.push({
          id: nextId++,
          title: groove.title,
          artist: groove.artist,
          bpm: groove.bpm,
          duration: buffer.duration,
          buffer: buffer,
          peaks: analysis.peaks,
          key: analysis.key,
          energy: analysis.energy,
          mixIn: analysis.mixIn,
          mixOut: analysis.mixOut,
          cues: [null, null, null, null],
          imported: false
        });
        index++;
        renderLibrary();
        // Idempotent: fills any deck that still has no track, whatever order
        // the grooves finish rendering in.
        autoLoadStarters();
        setTimeout(next, 0);
      }).catch(function (err) {
        if (window.console) console.error(err);
        index++;
        setTimeout(next, 0);
      });
    }

    next();
  }

  function importFiles(files) {
    var hint = document.getElementById('libHint');
    var ctx;
    try {
      ctx = engine.ensureContext();
    } catch (err) {
      toast('Web Audio is not available here');
      return;
    }

    var index = 0;

    function next() {
      if (index >= files.length) {
        if (hint) hint.textContent = 'Built-in tracks · tap Deck A or Deck B';
        renderLibrary();
        return;
      }

      var file = files[index];
      if (hint) hint.textContent = 'Decoding ' + file.name + '…';

      file.arrayBuffer().then(function (data) {
        return new Promise(function (resolve, reject) {
          ctx.decodeAudioData(data, resolve, reject);
        });
      }).then(function (buffer) {
        var analysis = window.AuxRush.analyzeBuffer(buffer);
        var base = file.name.replace(/\.[^.]+$/, '');
        var parts = base.split(' - ');
        var artist = parts.length > 1 ? parts[0] : 'Imported';
        var title = parts.length > 1 ? parts.slice(1).join(' - ') : base;

        tracks.push({
          id: nextId++,
          title: title,
          artist: artist,
          bpm: analysis.bpm,
          duration: buffer.duration,
          buffer: buffer,
          peaks: analysis.peaks,
          key: analysis.key,
          energy: analysis.energy,
          mixIn: analysis.mixIn,
          mixOut: analysis.mixOut,
          cues: [null, null, null, null],
          imported: true
        });

        index++;
        renderLibrary();
        toast('Added ' + title);
        setTimeout(next, 0);
      }).catch(function () {
        toast('Could not decode ' + file.name);
        index++;
        setTimeout(next, 0);
      });
    }

    next();
  }

  // ---------------------------------------------------------- sheet + hours

  function openSheet() {
    document.getElementById('sheet').classList.remove('hidden');
    renderRecordings();
  }

  function closeSheet() {
    document.getElementById('sheet').classList.add('hidden');
    // Leaving the library stops any video: its audio isn't part of the mix.
    stopVideo();
  }

  function renderRecordings() {
    var block = document.getElementById('recordingsBlock');
    var list = document.getElementById('recordingsList');
    list.innerHTML = '';

    if (!recordings.length) {
      block.classList.add('hidden');
      return;
    }

    block.classList.remove('hidden');
    recordings.forEach(function (rec) {
      var row = document.createElement('div');
      row.className = 'rec-row';

      var name = document.createElement('span');
      name.textContent = rec.name + ' · ' + (rec.size / 1048576).toFixed(1) + ' MB';

      var link = document.createElement('a');
      link.href = rec.url;
      link.download = rec.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.webm';
      link.textContent = 'Download';

      row.appendChild(name);
      row.appendChild(link);
      list.appendChild(row);
    });
  }

  // ------------------------------------------------------------ strip setup

  function setupMeter() {
    var meter = document.getElementById('masterMeter');
    meter.innerHTML = '';
    meterSegments = [];
    for (var i = 0; i < 16; i++) {
      var seg = document.createElement('span');
      if (i >= 14) seg.className = 'bad';
      else if (i >= 11) seg.className = 'warn';
      meter.appendChild(seg);
      meterSegments.push(seg);
    }
  }

  function setupStrip() {
    document.getElementById('crossfader').addEventListener('input', function (event) {
      if (autoMix) cancelAutoMix();
      engine.setCrossfader(Number(event.target.value));
    });

    document.getElementById('masterVolume').addEventListener('input', function (event) {
      engine.setMasterVolume(Number(event.target.value));
    });

    var autoBtn = document.getElementById('autoDJBtn');
    autoBtn.addEventListener('click', function () {
      autoDJ = !autoDJ;
      autoBtn.classList.toggle('on', autoDJ);
      if (autoDJ) {
        // Creating the context (and the decks) has to happen inside a tap.
        try {
          engine.ensureContext();
        } catch (err) {
          toast('Web Audio is unavailable here');
        }
      } else {
        cancelAutoMix();
      }
      updateAutoNext();
      toast(autoDJ ? 'Auto DJ on · the set runs itself' : 'Auto DJ off');
    });

    document.getElementById('recordBtn').addEventListener('click', toggleRecording);
    document.getElementById('libraryBtn').addEventListener('click', openSheet);
    document.getElementById('sheetClose').addEventListener('click', closeSheet);

    var input = document.getElementById('fileInput');
    input.addEventListener('change', function () {
      var files = Array.prototype.slice.call(input.files || []);
      input.value = '';
      if (files.length) importFiles(files);
    });
  }

  function updateStrip() {
    var level = engine.masterLevel();
    var lit = Math.round(level * meterSegments.length);
    for (var i = 0; i < meterSegments.length; i++) {
      meterSegments[i].classList.toggle('lit', i < lit);
    }

    var text = document.getElementById('masterLevelText');
    var db = engine.masterPeakDb();
    text.textContent = isFinite(db) && db > -60 ? Math.round(db) + ' dB' : '-∞';

    var now = performance.now();
    if (now - lastAutoNext > 700) {
      lastAutoNext = now;
      updateAutoNext();
    }
  }

  function toggleRecording() {
    var btn = document.getElementById('recordBtn');

    if (engine.recorder) {
      engine.stopRecording().then(function (blob) {
        btn.classList.remove('recording');
        if (!blob) {
          toast('Nothing was recorded');
          return;
        }
        recordings.unshift({
          url: URL.createObjectURL(blob),
          name: 'Mix ' + new Date().toLocaleString(),
          size: blob.size
        });
        renderRecordings();
        toast('Recording saved · download it in the library');
      });
      return;
    }

    var started = false;
    try {
      started = engine.startRecording();
    } catch (err) {
      started = false;
    }
    if (started) {
      btn.classList.add('recording');
      toast('Recording · tap the dot again to stop');
    } else {
      toast('Recording is not supported in this browser');
    }
  }

  // -------------------------------------------------------------- Auto DJ
  //
  //  Auto DJ runs a whole set by itself:
  //   · if nothing is playing it starts a track on the open deck,
  //   · near the end of the playing track it loads the next unused track on
  //     the idle deck, tempo-matches it, lines the beats up and crossfades,
  //   · it always moves forward through the library and wraps around.

  function fadeCrossfader(target, seconds) {
    if (fadeRAF) cancelAnimationFrame(fadeRAF);

    var input = document.getElementById('crossfader');
    var start = engine.crossfader;
    var t0 = performance.now();
    var duration = Math.max(300, seconds * 1000);

    function tick(now) {
      var p = Math.min(1, (now - t0) / duration);
      var value = start + (target - start) * p;
      engine.setCrossfader(value);
      if (input) input.value = String(value);
      if (p < 1) {
        fadeRAF = requestAnimationFrame(tick);
      } else {
        fadeRAF = null;
      }
    }

    fadeRAF = requestAnimationFrame(tick);
  }

  // --- Auto DJ helpers ---

  function pushHistory(trackId) {
    if (trackId == null) return;
    if (autoHistory[autoHistory.length - 1] === trackId) return;
    autoHistory.push(trackId);
    if (autoHistory.length > 32) autoHistory.shift();
  }

  // --- the AI: scores candidates on tempo, harmony, energy and freshness ---

  var autoEnergyTarget = 0.62;

  function trackById(id) {
    for (var i = 0; i < tracks.length; i++) {
      if (tracks[i].id === id) return tracks[i];
    }
    return null;
  }

  /** 1 when two Camelot codes mix cleanly, less when they clash. */
  function camelotScore(a, b) {
    if (!a || !b) return 0.4;
    var na = parseInt(a, 10);
    var nb = parseInt(b, 10);
    var la = a.charAt(a.length - 1);
    var lb = b.charAt(b.length - 1);
    if (na === nb) return 1;
    if (la === lb) {
      var d = Math.abs(na - nb);
      if (d === 1 || d === 11) return 0.9;
    }
    return 0.15;
  }

  /** How long the blend should be, based on how close the tempos are. */
  function transitionBeats(current, incoming) {
    if (!current || !incoming || !current.bpm || !incoming.bpm) return 16;
    var cur = current.bpm * (current.rate || 1);
    var gap = Math.abs(incoming.bpm - cur) / Math.max(cur, 1);
    if (gap < 0.015) return 32;
    if (gap < 0.05) return 16;
    return 8;
  }

  function advanceEnergyArc() {
    autoEnergyTarget += 0.1;
    if (autoEnergyTarget > 0.9) autoEnergyTarget = 0.58;
  }

  /**
   * Picks the next record the way a DJ would: tempo that fits, a key that
   * mixes, energy that matches where the set is heading, and something that
   * hasn't just been played.
   */
  function pickNextTrack(currentId, idleId) {
    var current = currentId != null ? trackById(currentId) : null;
    var pool = tracks.filter(function (t) { return !!t.buffer; });
    if (!pool.length) return null;

    if (currentId != null) {
      var others = pool.filter(function (t) { return t.id !== currentId; });
      if (others.length) pool = others;
    }

    var notIdle = pool.filter(function (t) { return t.id !== idleId; });
    if (notIdle.length) pool = notIdle;

    var best = null;
    var bestScore = -Infinity;

    for (var i = 0; i < pool.length; i++) {
      var cand = pool[i];
      var score = 0;

      if (current && current.bpm > 0 && cand.bpm > 0) {
        var delta = Math.abs(cand.bpm - current.bpm) / current.bpm;
        score += Math.max(0, 1 - delta / 0.08) * 2.6;
      } else {
        score += 0.8;
      }

      score += camelotScore(
        current && current.key ? current.key.camelot : null,
        cand.key ? cand.key.camelot : null
      ) * 2.4;

      var energy = typeof cand.energy === 'number' ? cand.energy : 0.6;
      score += Math.max(0, 1 - Math.abs(energy - autoEnergyTarget) / 0.4) * 1.8;

      var seen = autoHistory.lastIndexOf(cand.id);
      score += seen === -1 ? 1.1 : 0.4 * (1 - (seen + 1) / Math.max(1, autoHistory.length));

      if (score > bestScore) {
        bestScore = score;
        best = cand;
      }
    }

    return best;
  }

  /** Short, human-readable reason for the pick. */
  function aiReason(current, next) {
    var parts = [];
    if (next.bpm > 0) parts.push(Math.round(next.bpm) + ' BPM');
    if (next.key && next.key.camelot) parts.push(next.key.camelot);
    if (current && current.key && next.key &&
        camelotScore(current.key.camelot, next.key.camelot) >= 0.85) {
      parts.push('harmonic');
    }
    if (current && typeof current.energy === 'number' && typeof next.energy === 'number') {
      var diff = next.energy - current.energy;
      parts.push(diff > 0.06 ? 'energy ↑' : (diff < -0.06 ? 'energy ↓' : 'energy →'));
    }
    return parts.join(' · ');
  }

  /** Makes each engine deck hold what its panel is showing. */
  function syncDecksWithViews() {
    ['a', 'b'].forEach(function (id) {
      var view = views[id];
      var deck = engine.decks[id];
      if (view.track && (!deck.buffer || deck.trackId !== view.track.id)) {
        deck.loadTrack(view.track);
        applySettings(view, deck);
      }
    });
  }

  function openCrossfaderTo(id) {
    var value = id === 'a' ? 0 : 1;
    engine.setCrossfader(value);
    var input = document.getElementById('crossfader');
    if (input) input.value = String(value);
  }

  function updateAutoNext() {
    var el = document.getElementById('autoNext');
    if (!el) return;

    if (autoMix && autoMix.toView.track) {
      el.textContent = 'AI · mixing in ' + autoMix.toView.track.title;
      return;
    }

    if (!autoDJ) {
      el.textContent = 'Off · tap to run the set';
      return;
    }

    var a = engine.decks ? engine.decks.a : null;
    var b = engine.decks ? engine.decks.b : null;
    var playing = null;
    if (a && a.playing) playing = a;
    else if (b && b.playing) playing = b;

    var otherId = null;
    if (playing) {
      otherId = (playing === a) ? (b ? b.trackId : null) : (a ? a.trackId : null);
    }

    var next = pickNextTrack(playing ? playing.trackId : null, otherId);
    if (!next) {
      el.textContent = 'No tracks queued';
      return;
    }

    var current = playing ? trackById(playing.trackId) : null;
    var reason = aiReason(current, next);
    el.textContent = 'AI · ' + next.title + (reason ? ' · ' + reason : '');
  }

  /** Starts the set: opens a deck and plays a track on it. */
  function startAutoSet() {
    var a = engine.decks.a;
    var b = engine.decks.b;

    var targetId = null;
    if (a.buffer && autoHistory.indexOf(a.trackId) === -1) targetId = 'a';
    else if (b.buffer && autoHistory.indexOf(b.trackId) === -1) targetId = 'b';
    else targetId = engine.crossfader <= 0.5 ? 'a' : 'b';

    var view = views[targetId];
    var deck = engine.decks[targetId];

    if (!deck.buffer || autoHistory.indexOf(deck.trackId) !== -1) {
      var next = pickNextTrack(null, null);
      if (!next) return;
      loadTrackSilently(view, next);
      deck.loadTrack(next);
      view.needsLoad = false;
      applySettings(view, deck);
    }

    deck.seek(0);
    view.pitch.value = '0';
    applySettings(view, deck);
    deck.play();
    if (!deck.playing) return;

    pushHistory(deck.trackId);
    openCrossfaderTo(targetId);
    toast('Auto DJ · ' + (view.track ? view.track.title : 'playing'));
    updateAutoNext();
  }

  function smooth(p) {
    var x = p < 0 ? 0 : (p > 1 ? 1 : p);
    return x * x * (3 - 2 * x);
  }

  function eqBase(view) {
    return {
      low: Number(view.low.value),
      mid: Number(view.mid.value),
      high: Number(view.high.value)
    };
  }

  /**
   * Arms a real transition.
   *
   * `restartIncoming` is true when the incoming deck should drop in fresh (it
   * starts exactly on the next bar of the outgoing track). When the incoming
   * deck is already playing — the user hit play on both — it is not restarted
   * here: its beats are lined up with the outgoing track instead.
   */
  function armAutoMix(current, idle, currentView, idleView, restartIncoming, beats) {
    var ctx = engine.ctx;
    var beat = 60 / Math.max(current.bpm * current.rate, 1);
    var bar = beat * 4;
    var beatsForMix = beats || 16;

    var pos = current.position();
    var toBar = bar - (pos % bar);
    if (toBar < 0.05) toBar = bar;

    idle.syncTo(current);
    idleView.pitch.value = String(((idle.rate - 1) * 100).toFixed(1));

    // Mix in at the point the incoming track really gets going, not at 0:00.
    var mixIn = idleView.track && idleView.track.mixIn > 0 ? idleView.track.mixIn : 0;
    mixIn = Math.max(0, Math.min(mixIn, Math.max(0, idle.duration - 1)));

    if (restartIncoming) {
      idle.seek(mixIn);
      idle.playAt(mixIn, toBar);
    } else if (idle.playing) {
      var idleBeat = 60 / Math.max(idle.bpm * idle.rate, 1);
      var at = idle.position();
      at = at - (at % idleBeat) + (current.position() % beat);
      idle.seek(Math.max(0, Math.min(at, idle.duration - 0.5)));
    } else {
      idle.seek(mixIn);
      idle.playAt(mixIn, toBar);
    }

    var remaining = current.duration - current.position();
    var duration = Math.max(beat * 4, Math.min(beat * beatsForMix, remaining - toBar));

    // A deck that's already playing must not run out before the blend ends.
    if (!restartIncoming) {
      var incomingLeft = idle.duration - idle.position();
      duration = Math.max(beat * 4, Math.min(duration, incomingLeft - toBar));
    }

    autoMix = {
      from: current,
      to: idle,
      fromView: currentView,
      toView: idleView,
      startCtx: ctx.currentTime + toBar,
      duration: duration,
      startCross: engine.crossfader,
      targetCross: idle === engine.decks.a ? 0 : 1,
      fromBase: eqBase(currentView),
      toBase: eqBase(idleView),
      filterLift: restartIncoming,
      filterOpen: false
    };

    var incoming = idleView.track;
    var reason = incoming ? aiReason(currentView.track, incoming) : '';
    toast('AI · blending ' + (incoming ? incoming.title : 'next') + (reason ? ' · ' + reason : ''));
  }

  /** Runs the transition every frame: crossfader plus bass swap. */
  function updateAutoMix() {
    if (!autoMix) return;

    var now = engine.ctx ? engine.ctx.currentTime : 0;
    var raw = (now - autoMix.startCtx) / autoMix.duration;
    var eased = smooth(raw);

    var cross = autoMix.startCross + (autoMix.targetCross - autoMix.startCross) * eased;
    engine.setCrossfader(cross);

    var input = document.getElementById('crossfader');
    if (input) input.value = String(cross);

    // Bass swap: the incoming low end comes up while the outgoing one is
    // pulled away, which is what makes two tracks sit together.
    var fromLow = autoMix.fromBase.low + (-24 - autoMix.fromBase.low) * eased;
    autoMix.from.setEQ(
      fromLow,
      autoMix.fromBase.mid - 6 * eased,
      autoMix.fromBase.high - 6 * eased
    );

    var toLow = autoMix.toBase.low + (-24 - autoMix.toBase.low) * (1 - eased);
    autoMix.to.setEQ(
      toLow,
      autoMix.toBase.mid - 6 * (1 - eased),
      autoMix.toBase.high - 4 * (1 - eased)
    );

    // Energy lift on a fresh drop-in: the incoming track opens up through a
    // low-pass in the first half of the blend instead of arriving flat.
    if (autoMix.filterLift) {
      if (eased < 0.5) {
        autoMix.to.setFilter(-0.61 * (1 - eased / 0.5));
      } else if (!autoMix.filterOpen) {
        autoMix.to.setFilter(Number(autoMix.toView.filter.value));
        autoMix.filterOpen = true;
      }
    }

    if (raw >= 1) finishAutoMix();
  }

  function finishAutoMix() {
    if (!autoMix) return;

    var mix = autoMix;
    autoMix = null;

    engine.setCrossfader(mix.targetCross);
    var input = document.getElementById('crossfader');
    if (input) input.value = String(mix.targetCross);

    // The outgoing deck is done: stop it and give its EQ back to the sliders
    // so whatever gets loaded there next starts clean.
    mix.from.pause();
    mix.from.seek(0);
    applySettings(mix.fromView, mix.from);
    applySettings(mix.toView, mix.to);

    advanceEnergyArc();
    updateAutoNext();
  }

  /** The user grabbed the crossfader, or Auto DJ was switched off mid-mix. */
  function cancelAutoMix() {
    if (!autoMix) return;

    var mix = autoMix;
    autoMix = null;

    // The incoming track may still be waiting for its drop-in bar.
    if (engine.ctx && mix.to.startedAt > engine.ctx.currentTime) {
      mix.to.pause();
      mix.to.seek(0);
    }

    applySettings(mix.fromView, mix.from);
    applySettings(mix.toView, mix.to);
  }

  function checkAutoDJ() {
    if (!autoDJ || autoDJBusy || autoMix || !engine.decks) return;

    syncDecksWithViews();

    var a = engine.decks.a;
    var b = engine.decks.b;
    var aPlaying = a.playing;
    var bPlaying = b.playing;

    if (!aPlaying && !bPlaying) {
      startAutoSet();
      return;
    }

    // Both decks already running: take over and blend from the deck the
    // crossfader is pointing at into the other one.
    if (aPlaying && bPlaying) {
      var leader = engine.crossfader <= 0.5 ? a : b;
      var follower = leader === a ? b : a;
      if (!leader.bpm) return;

      var followerView = follower === a ? views.a : views.b;

      if (!follower.buffer) {
        var pick = pickNextTrack(leader.trackId, null);
        if (!pick) return;
        loadTrackSilently(followerView, pick);
        follower.loadTrack(pick);
        followerView.needsLoad = false;
        applySettings(followerView, follower);
      }

      var leaderBeat = 60 / Math.max(leader.bpm * leader.rate, 1);
      var followerLeft = follower.duration - follower.position();
      var restart = followerLeft < leaderBeat * 10;
      var beats = transitionBeats(leader, follower);

      autoDJBusy = true;
      pushHistory(follower.trackId);
      armAutoMix(leader, follower, views[leader.id], followerView, restart, beats);
      setTimeout(function () { autoDJBusy = false; }, 400);
      return;
    }

    var current = aPlaying ? a : b;
    var idle = current === a ? b : a;
    if (!current.bpm) return;

    var beat = 60 / Math.max(current.bpm * current.rate, 1);
    var remaining = current.duration - current.position();
    if (remaining <= 0) return;

    var idleView = idle === a ? views.a : views.b;
    var currentView = views[current.id];
    var currentId = current.trackId;

    // Decide what comes next before loading it: it sets the transition length
    // and where the mix-out point sits.
    var candidate = idle.buffer ? trackById(idle.trackId) : pickNextTrack(currentId, null);
    if (!candidate) return;

    var beats = transitionBeats(current, candidate);
    var outro = currentView.track && currentView.track.mixOut > 0 ? currentView.track.mixOut : 0;
    var atOutro = outro > 0 && current.position() >= outro;
    if (!atOutro && remaining > beat * beats) return;

    if (!idle.buffer || idle.trackId === currentId) {
      var next = pickNextTrack(currentId, idle.buffer ? idle.trackId : null) || candidate;
      loadTrackSilently(idleView, next);
      idle.loadTrack(next);
      idleView.needsLoad = false;
      applySettings(idleView, idle);
    }

    autoDJBusy = true;
    pushHistory(idle.trackId);

    armAutoMix(current, idle, currentView, idleView, true, beats);

    // Busy only covers the moment the mix is armed; the transition itself is
    // driven by `autoMix`.
    setTimeout(function () { autoDJBusy = false; }, 400);
  }

  // ---------------------------------------------------------------- drawing

  function drawWave(view, deck, pos) {
    var canvas = view.canvas;
    var cssW = canvas.clientWidth || 320;
    var cssH = canvas.clientHeight || 74;
    var dpr = window.devicePixelRatio || 1;
    var targetW = Math.max(1, Math.floor(cssW * dpr));
    var targetH = Math.max(1, Math.floor(cssH * dpr));

    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    var g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cssW, cssH);

    var accent = deckAccent(view.id);
    var mid = cssH / 2;
    var centerX = cssW / 2;
    var pxPerSec = cssW / VIEW_SECONDS;
    var track = view.track;

    if (!track || !track.peaks) {
      g.fillStyle = 'rgba(255,255,255,0.10)';
      g.fillRect(0, mid - 0.5, cssW, 1);
      return;
    }

    var duration = track.duration || 1;
    var peaks = track.peaks;

    if (deck && deck.loopBeats > 0) {
      var loopX0 = centerX + (deck.loopStart - pos) * pxPerSec;
      var loopX1 = centerX + (deck.loopEnd - pos) * pxPerSec;
      var from = Math.max(0, loopX0);
      var to = Math.min(cssW, loopX1);
      if (to > from) {
        g.fillStyle = accent + '22';
        g.fillRect(from, 0, to - from, cssH);
      }
    }

    for (var x = 0; x < cssW; x += 2) {
      var t = pos + (x - centerX) / pxPerSec;
      if (t < 0 || t > duration) continue;
      var index = Math.floor(t / duration * peaks.length);
      if (index < 0) index = 0;
      if (index >= peaks.length) index = peaks.length - 1;
      var value = peaks[index] || 0;
      var barHeight = value * mid * 0.92;
      if (barHeight < 0.5) continue;
      g.fillStyle = x < centerX ? accent : accent + '60';
      g.fillRect(x, mid - barHeight, 1.6, barHeight * 2);
    }

    if (track.bpm > 0) {
      var beat = 60 / track.bpm;
      var firstBeat = Math.ceil((pos - 4) / beat);
      for (var i = 0; i < 400; i++) {
        var beatIndex = firstBeat + i;
        var beatX = centerX + (beatIndex * beat - pos) * pxPerSec;
        if (beatX > cssW) break;
        if (beatX >= 0) {
          g.fillStyle = 'rgba(255,255,255,' + (beatIndex % 4 === 0 ? 0.2 : 0.07) + ')';
          g.fillRect(beatX, 0, 1, cssH);
        }
      }
    }

    var cues = track.cues || [];
    for (var c = 0; c < cues.length; c++) {
      if (cues[c] == null) continue;
      var cueX = centerX + (cues[c] - pos) * pxPerSec;
      if (cueX < 0 || cueX > cssW) continue;
      g.fillStyle = 'rgba(255,255,255,0.75)';
      g.fillRect(cueX - 0.75, 0, 1.5, cssH);
      g.fillStyle = '#ffffff';
      g.font = 'bold 9px -apple-system, system-ui, sans-serif';
      g.fillText(String(c + 1), cueX + 3, 11);
    }

    g.fillStyle = '#ffffff';
    g.fillRect(centerX - 1, 0, 2, cssH);
  }

  function updateDeckView(view, shouldDraw) {
    var deck = engine.decks ? engine.decks[view.id] : null;
    var track = view.track;
    var position = view.dragging ? view.dragPos : (deck ? deck.position() : 0);
    var playing = deck ? deck.playing : false;
    var duration = track ? track.duration : 0;
    // Before a deck's buffer is loaded into the engine its bpm is 0; the track
    // carries the analysed value, so fall back to it rather than showing "--".
    var bpm = deck && deck.bpm > 0 ? deck.effectiveBPM() : (track ? track.bpm : 0);

    view.panel.classList.toggle('playing', playing);
    var label = playing ? '❚❚' : '▶';
    if (view.playBtn.textContent !== label) view.playBtn.textContent = label;

    if (!track) {
      var hint = tracks.length ? 'Open the library to load a track' : 'Building built-in tracks…';
      if (view.artistEl.textContent !== hint) view.artistEl.textContent = hint;
    }

    view.timeEl.textContent = fmtTime(position) + ' / -' + fmtTime(Math.max(0, duration - position));
    view.bpmEl.textContent = bpm > 0 ? bpm.toFixed(1) : '--';
    view.hubBpm.textContent = bpm > 0 ? String(Math.round(bpm)) : '--';

    var level = deck ? deck.level() : 0;
    view.meterFill.style.width = Math.round(level * 100) + '%';

    if (playing && track && bpm > 0) {
      var beatSeconds = 60 / Math.max(bpm, 1);
      var revolutions = position / (beatSeconds * 4);
      var degrees = (revolutions % 1) * 360;
      view.ring.style.transform = 'rotate(' + degrees.toFixed(1) + 'deg)';
    }

    if (shouldDraw) drawWave(view, deck, position);
  }

  // ------------------------------------------------------------------ loop

  function frame(timestamp) {
    requestAnimationFrame(frame);

    updateStrip();

    var now = timestamp || 0;
    var shouldDraw = now - lastDraw > 33;
    if (shouldDraw) lastDraw = now;

    updateDeckView(views.a, shouldDraw);
    updateDeckView(views.b, shouldDraw);

    checkAutoDJ();
    updateAutoMix();
  }

  // ------------------------------------------------------------------ init

  function init() {
    views.a = buildDeck('a');
    views.b = buildDeck('b');

    setupMeter();
    setupStrip();
    setupLibrary();
    renderLibrary();
    renderRecordings();
    loadBuiltInTracks();

    requestAnimationFrame(frame);
  }

  // Debug surface for the self-test page: lets the mixer be inspected and
  // driven from outside the closure.

  window.AuxRushApp = {
    engine: engine,
    tracks: function () { return tracks; },
    videos: function () { return videos; },
    clearVideos: function () { videos.length = 0; saveVideos(); renderLibrary(); },
    pickNext: function () { return pickNextTrack(null, null); },
    status: function () {
      var a = engine.decks ? engine.decks.a : null;
      var b = engine.decks ? engine.decks.b : null;
      return {
        autoDJ: autoDJ,
        libTab: libTab,
        hasContext: !!engine.ctx,
        contextState: engine.ctx ? engine.ctx.state : 'none',
        decks: a ? {
          a: { playing: a.playing, bpm: a.bpm, track: a.trackId, pos: Math.round(a.position() * 10) / 10 },
          b: { playing: b.playing, bpm: b.bpm, track: b.trackId, pos: Math.round(b.position() * 10) / 10 }
        } : null
      };
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
