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
            '<button class="chip jump" data-jump="-1" title="Jump back one bar">‹1</button>' +
            '<button class="chip jump" data-jump="1" title="Jump forward one bar">1›</button>' +
          '</div>' +
        '</div>' +

        '<div class="hotcues">' +
          '<button class="cue-slot" data-cue="0">1</button>' +
          '<button class="cue-slot" data-cue="1">2</button>' +
          '<button class="cue-slot" data-cue="2">3</button>' +
          '<button class="cue-slot" data-cue="3">4</button>' +
        '</div>' +

        '<div class="fx-row">' +
          '<button class="chip fx" data-fx="echo">ECHO</button>' +
          '<button class="chip fx" data-fx="verb">VERB</button>' +
          '<button class="chip fx" data-fx="flux">FLUX</button>' +
          '<button class="chip slip" data-slip title="Slip: pause or scratch and the record carries on underneath">SLIP</button>' +
          '<button class="chip fx quant active" data-quant title="Quantize: snap cues and loops to the grid">Q</button>' +
        '</div>' +

        '<div class="deck-mix">' +
          '<label class="knob"><span>FILTER</span>' +
            '<input type="range" class="f-filter" min="-1" max="1" step="0.01" value="0"></label>' +
          '<label class="knob"><span>LOW</span>' +
            '<input type="range" class="f-low" min="-30" max="12" step="0.5" value="0"></label>' +
          '<label class="knob"><span>MID</span>' +
            '<input type="range" class="f-mid" min="-30" max="12" step="0.5" value="0"></label>' +
          '<label class="knob"><span>HIGH</span>' +
            '<input type="range" class="f-high" min="-30" max="12" step="0.5" value="0"></label>' +
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
      platter: panel.querySelector('.platter'),
      playBtn: panel.querySelector('.btn.play'),
      cueBtn: panel.querySelector('.btn.cue'),
      syncBtn: panel.querySelector('.btn.sync'),
      loopChips: Array.prototype.slice.call(panel.querySelectorAll('.chip:not(.fx):not(.jump)')),
      fxChips: Array.prototype.slice.call(panel.querySelectorAll('.fx-row .fx:not(.quant)')),
      quantChip: panel.querySelector('.fx-row .quant'),
      slipChip: panel.querySelector('.fx-row .slip'),
      jumpChips: Array.prototype.slice.call(panel.querySelectorAll('.chip.jump')),
      cueSlots: Array.prototype.slice.call(panel.querySelectorAll('.cue-slot')),
      filter: panel.querySelector('.f-filter'),
      low: panel.querySelector('.f-low'),
      mid: panel.querySelector('.f-mid'),
      high: panel.querySelector('.f-high'),
      pitch: panel.querySelector('.f-pitch'),
      quantize: true,
      slip: false,
      track: null,
      needsLoad: false,
      dragging: false,
      dragBase: 0,
      dragPos: 0,
      needsRedraw: true,
      lastDrawnKey: -1
    };

    wireDeck(view);
    return view;
  }

  function applySettings(view, deck) {
    deck.setEQ(Number(view.low.value), Number(view.mid.value), Number(view.high.value));
    deck.setFilter(Number(view.filter.value));
    deck.setRate(1 + Number(view.pitch.value) / 100);
    deck.setSlip(!!view.slip);
  }

/**
   * The engine's deck for a view, loading the pending track on first use.
   * Persisted imports have no decoded buffer yet — their audio comes from
   * IndexedDB and decodes lazily; the deck loads the moment it arrives.
   */
  function deckFor(view) {
    var deck = engine.deck(view.id);
    if (view.needsLoad && view.track) {
      var track = view.track;
      view.needsLoad = false;
      if (track.buffer) {
        deck.loadTrack(track);
      } else if (track.imported) {
        ensureBuffer(track, function () {
          if (view.track === track && !deck.buffer) {
            deck.loadTrack(track);
            applySettings(view, deck);
            view.needsRedraw = true;
          }
        });
      }
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
      // A restored import may still be decoding — wait for it, then play.
      if (!deck.buffer && view.track.imported) {
        view.artistEl.textContent = 'Loading audio…';
        ensureBuffer(view.track, function () {
          if (!view.track) return;
          if (!deck.buffer || deck.trackId !== view.track.id) {
            deck.loadTrack(view.track);
          }
          view.artistEl.textContent = view.track.artist + ' · ' + fmtTime(view.track.duration);
          applySettings(view, deck);
          deck.play();
          view.needsRedraw = true;
        });
        return;
      }
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

    // CUE behaves like a CDJ: while playing, a press jumps back to the cue
    // point and keeps going; while paused, holding plays a preview from the
    // cue and releasing snaps back to it.
    var cueWasPlaying = false;

    function cueTime() {
      var cue = view.track.cues[0];
      return cue != null ? cue : 0;
    }

    view.cueBtn.addEventListener('pointerdown', function () {
      if (!view.track) return;
      var deck = deckFor(view);
      cueWasPlaying = deck.playing;
      if (deck.playing) {
        deck.seek(cueTime());
      } else {
        deck.playAt(cueTime());
      }
    });

    function releaseCue() {
      if (!view.track || cueWasPlaying) return;
      var deck = deckFor(view);
      deck.pause();
      deck.seek(cueTime());
      view.needsRedraw = true;
    }

    view.cueBtn.addEventListener('pointerup', releaseCue);
    view.cueBtn.addEventListener('pointercancel', releaseCue);

    view.syncBtn.addEventListener('click', function () {
      var deck = deckFor(view);
      var other = engine.decks[view.id === 'a' ? 'b' : 'a'];
      // Sync matches tempo AND, while both decks are running, lines the beats
      // up so the kicks land together — the part that makes it feel real.
      deck.syncTo(other, true);
      view.pitch.value = String(((deck.rate - 1) * 100).toFixed(1));
    });

    view.loopChips.forEach(function (chip, index) {
      chip.addEventListener('click', function () {
        if (!view.track) return;
        var beats = Number(chip.getAttribute('data-loop'));
        var deck = deckFor(view);
        deck.setLoop(beats);
        view.needsRedraw = true;
        view.loopChips.forEach(function (c, j) {
          c.classList.toggle('active', j === index);
        });
      });
    });

    // FX pads: tempo-synced echo, plate reverb, filter flux — fire mid-mix.
    view.fxChips.forEach(function (chip) {
      chip.addEventListener('click', function () {
        if (!view.track) return;
        var deck = deckFor(view);
        var name = chip.getAttribute('data-fx');
        var on = !chip.classList.contains('on');
        deck.setFX(name, on);
        chip.classList.toggle('on', on);
      });
    });

    // Quantize toggle: cue sets and loop starts snap to the beat grid.
    view.quantChip.addEventListener('click', function () {
      view.quantize = !view.quantize;
      view.quantChip.classList.toggle('active', view.quantize);
      toast('Quantize ' + (view.quantize ? 'on · cues and loops snap to the grid' : 'off'));
    });

    // Slip: pausing or scratching mutes the deck while the record keeps moving
    // underneath, so it re-enters on the beat when you let go.
    view.slipChip.addEventListener('click', function () {
      view.slip = !view.slip;
      view.slipChip.classList.toggle('active', view.slip);
      if (engine.decks) engine.decks[view.id].setSlip(view.slip);
      toast('Slip ' + (view.slip ? 'on · the record keeps running underneath' : 'off'));
    });

    // Beat jump: move the playhead a whole bar without losing the beat.
    view.jumpChips.forEach(function (chip) {
      chip.addEventListener('click', function () {
        if (!view.track) return;
        var deck = deckFor(view);
        if (!deck.bpm) return;
        var bars = Number(chip.getAttribute('data-jump'));
        deck.seek(deck.position() + bars * (60 / deck.bpm) * 4);
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
            saveCues(view.track);
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

    [view.filter, view.low, view.mid, view.high, view.pitch].forEach(function (input) {
      input.addEventListener('input', function () {
        if (engine.decks) applySettings(view, engine.decks[view.id]);
      });
    });

    // Jog wheel, two gestures like a real deck:
    //   · drag the hub  = scratch (grains follow the finger, both directions)
    //   · drag the rim  = pitch bend, for riding a beat into phase by ear
    var jog = null;

    view.platter.style.touchAction = 'none';

    view.platter.addEventListener('pointerdown', function (event) {
      if (!view.track) return;
      var deck = engine.decks ? engine.decks[view.id] : null;
      if (!deck) return;

      var rect = view.platter.getBoundingClientRect();
      var cx = rect.left + rect.width / 2;
      var cy = rect.top + rect.height / 2;
      var dist = Math.sqrt(Math.pow(event.clientX - cx, 2) + Math.pow(event.clientY - cy, 2));
      var onHub = dist < rect.width * 0.34;

      if (onHub && deck.buffer) {
        // Grabbing the record stops it dead in its tracks and lets the finger
        // play it — mute-free, so the scratch is audible.
        jog = {
          mode: 'scratch',
          startX: event.clientX,
          lastX: event.clientX,
          lastT: performance.now(),
          deck: deck
        };
        deck.scratchStart();
      } else {
        jog = { mode: 'bend', startX: event.clientX, deck: deck };
      }
      try { view.platter.setPointerCapture(event.pointerId); } catch (err) { /* older browsers */ }
    });

    view.platter.addEventListener('pointermove', function (event) {
      if (!jog) return;

      if (jog.mode == "bend") {
        var dx = event.clientX - jog.startX;
        jog.deck.setBend(window.AuxRush.clamp(dx * 0.35, -30, 30));
        return;
      }

      var step = event.clientX - jog.lastX;
      if (Math.abs(step) < 2) return;

      var now = performance.now();
      var speed = Math.abs(step) / Math.max(8, now - jog.lastT) * 12;
      // 1 px of drag ≈ 5 ms of audio; faster drags pitch the grain up.
      jog.deck.scratchMove(step * 0.005, window.AuxRush.clamp(speed, 0.7, 2.6));
      jog.lastX = event.clientX;
      jog.lastT = now;
      view.needsRedraw = true;
    });

    function endJog() {
      if (!jog) return;
      if (jog.mode === 'bend') {
        jog.deck.setBend(0);
      } else {
        jog.deck.scratchEnd();
        if (!jog.deck.playing) {
          view.pausedPos = jog.deck.pausedPos;
        }
      }
      jog = null;
      view.needsRedraw = true;
    }

    view.platter.addEventListener('pointerup', endJog);
    view.platter.addEventListener('pointercancel', endJog);

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
      view.needsRedraw = true;
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

  /** Snaps a position onto the nearest beat of the loaded track's grid. */
  function snapToBeat(deck, t) {
    if (!deck.bpm) return t;
    var beat = 60 / deck.bpm;
    return Math.round(t / beat) * beat;
  }

  function jumpOrSetCue(view, index) {
    if (!view.track) return;
    var deck = deckFor(view);
    var cues = view.track.cues;
    if (cues[index] != null) {
      deck.seek(view.track.cues[index]);
      view.needsRedraw = true;
    } else {
      view.track.cues[index] = snapToBeat(deck, deck.position());
      updateCueButtons(view);
      saveCues(view.track);
      toast('Cue ' + (index + 1) + ' set');
    }
  }

  function updateCueButtons(view) {
    var cues = view.track ? view.track.cues : null;
    view.needsRedraw = true;
    view.cueSlots.forEach(function (slot, index) {
      slot.classList.toggle('set', !!(cues && cues[index] != null));
    });
  }

  // -------------------------------------------------------------- loading

  function loadTrack(view, track) {
    view.track = track;
    view.needsLoad = true;
    if (!track.cues) track.cues = [null, null, null, null];

    // Loading stops a running deck: say so instead of silently cutting sound.
    var liveDeck = engine.decks ? engine.decks[view.id] : null;
    if (liveDeck && liveDeck.playing) {
      toast('Heads up: deck ' + view.id.toUpperCase() + ' was playing — it stopped');
    }

    view.titleEl.textContent = track.title;
    view.artistEl.textContent = track.artist + ' · ' + fmtTime(track.duration);
    view.bpmEl.textContent = track.bpm ? track.bpm.toFixed(1) : '--';
    view.keyEl.textContent = track.key && track.key.camelot ? track.key.camelot : '--';
    view.hubBpm.textContent = track.bpm ? String(Math.round(track.bpm)) : '--';
    view.timeEl.textContent = '0:00 / -' + fmtTime(track.duration);
    view.panel.classList.remove('playing');
    view.needsRedraw = true;
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
    view.needsRedraw = true;
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
      var stored = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(stored)) stored = [];
      // Drop anything saved without a usable id (older formats, corrupt data).
      videos = stored.filter(function (v) {
        return v && typeof v.videoId === 'string' && v.videoId.length === 11;
      });
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
            var line = document.querySelector('#videoTitle .video-title-line');
            if (line) line.textContent = video.title;
          }
        }
      })
      .catch(function () {
        /* offline: keep the placeholder title */
      });
  }

  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function playVideo(video) {
    currentVideo = video;
    var pane = document.getElementById('videoPane');
    var frame = document.getElementById('videoFrame');
    var title = document.getElementById('videoTitle');
    var note = document.getElementById('videoNote');
    if (!pane || !frame) return;

    var watchUrl = 'https://www.youtube.com/watch?v=' + video.videoId;
    var canEmbed = location.protocol === 'http:' || location.protocol === 'https:';

    if (!canEmbed) {
      // A local view (file:// or an app scheme) sends no web referer, and
      // YouTube refuses to play embeds without one (error 153). The artwork
      // itself is the link: tapping it opens the video on YouTube, where it
      // plays for real.
      frame.innerHTML =
        '<a class="video-fallback" style="background-image:url(https://img.youtube.com/vi/' +
        video.videoId + '/hqdefault.jpg)" href="' + watchUrl +
        '" target="_blank" rel="noopener"><span class="video-fallback-play">▶</span></a>';
      if (note) {
        note.textContent = 'YouTube won’t play inside a local view — tap the artwork to open ' +
          video.title + ' on YouTube, or run the app from its web URL for embedded playback.';
      }
    } else {
      // youtube-nocookie is the embed that behaves best inside a web view, and
      // autoplay stays off — a refused autoplay looks exactly like a dead link.
      frame.innerHTML =
        '<iframe src="https://www.youtube-nocookie.com/embed/' + video.videoId +
        '?rel=0&modestbranding=1&playsinline=1" title="' + escapeHtml(video.title) +
        '" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture" ' +
        'allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>';

      var loaded = false;
      var iframe = frame.querySelector('iframe');
      if (iframe) {
        iframe.addEventListener('load', function () { loaded = true; });
      }

      // Some embedded browsers refuse third-party frames outright. Rather than
      // leaving a black rectangle, say so and point at the external link.
      setTimeout(function () {
        if (!loaded && currentVideo === video && note) {
          note.textContent = 'The embedded player was blocked here — open the video on YouTube instead.';
        }
      }, 4000);
    }

    if (title) {
      title.innerHTML = '';
      var line = document.createElement('div');
      line.className = 'video-title-line';
      line.textContent = video.title;
      title.appendChild(line);

      var links = document.createElement('div');
      links.className = 'video-links';
      var open = document.createElement('a');
      open.href = watchUrl;
      open.target = '_blank';
      open.rel = 'noopener';
      open.textContent = 'Open on YouTube ↗';
      links.appendChild(open);
      title.appendChild(links);
    }

    if (note && canEmbed) {
      note.textContent = 'Video audio comes from YouTube and can’t be fed into the decks.';
    }

    pane.classList.remove('hidden');
    if (pane.scrollIntoView) {
      try {
        pane.scrollIntoView({ block: 'start', behavior: 'smooth' });
      } catch (err) {
        pane.scrollIntoView();
      }
    }
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
    var tabFree = document.getElementById('tabFree');
    var tabVideos = document.getElementById('tabVideos');
    var addRow = document.getElementById('addVideoRow');
    var videoPane = document.getElementById('videoPane');
    var freePane = document.getElementById('freePane');
    var search = document.getElementById('libSearch');

    if (tabMix) tabMix.classList.toggle('active', tab === 'mix');
    if (tabFree) tabFree.classList.toggle('active', tab === 'free');
    if (tabVideos) tabVideos.classList.toggle('active', tab === 'videos');
    if (addRow) addRow.classList.toggle('hidden', tab !== 'videos');
    if (videoPane && tab !== 'videos') videoPane.classList.add('hidden');
    if (freePane) freePane.classList.toggle('hidden', tab !== 'free');

    if (search) {
      search.placeholder = tab === 'videos'
        ? 'Search your videos'
        : (tab === 'free' ? 'Search free music — genre, artist, mood' : 'Search title, artist, key');
    }

    if (tab === 'mix') stopVideo();
    if (tab === 'free') loadFreeMusic(search ? search.value : '');
    renderLibrary();
  }

  // ------------------------------------------------------- free music shelf
  //
  //  Creative Commons netlabel releases from the Internet Archive: real
  //  artists, released free by their labels, downloadable and mixable. The
  //  commercial catalogue (Fetty Wap and everything else on a major) is not
  //  licensed for this, so it isn't fetched — import your own copy instead.

  var freeItems = [];
  var freeTracks = [];
  var freeOpenId = null;
  var freeBusy = false;
  var freeGenre = 'Hip-hop';
  var freeSearchTimer = null;

  function freeGenreChips() {
    var wrap = document.getElementById('freeGenres');
    if (!wrap || wrap.childElementCount) return;
    Object.keys(window.AuxRushCatalog.GENRES).forEach(function (label) {
      var chip = document.createElement('button');
      chip.className = 'chip free-genre' + (label === freeGenre ? ' active' : '');
      chip.textContent = label;
      chip.addEventListener('click', function () {
        freeGenre = label;
        Array.prototype.forEach.call(wrap.children, function (c) {
          c.classList.toggle('active', c === chip);
        });
        loadFreeMusic('');
      });
      wrap.appendChild(chip);
    });
  }

  function renderCatalog() {
    var list = document.getElementById('freeResults');
    if (!list) return;
    list.innerHTML = '';

    if (freeBusy) {
      list.appendChild(emptyTile('Searching the Internet Archive…'));
      return;
    }
    if (!freeItems.length) {
      list.appendChild(emptyTile('Nothing found — try another search or genre.'));
      return;
    }

    freeItems.forEach(function (item) {
      var card = document.createElement('div');
      card.className = 'free-item';

      var head = document.createElement('button');
      head.className = 'free-item-head';
      head.type = 'button';

      var meta = document.createElement('span');
      meta.className = 'free-item-meta';
      var title = document.createElement('span');
      title.className = 'free-item-title';
      title.textContent = item.title;
      var sub = document.createElement('span');
      sub.className = 'free-item-sub';
      sub.textContent = item.creator + (item.year ? ' · ' + item.year : '');
      meta.appendChild(title);
      meta.appendChild(sub);

      var tag = document.createElement('span');
      tag.className = 'free-item-tag';
      tag.textContent = freeOpenId === item.identifier ? 'HIDE' : 'TRACKS';

      head.appendChild(meta);
      head.appendChild(tag);
      head.addEventListener('click', function () { toggleFreeItem(item); });
      card.appendChild(head);

      if (freeOpenId === item.identifier) {
        var rows = document.createElement('div');
        rows.className = 'free-tracks';
        if (!freeTracks.length) {
          rows.appendChild(emptyTile('Reading the release…'));
        }
        freeTracks.forEach(function (tr) {
          var row = document.createElement('div');
          row.className = 'free-track';

          var info = document.createElement('span');
          info.className = 'free-track-meta';
          var name = document.createElement('span');
          name.className = 'free-track-title';
          name.textContent = tr.title;
          var detail = document.createElement('span');
          detail.className = 'free-track-sub';
          detail.textContent = tr.artist + (tr.duration ? ' · ' + fmtTime(tr.duration) : '') +
            (tr.licence ? ' · CC' : '');
          info.appendChild(name);
          info.appendChild(detail);

          var add = document.createElement('button');
          add.className = 'btn tiny accent';
          add.textContent = 'Add';
          add.addEventListener('click', function () { addCatalogTrack(tr, add); });

          row.appendChild(info);
          row.appendChild(add);
          rows.appendChild(row);
        });
        card.appendChild(rows);
      }

      list.appendChild(card);
    });
  }

  function loadFreeMusic(query) {
    freeGenreChips();
    var catalog = window.AuxRushCatalog;
    if (!catalog) return;

    freeBusy = true;
    freeOpenId = null;
    freeTracks = [];
    renderCatalog();

    var term = (query || '').trim();
    var request = term
      ? catalog.search(term, catalog.GENRES[freeGenre] || '')
      : catalog.picks();

    request.then(function (items) {
      freeItems = items;
      freeBusy = false;
      renderCatalog();
    }).catch(function () {
      freeBusy = false;
      freeItems = [];
      renderCatalog();
      toast('Could not reach the free music archive');
    });
  }

  function toggleFreeItem(item) {
    var catalog = window.AuxRushCatalog;
    if (!catalog) return;

    if (freeOpenId === item.identifier) {
      freeOpenId = null;
      freeTracks = [];
      renderCatalog();
      return;
    }

    freeOpenId = item.identifier;
    freeTracks = [];
    renderCatalog();

    catalog.tracks(item.identifier).then(function (list) {
      if (freeOpenId !== item.identifier) return;
      freeTracks = list;
      renderCatalog();
    }).catch(function () {
      toast('Could not read that release');
    });
  }

  /** Download a CC track, decode it, analyse it, keep it in the library. */
  function addCatalogTrack(source, button) {
    var ctx;
    try {
      ctx = engine.ensureContext();
    } catch (err) {
      toast('Web Audio is not available here');
      return;
    }

    if (button) {
      button.textContent = '…';
      button.disabled = true;
    }

    var sourceId = source.identifier + '/' + source.url.split('/').pop();
    if (tracks.some(function (t) { return t.sourceId === sourceId; })) {
      toast('Already in your library');
      if (button) { button.textContent = 'Added'; }
      return;
    }

    toast('Downloading ' + source.title + '…');

    fetch(source.url).then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.blob();
    }).then(function (blob) {
      return blob.arrayBuffer().then(function (data) {
        return new Promise(function (resolve, reject) {
          ctx.decodeAudioData(data, resolve, reject);
        }).then(function (buffer) {
          return { buffer: buffer, blob: blob };
        });
      });
    }).then(function (result) {
      var analysis = window.AuxRush.analyzeBuffer(result.buffer);
      var track = {
        id: nextId++,
        title: source.title,
        artist: source.artist,
        bpm: analysis.bpm,
        duration: result.buffer.duration,
        buffer: result.buffer,
        peaks: analysis.peaks,
        bandsLow: analysis.bandsLow,
        bandsMid: analysis.bandsMid,
        bandsHigh: analysis.bandsHigh,
        key: analysis.key,
        energy: analysis.energy,
        mixIn: analysis.mixIn,
        mixOut: analysis.mixOut,
        cues: [null, null, null, null],
        imported: true,
        sourceId: sourceId,
        licence: source.licence || ''
      };
      tracks.push(track);

      idbPut('audio', String(track.id), {
        blob: result.blob,
        title: track.title,
        artist: track.artist,
        bpm: track.bpm,
        duration: track.duration,
        key: track.key,
        energy: track.energy,
        mixIn: track.mixIn,
        mixOut: track.mixOut,
        cues: track.cues,
        peaks: track.peaks,
        bandsLow: track.bandsLow || null,
        bandsMid: track.bandsMid || null,
        bandsHigh: track.bandsHigh || null
      }).catch(function () {});

      if (button) { button.textContent = 'Added'; }
      renderLibrary();
      toast('Added ' + track.title + ' · ' + Math.round(track.bpm) + ' BPM');
    }).catch(function (err) {
      if (button) {
        button.textContent = 'Add';
        button.disabled = false;
      }
      toast('Could not get that track' + (err && err.message ? ' (' + err.message + ')' : ''));
    });
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
        idbDel('audio', String(track.id)).catch(function () {});
        delete cueMap[cueKey(track)];
        idbPut('state', 'cueMap', cueMap).catch(function () {});
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

    // YouTube's own page always plays the video, even where embeds are blocked.
    var open = document.createElement('a');
    open.className = 'btn tiny ghost open-link';
    open.href = 'https://www.youtube.com/watch?v=' + video.videoId;
    open.target = '_blank';
    open.rel = 'noopener';
    open.textContent = 'Open ↗';

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
    actions.appendChild(open);
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
    var tabFree = document.getElementById('tabFree');
    var tabVideos = document.getElementById('tabVideos');
    var search = document.getElementById('libSearch');
    var addBtn = document.getElementById('addVideoBtn');
    var url = document.getElementById('videoUrl');

    if (tabMix) tabMix.addEventListener('click', function () { switchTab('mix'); });
    if (tabFree) tabFree.addEventListener('click', function () { switchTab('free'); });
    if (tabVideos) tabVideos.addEventListener('click', function () { switchTab('videos'); });
    if (search) {
      search.addEventListener('input', function () {
        libQuery = search.value || '';
        if (libTab === 'free') {
          clearTimeout(freeSearchTimer);
          freeSearchTimer = setTimeout(function () { loadFreeMusic(libQuery); }, 450);
        }
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
        var track = {
          id: nextId++,
          title: groove.title,
          artist: groove.artist,
          bpm: groove.bpm,
          duration: buffer.duration,
          buffer: buffer,
          peaks: analysis.peaks,
          bandsLow: analysis.bandsLow,
          bandsMid: analysis.bandsMid,
          bandsHigh: analysis.bandsHigh,
          key: analysis.key,
          energy: analysis.energy,
          mixIn: analysis.mixIn,
          mixOut: analysis.mixOut,
          cues: [null, null, null, null],
          imported: false
        };
        // Built-in grooves are regenerated each boot; their saved cues
        // survive in the cue map, keyed by title.
        applySavedCues(track);
        tracks.push(track);
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

        var track = {
          id: nextId++,
          title: title,
          artist: artist,
          bpm: analysis.bpm,
          duration: buffer.duration,
          buffer: buffer,
          peaks: analysis.peaks,
          bandsLow: analysis.bandsLow,
          bandsMid: analysis.bandsMid,
          bandsHigh: analysis.bandsHigh,
          key: analysis.key,
          energy: analysis.energy,
          mixIn: analysis.mixIn,
          mixOut: analysis.mixOut,
          cues: [null, null, null, null],
          imported: true
        };
        tracks.push(track);

        // Persist the import: blob + analysis + cues, keyed by track id.
        idbPut('audio', String(track.id), {
          blob: file,
          title: title,
          artist: artist,
          bpm: track.bpm,
          duration: track.duration,
          key: track.key,
          energy: track.energy,
          mixIn: track.mixIn,
          mixOut: track.mixOut,
          cues: track.cues,
          peaks: track.peaks,
          bandsLow: track.bandsLow || null,
          bandsMid: track.bandsMid || null,
          bandsHigh: track.bandsHigh || null
        }).catch(function () {});

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

  // ------------------------------------------------------- persistence
  //
  //  One IndexedDB database ("auxrush"), three stores:
  //   · "audio" — imported files (Blob) + analysis metadata, keyed by track id
  //   · "recs"  — recorded sets (blob + name + size), keyed by timestamp
  //  · "state"  — small state: the cue map for every track
  //
  //  Built-in grooves are regenerated every boot, but their cues survive
  //  (keyed by title). Imports restore instantly as metadata and decode
  //  lazily — the audio only decodes when a deck first needs it, because a
  //  decoded stereo minute of PCM is ~10 MB.

  var idb = null;
  var cueMap = {};
  var decodeInflight = {};

  function idbOpen() {
    if (idb) return Promise.resolve(idb);
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error('no indexedDB')); return; }
      var req = window.indexedDB.open('auxrush', 1);
      req.onupgradeneeded = function (event) {
        var db = event.target.result;
        if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio');
        if (!db.objectStoreNames.contains('recs')) db.createObjectStore('recs');
        if (!db.objectStoreNames.contains('state')) db.createObjectStore('state');
      };
      req.onsuccess = function () { idb = req.result; resolve(idb); };
      req.onerror = function () { reject(req.error || new Error('idb failed')); };
    });
  }

  function idbPut(store, key, value) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(value, key);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function idbGet(store, key) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var req = db.transaction(store).objectStore(store).get(key);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function idbDel(store, key) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).delete(key);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function idbAll(store) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var out = [];
        var req = db.transaction(store).objectStore(store).openCursor();
        req.onsuccess = function (event) {
          var cursor = event.target.result;
          if (!cursor) { resolve(out); return; }
          out.push({ key: cursor.key, value: cursor.value });
          cursor.continue();
        };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function cueKey(track) {
    return track.imported ? 'i:' + track.id : 't:' + track.title;
  }

  function saveCues(track) {
    cueMap[cueKey(track)] = track.cues;
    idbPut('state', 'cueMap', cueMap).catch(function () {});
  }

  function applySavedCues(track) {
    var saved = cueMap[cueKey(track)];
    if (saved && track.cues.every(function (c) { return c == null; })) {
      track.cues = saved.slice(0, 4);
    }
  }

  /** Decodes a persisted import once, on first need; caches the promise. */
  function ensureBuffer(track, cb) {
    if (track.buffer) { cb(track.buffer); return; }
    var inflight = decodeInflight[track.id];
    if (inflight) { inflight.then(cb); return; }
    if (!track.imported) { cb(null); return; }
    var promise = idbGet('audio', String(track.id)).then(function (rec) {
      if (!rec || !rec.blob) throw new Error('missing audio');
      var ctx = engine.ensureContext();
      return new Promise(function (resolve, reject) {
        ctx.decodeAudioData(rec.blob.slice(0), resolve, reject);
      });
    }).then(function (buf) {
      track.buffer = buf;
      if (!track.peaks) track.peaks = window.AuxRush.analyzeBuffer(buf).peaks;
      return buf;
    });
    decodeInflight[track.id] = promise;
    promise.then(function () { cb(track.buffer); }, function () {
      delete decodeInflight[track.id];
      toast('Stored audio for "' + track.title + '" is gone — removing it');
      removeTrack(track);
    });
  }

  function removeTrack(track) {
    var index = tracks.indexOf(track);
    if (index >= 0) tracks.splice(index, 1);
    ['a', 'b'].forEach(function (id) {
      var view = views[id];
      if (view.track !== track) return;
      view.track = null;
      view.needsLoad = false;
      view.titleEl.textContent = 'No track loaded';
      view.artistEl.textContent = 'Open the library to load a track';
      view.panel.classList.remove('playing');
      view.needsRedraw = true;
    });
    idbDel('audio', String(track.id)).catch(function () {});
    delete cueMap[cueKey(track)];
    idbPut('state', 'cueMap', cueMap).catch(function () {});
    renderLibrary();
  }

  function bootPersistence() {
    idbOpen().then(function () {
      return idbGet('state', 'cueMap').then(function (m) {
        cueMap = m || {};
        // Built-in grooves may already be generated; restore their cues.
        tracks.forEach(function (t) {
          if (!t.imported) applySavedCues(t);
        });
        updateCueButtons(views.a);
        updateCueButtons(views.b);
      });
    }).then(function () {
      return idbAll('audio');
    }).then(function (recs) {
      recs.forEach(function (r) {
        var meta = r.value || {};
        if (!meta.blob) return;
        var track = {
          id: parseInt(r.key, 10),
          title: meta.title || 'Imported',
          artist: meta.artist || 'Imported',
          bpm: meta.bpm || 0,
          duration: meta.duration || 0,
          key: meta.key || null,
          energy: meta.energy,
          mixIn: meta.mixIn,
          mixOut: meta.mixOut,
          cues: (meta.cues || []).slice(0, 4),
          peaks: meta.peaks || null,
          bandsLow: meta.bandsLow || null,
          bandsMid: meta.bandsMid || null,
          bandsHigh: meta.bandsHigh || null,
          imported: true,
          buffer: null
        };
        while (track.cues.length < 4) track.cues.push(null);
        tracks.push(track);
      });
      nextId = tracks.reduce(function (m, t) { return Math.max(m, t.id); }, 0) + 1;
      renderLibrary();
      return idbAll('recs');
    }).then(function (recs) {
      recs.forEach(function (r) {
        var meta = r.value || {};
        if (!meta.blob) return;
        recordings.push({
          url: URL.createObjectURL(meta.blob),
          name: meta.name || String(r.key),
          size: meta.size || meta.blob.size,
          key: r.key
        });
      });
      renderRecordings();
      autoLoadStarters();
    }).catch(function () {
      /* persistence unavailable — session-only mode */
    });
  }

  // ------------------------------------------------------- sampler pads
  //
  //  Eight synthesized one-shots (air horn, siren, laser, riser, crash,
  //  stab, bell, blip) rendered offline on first open, fired over the
  //  master. Holding SIREN/RISER re-fires them at an eighth-note rate.

  var padBuffers = {};
  var padsLoading = false;
  var padRepeat = null;

  function setupPads() {
    var open = document.getElementById('padsBtn');
    var close = document.getElementById('padsClose');
    if (open) open.addEventListener('click', togglePads);
    if (close) close.addEventListener('click', togglePads);
  }

  function togglePads() {
    var tray = document.getElementById('padTray');
    if (!tray) return;
    tray.classList.toggle('hidden');
    if (!tray.classList.contains('hidden')) ensurePads();
  }

  function ensurePads() {
    var grid = document.getElementById('padGrid');
    if (!grid || !window.AuxRush.renderPads) return;
    if (Object.keys(padBuffers).length) return;
    if (padsLoading) return;
    padsLoading = true;
    grid.innerHTML = '<div class="lib-empty">Rendering pads…</div>';
    window.AuxRush.renderPads().then(function (map) {
      padBuffers = map;
      buildPadGrid();
    }).catch(function () {
      padsLoading = false;
      grid.innerHTML = '<div class="lib-empty">Could not render pads</div>';
    });
  }

  function buildPadGrid() {
    var grid = document.getElementById('padGrid');
    if (!grid) return;
    grid.innerHTML = '';
    var names = window.AuxRush.PAD_NAMES || [];
    names.forEach(function (kind, index) {
      var btn = document.createElement('button');
      btn.className = 'pad';
      btn.style.setProperty('--pad-hue', String((index * 45) % 360));
      btn.textContent = kind;
      btn.addEventListener('pointerdown', function (event) {
        event.preventDefault();
        padDown(kind, btn);
        try { btn.setPointerCapture(event.pointerId); } catch (err) { /* older browsers */ }
      });
      btn.addEventListener('pointerup', padUp);
      btn.addEventListener('pointercancel', padUp);
      grid.appendChild(btn);
    });
  }

  function padRepeatInterval() {
    // Eighth notes of the fastest playing deck; plain 300 ms when silent.
    var beat = 0;
    ['a', 'b'].forEach(function (id) {
      var deck = engine.decks ? engine.decks[id] : null;
      if (deck && deck.playing && deck.bpm) {
        beat = 60 / (deck.bpm * deck.rate);
      }
    });
    return beat > 0 ? (beat / 2) * 1000 : 300;
  }

  function padDown(kind, btn) {
    engine.ensureContext();
    var fire = function () { engine.playPad(padBuffers[kind]); };
    fire();
    btn.classList.add('hit');
    if (kind === 'SIREN' || kind === 'RISER') {
      padRepeat = setInterval(fire, padRepeatInterval());
    }
  }

  function padUp() {
    if (padRepeat) {
      clearInterval(padRepeat);
      padRepeat = null;
    }
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

      var del = document.createElement('button');
      del.className = 'btn tiny ghost';
      del.textContent = '✕';
      del.setAttribute('aria-label', 'Remove recording');
      del.addEventListener('click', function () {
        var idx = recordings.indexOf(rec);
        if (idx >= 0) recordings.splice(idx, 1);
        try { URL.revokeObjectURL(rec.url); } catch (err) { /* already gone */ }
        if (rec.key) idbDel('recs', rec.key).catch(function () {});
        renderRecordings();
      });
      row.appendChild(del);

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
    var meter = engine.masterMeter();
    var lit = Math.round(meter.level * meterSegments.length);
    for (var i = 0; i < meterSegments.length; i++) {
      meterSegments[i].classList.toggle('lit', i < lit);
    }

    var text = document.getElementById('masterLevelText');
    text.textContent = isFinite(meter.db) && meter.db > -60 ? Math.round(meter.db) + ' dB' : '-∞';

    updateBeatSync();

    var now = performance.now();
    if (now - lastAutoNext > 700) {
      lastAutoNext = now;
      updateAutoNext();
    }
  }

  /** Phase meter: are both decks' kicks landing together? */
  function updateBeatSync() {
    var el = document.getElementById('beatState');
    if (!el) return;

    var a = engine.decks ? engine.decks.a : null;
    var b = engine.decks ? engine.decks.b : null;
    if (!a || !b || !a.playing || !b.playing || a.slipHeld || b.slipHeld || !a.bpm || !b.bpm) {
      el.textContent = '—';
      el.className = 'beat-sync-state';
      return;
    }

    var phaseA = (a.position() / (60 / a.bpm)) % 1;
    var phaseB = (b.position() / (60 / b.bpm)) % 1;
    if (phaseA < 0) phaseA += 1;
    if (phaseB < 0) phaseB += 1;

    var diff = Math.abs(phaseA - phaseB);
    if (diff > 0.5) diff = 1 - diff;

    if (diff < 0.08) {
      el.textContent = 'IN PHASE';
      el.className = 'beat-sync-state locked';
    } else {
      // The deck that is further into its beat kicks first — nudge that name.
      el.textContent = phaseA > phaseB ? 'A AHEAD · nudge B' : 'B AHEAD · nudge A';
      el.className = 'beat-sync-state ' + (phaseA > phaseB ? 'a-ahead' : 'b-ahead');
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
          size: blob.size,
          key: 'rec ' + Date.now()
        });
        // Persist the recording so it survives a reload.
        idbPut('recs', recordings[0].key, {
          blob: blob,
          name: recordings[0].name,
          size: blob.size
        }).catch(function () {});
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
      if (!view.track || deck.trackId === view.track.id) return;
      if (view.track.buffer) {
        deck.loadTrack(view.track);
        applySettings(view, deck);
      } else if (view.track.imported && !view.track.loading) {
        // Persisted import: decode once in the background, then load.
        view.track.loading = true;
        ensureBuffer(view.track, function () {
          if (!view.track) return;
          view.track.loading = false;
          if (!deck.buffer || deck.trackId !== view.track.id) {
            deck.loadTrack(view.track);
            applySettings(view, deck);
          }
        });
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
    mix.from.stopNow();
    if (mix.from.loopBeats) {
      // Don't leave a stale loop armed on a deck the set has moved past.
      mix.from.setLoop(0);
      mix.fromView.loopChips.forEach(function (chip, index) {
        chip.classList.toggle('active', index === 0);
      });
    }
    mix.from.seek(0);
    mix.fromView.needsRedraw = true;
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
      mix.to.stopNow();
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
    // A slip-held deck is silent, so it must not count as the playing one.
    var aPlaying = a.playing && !a.slipHeld;
    var bPlaying = b.playing && !b.slipHeld;

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

    var lowBand = track.bandsLow || null;
    var midBand = track.bandsMid || null;
    var highBand = track.bandsHigh || null;

    // Serato-style colour bands stacked inside a mirrored envelope:
    // red bass in the core, green mids around it, blue treble at the edge.
    var C_LOW = '#e03131';
    var C_MID = '#3fbf5a';
    var C_HIGH = '#2f7ce0';

    for (var x = 0; x < cssW; x += 2) {
      var t = pos + (x - centerX) / pxPerSec;
      if (t < 0 || t > duration) continue;
      var index = Math.floor(t / duration * peaks.length);
      if (index < 0) index = 0;
      if (index >= peaks.length) index = peaks.length - 1;

      var value = peaks[index] || 0;
      var total = value * mid * 0.92;
      if (total < 0.6) continue;

      g.globalAlpha = x < centerX ? 1 : 0.42;

      var lo = lowBand ? (lowBand[index] || 0) : value * 0.7;
      var mi = midBand ? (midBand[index] || 0) : value * 0.22;
      var hi = highBand ? (highBand[index] || 0) : value * 0.12;
      var sum = lo + mi + hi;
      var scale = sum > 1e-4 ? total / sum : 0;

      var hLow = lo * scale;
      var hMid = mi * scale;
      var hHigh = hi * scale;

      g.fillStyle = C_LOW;
      g.fillRect(x, mid - hLow, 1.6, hLow * 2);

      g.fillStyle = C_MID;
      g.fillRect(x, mid - hLow - hMid, 1.6, hMid);
      g.fillRect(x, mid + hLow, 1.6, hMid);

      g.fillStyle = C_HIGH;
      g.fillRect(x, mid - hLow - hMid - hHigh, 1.6, hHigh);
      g.fillRect(x, mid + hLow + hMid, 1.6, hHigh);
    }
    g.globalAlpha = 1;

    if (track.bpm > 0) {
      var beat = 60 / track.bpm;
      var firstBeat = Math.ceil((pos - 4) / beat);
      for (var i = 0; i < 400; i++) {
        var beatIndex = firstBeat + i;
        var beatX = centerX + (beatIndex * beat - pos) * pxPerSec;
        if (beatX > cssW) break;
        if (beatX >= 0) {
          var isBar = beatIndex % 4 === 0;
          g.fillStyle = 'rgba(255,255,255,' + (isBar ? 0.22 : 0.07) + ')';
          g.fillRect(beatX, 0, isBar ? 1.4 : 1, cssH);
          if (isBar) {
            g.fillStyle = 'rgba(255,255,255,0.5)';
            g.font = 'bold 8px -apple-system, system-ui, sans-serif';
            g.fillText(String(Math.floor(beatIndex / 4) + 1), beatX + 2, 9);
          }
        }
      }
    }

    // Cue flags, coloured like the hot-cue pads.
    var CUE_COLORS = ['#2f9bff', '#d9a441', '#3fbf5a', '#e03131'];
    var cues = track.cues || [];
    for (var c = 0; c < cues.length; c++) {
      if (cues[c] == null) continue;
      var cueX = centerX + (cues[c] - pos) * pxPerSec;
      if (cueX < 0 || cueX > cssW) continue;
      g.fillStyle = CUE_COLORS[c % CUE_COLORS.length];
      g.fillRect(cueX - 0.75, 0, 1.5, cssH);
      g.fillRect(cueX - 4, 0, 8, 7);
    }

    g.fillStyle = '#ffffff';
    g.fillRect(centerX - 1, 0, 2, cssH);
  }

  function updateDeckView(view, shouldDraw) {
    var deck = engine.decks ? engine.decks[view.id] : null;
    var track = view.track;
    var position = view.dragging ? view.dragPos : (deck ? deck.position() : 0);
    var playing = deck ? (deck.playing && !deck.slipHeld) : false;
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

    // Channel meters live in the centre strip; resolve them once per view.
    if (!view.stripMeter) {
      view.stripMeter = document.getElementById('meter' + view.id.toUpperCase());
    }
    var level = deck ? deck.level() : 0;
    if (view.stripMeter) {
      view.stripMeter.style.width = Math.round(level * 100) + '%';
    }

    // SYNC stays lit while this deck is riding a matched tempo.
    view.syncBtn.classList.toggle('on', !!deck && Math.abs(deck.rate - 1) > 0.001);

    if (playing && track && bpm > 0) {
      var beatSeconds = 60 / Math.max(bpm, 1);
      var revolutions = position / (beatSeconds * 4);
      var degrees = (revolutions % 1) * 360;
      view.ring.style.transform = 'rotate(' + degrees.toFixed(1) + 'deg)';
    }

    if (shouldDraw) {
      var posKey = Math.round(position * 100);
      // Paused, unchanged decks don't need a repaint; state changes set
      // needsRedraw (load, loop, cue, seek).
      if (playing || view.dragging || view.needsRedraw || view.lastDrawnKey !== posKey) {
        drawWave(view, deck, position);
        view.lastDrawnKey = posKey;
        view.needsRedraw = false;
      }
    }
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
    setupPads();
    setupLibrary();
    renderLibrary();
    renderRecordings();
    loadBuiltInTracks();
    bootPersistence();

    requestAnimationFrame(frame);
  }

  // Debug surface for the self-test page: lets the mixer be inspected and
  // driven from outside the closure.

  window.AuxRushApp = {
    engine: engine,
    tracks: function () { return tracks; },
    videos: function () { return videos; },
    youtubeId: youtubeId,
    clearVideos: function () { videos.length = 0; saveVideos(); renderLibrary(); },
    pickNext: function () { return pickNextTrack(null, null); },
    pads: function () { return Object.keys(padBuffers); },
    storage: {
      put: idbPut,
      get: idbGet,
      del: idbDel,
      all: idbAll
    },
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
