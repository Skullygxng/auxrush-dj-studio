//
//  engine.js — AuxRush DJ Studio audio core
//
//  Web Audio implementation of the two-deck mixer: per-deck EQ, sweep filter,
//  channel gain, crossfader, master bus, metering, loops, tempo and set
//  recording. Also contains the BPM/waveform analyser and the built-in track
//  synth, so the app ships with mixable music and needs no network.
//

(function () {
  'use strict';

  var PEAK_COUNT = 1400;

  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  // ---------------------------------------------------------------- analysis

  function analyzeBuffer(buffer) {
    var sr = buffer.sampleRate;
    var length = buffer.length;
    var ch0 = buffer.getChannelData(0);
    var ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;

    var winFrames = Math.max(1, Math.floor(sr / 200));
    var winCount = Math.max(1, Math.floor(length / winFrames));
    var energy = new Float32Array(winCount);
    var peaks = new Float32Array(PEAK_COUNT);
    // Band envelopes per peak bucket (bass / mid / treble) for the
    // frequency-coloured waveform every real DJ app draws.
    var bandsLow = new Float32Array(PEAK_COUNT);
    var bandsMid = new Float32Array(PEAK_COUNT);
    var bandsHigh = new Float32Array(PEAK_COUNT);
    // Tone per peak bucket: low-frequency share, for coloured waveforms.
    var tone = new Float32Array(PEAK_COUNT);
    var lowSum = new Float32Array(PEAK_COUNT);
    var totSum = new Float32Array(PEAK_COUNT);
    var lp = 0;
    var midLp = 0;
    var aLow = 1 - Math.exp(-2 * Math.PI * 220 / sr);
    var aMid = 1 - Math.exp(-2 * Math.PI * 3000 / sr);
    var i;

    for (i = 0; i < length; i++) {
      var v = ch1
        ? (Math.abs(ch0[i]) + Math.abs(ch1[i])) * 0.5
        : Math.abs(ch0[i]);

      lp += (v - lp) * aLow;
      var above = Math.max(0, v - lp);
      midLp += (above - midLp) * aMid;
      var highPart = Math.max(0, above - midLp);

      var pi = Math.min(PEAK_COUNT - 1, Math.floor(i * PEAK_COUNT / length));
      if (v > peaks[pi]) peaks[pi] = v;
      if (lp > bandsLow[pi]) bandsLow[pi] = lp;
      if (midLp > bandsMid[pi]) bandsMid[pi] = midLp;
      if (highPart > bandsHigh[pi]) bandsHigh[pi] = highPart;
      lowSum[pi] += lp * lp;
      totSum[pi] += v * v;

      var wi = Math.min(winCount - 1, Math.floor(i / winFrames));
      if (v > energy[wi]) energy[wi] = v;
    }

    var peakMax = 0;
    for (i = 0; i < PEAK_COUNT; i++) {
      if (peaks[i] > peakMax) peakMax = peaks[i];
    }
    if (peakMax > 0.001) {
      var scale = 0.95 / peakMax;
      for (i = 0; i < PEAK_COUNT; i++) {
        peaks[i] = peaks[i] * scale;
        bandsLow[i] = clamp(bandsLow[i] * scale, 0, 1);
        bandsMid[i] = clamp(bandsMid[i] * scale, 0, 1);
        bandsHigh[i] = clamp(bandsHigh[i] * scale, 0, 1);
      }
    }
    for (i = 0; i < PEAK_COUNT; i++) {
      tone[i] = totSum[i] > 1e-9 ? clamp(lowSum[i] / totSum[i], 0, 1) : 0.5;
    }

    var bpm = 0;
    if (winCount > 200) {
      var onset = new Float32Array(winCount);
      for (i = 1; i < winCount; i++) {
        var d = energy[i] - energy[i - 1];
        onset[i] = d > 0 ? d : 0;
      }

      var minLag = Math.max(8, Math.floor(200 * 60 / 180));
      var maxLag = Math.min(winCount - 16, Math.floor(200 * 60 / 70));

      if (maxLag > minLag) {
        var bestLag = 0;
        var bestScore = 0;
        for (var lag = minLag; lag <= maxLag; lag++) {
          var score = 0;
          for (var k = lag; k < winCount; k++) {
            score += onset[k] * onset[k - lag];
          }
          score /= (winCount - lag);
          if (score > bestScore) {
            bestScore = score;
            bestLag = lag;
          }
        }
        if (bestLag > 0) {
          bpm = 200 * 60 / bestLag;
          while (bpm > 0 && bpm < 85) bpm = bpm * 2;
          while (bpm > 170) bpm = bpm / 2;
          bpm = Math.round(bpm * 10) / 10;
        }
      }
    }

    var chroma = chromaOf(buffer);
    var key = estimateKey(chroma);
    var env = energyEnvelope(buffer);
    var structure = structureOf(buffer, env, bpm);

    return {
      bpm: bpm,
      peaks: peaks,
      tone: tone,
      bandsLow: bandsLow,
      bandsMid: bandsMid,
      bandsHigh: bandsHigh,
      duration: length / sr,
      key: key,
      energy: structure.energy,
      mixIn: structure.mixIn,
      mixOut: structure.mixOut
    };
  }

  // ------------------------------------------------------ key + energy
  //
  //  The mixer's brain: a chroma profile per track gives its musical key on
  //  the Camelot wheel (harmonic mixing), and an energy envelope gives the
  //  body of the track — where it gets going and where its outro starts, which
  //  is where a DJ mixes out.

  var MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  var MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  var CAMELOT_MAJOR = ['8B', '3B', '10B', '5B', '12B', '7B', '2B', '9B', '4B', '11B', '6B', '1B'];
  var CAMELOT_MINOR = ['5A', '12A', '7A', '2A', '9A', '4A', '11A', '6A', '1A', '8A', '3A', '10A'];

  /** In-place radix-2 FFT. */
  function fft(re, im) {
    var n = re.length;
    var i, j, len, k, bit;
    for (i = 1, j = 0; i < n; i++) {
      bit = n >> 1;
      while (j & bit) {
        j ^= bit;
        bit >>= 1;
      }
      j ^= bit;
      if (i < j) {
        var tr = re[i]; re[i] = re[j]; re[j] = tr;
        var ti = im[i]; im[i] = im[j]; im[j] = ti;
      }
    }
    for (len = 2; len <= n; len <<= 1) {
      var ang = -2 * Math.PI / len;
      var wr = Math.cos(ang);
      var wi = Math.sin(ang);
      for (i = 0; i < n; i += len) {
        var cr = 1, ci = 0;
        for (k = 0; k < len / 2; k++) {
          var ur = re[i + k], ui = im[i + k];
          var vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
          var vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
          re[i + k] = ur + vr;
          im[i + k] = ui + vi;
          re[i + k + len / 2] = ur - vr;
          im[i + k + len / 2] = ui - vi;
          var ncr = cr * wr - ci * wi;
          var nci = cr * wi + ci * wr;
          cr = ncr;
          ci = nci;
        }
      }
    }
  }

  /** 12-bin pitch-class profile of the track, normalised to 0..1. */
  function chromaOf(buffer) {
    var chroma = new Float64Array(12);
    var size = 2048;
    var sr = buffer.sampleRate;
    var hop = Math.max(size, Math.floor(sr * 0.05));
    var ch0 = buffer.getChannelData(0);
    var ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;
    var re = new Float64Array(size);
    var im = new Float64Array(size);
    var total = Math.floor(buffer.length / hop);
    var step = Math.max(1, Math.ceil(total / 600));
    var binHz = sr / size;
    // The kick's fundamental sits right on A1 (55 Hz) and would pin every
    // track to A minor, so the analysis starts above it and only keeps tonal
    // peaks rather than raw broadband energy.
    var loBin = Math.max(1, Math.ceil(70 / binHz));
    var hiBin = Math.min(size / 2 - 2, Math.floor(1400 / binHz));
    var band = new Float64Array(hiBin - loBin + 1);

    for (var w = 0; w < total; w += step) {
      var start = w * hop;
      if (start + size > buffer.length) break;
      for (var i = 0; i < size; i++) {
        var s = ch0[start + i] + (ch1 ? ch1[start + i] : 0);
        if (ch1) s = s * 0.5;
        re[i] = s * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (size - 1)));
        im[i] = 0;
      }
      fft(re, im);

      var frameMax = 0;
      var b;
      for (b = loBin; b <= hiBin; b++) {
        var m = Math.sqrt(re[b] * re[b] + im[b] * im[b]);
        band[b - loBin] = m;
        if (m > frameMax) frameMax = m;
      }
      if (frameMax <= 0) continue;

      for (b = 1; b < band.length - 1; b++) {
        var mag = band[b];
        if (mag < frameMax * 0.08) continue;
        if (mag <= band[b - 1] || mag < band[b + 1]) continue;
        var freq = (loBin + b) * binHz;
        var midi = 69 + 12 * Math.log(freq / 440) / Math.LN2;
        var pc = Math.round(midi) % 12;
        if (pc < 0) pc += 12;
        chroma[pc] += mag / frameMax;
      }
    }

    var max = 0;
    for (var c = 0; c < 12; c++) if (chroma[c] > max) max = chroma[c];
    if (max > 0) {
      for (c = 0; c < 12; c++) chroma[c] = chroma[c] / max;
    }
    return chroma;
  }

  /** Correlates the chroma against major/minor profiles → Camelot code. */
  function estimateKey(chroma) {
    var best = { score: -1, tonic: 0, minor: false };
    for (var tonic = 0; tonic < 12; tonic++) {
      var major = 0;
      var minor = 0;
      for (var i = 0; i < 12; i++) {
        var v = chroma[(tonic + i) % 12];
        major += v * MAJOR_PROFILE[i];
        minor += v * MINOR_PROFILE[i];
      }
      if (major > best.score) best = { score: major, tonic: tonic, minor: false };
      if (minor > best.score) best = { score: minor, tonic: tonic, minor: true };
    }
    return {
      camelot: best.minor ? CAMELOT_MINOR[best.tonic] : CAMELOT_MAJOR[best.tonic],
      tonic: best.tonic,
      minor: best.minor
    };
  }

  /** Loudness per quarter second, normalised to 0..1. */
  function energyEnvelope(buffer) {
    var block = Math.max(1, Math.floor(buffer.sampleRate * 0.25));
    var count = Math.max(1, Math.floor(buffer.length / block));
    var env = new Float32Array(count);
    var ch0 = buffer.getChannelData(0);
    var ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;

    for (var i = 0; i < count; i++) {
      var start = i * block;
      var end = Math.min(buffer.length, start + block);
      var sum = 0;
      for (var j = start; j < end; j++) {
        var v = ch0[j] + (ch1 ? ch1[j] : 0);
        if (ch1) v = v * 0.5;
        sum += v * v;
      }
      env[i] = Math.sqrt(sum / Math.max(1, end - start));
    }

    var max = 0;
    for (i = 0; i < count; i++) if (env[i] > max) max = env[i];
    if (max > 0) {
      for (i = 0; i < count; i++) env[i] = env[i] / max;
    }
    return env;
  }

  /** Where a track gets going, and where its outro begins (both bar aligned). */
  function structureOf(buffer, env, bpm) {
    var count = env.length;
    var secPerBlock = buffer.duration / Math.max(1, count);
    var mean = 0;
    var i;
    for (i = 0; i < count; i++) mean += env[i];
    mean /= count;

    var body = 0;
    for (i = 0; i < count - 4; i++) {
      if (env[i] > mean * 0.95 && env[i + 1] > mean * 0.9 && env[i + 2] > mean * 0.9) {
        body = i;
        break;
      }
    }

    var outro = count - 1;
    for (i = count - 1; i > 4; i--) {
      if (env[i] > mean * 0.85 && env[i - 1] > mean * 0.8) {
        outro = i;
        break;
      }
    }

    var barSeconds = bpm > 0 ? (60 / bpm) * 4 : 0;
    function toBar(t, up) {
      if (barSeconds <= 0) return t;
      var bars = t / barSeconds;
      bars = up ? Math.ceil(bars) : Math.floor(bars);
      return Math.max(0, Math.min(buffer.duration, bars * barSeconds));
    }

    return {
      energy: mean,
      mixIn: toBar(body * secPerBlock, true),
      mixOut: toBar(outro * secPerBlock, false)
    };
  }

  // ------------------------------------------------------------------- deck

  /** Synthesized plate-ish impulse for the reverb send. */
  function makeImpulse(ctx, seconds, decay) {
    var len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    var buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (var c = 0; c < 2; c++) {
      var d = buf.getChannelData(c);
      for (var i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  function Deck(ctx, engine, id) {
    this.ctx = ctx;
    this.engine = engine;
    this.id = id;

    this.buffer = null;
    this.trackId = null;
    this.duration = 0;
    this.bpm = 0;

    this.rate = 1;
    this.bend = 0;
    this.pausedPos = 0;

    this.playing = false;
    this.source = null;
    this.startedAt = 0;
    this.startedOffset = 0;

    this.loopBeats = 0;
    this.loopStart = 0;
    this.loopEnd = 0;

    this.channelVolume = 1;
    this.crossGain = 0.707;

    // Slip (flux): while held, the deck keeps "playing" underneath at zero
    // gain so it can re-enter exactly where the record would have been.
    this.slip = false;
    this.slipHeld = false;
    this.slipStartCtx = 0;
    this.slipStartPos = 0;

    // Scratch: short grains played from the buffer (and its reverse) while a
    // finger drags the platter hub.
    this.scratchActive = false;
    this.scratchWasPlaying = false;
    this.scratchPos = 0;
    this.scratchGrain = null;
    this.revBuffer = null;

    this.eqLow = ctx.createBiquadFilter();
    this.eqLow.type = 'lowshelf';
    this.eqLow.frequency.value = 120;
    this.eqLow.gain.value = 0;

    this.eqMid = ctx.createBiquadFilter();
    this.eqMid.type = 'peaking';
    this.eqMid.frequency.value = 1000;
    this.eqMid.Q.value = 1.2;
    this.eqMid.gain.value = 0;

    this.eqHigh = ctx.createBiquadFilter();
    this.eqHigh.type = 'highshelf';
    this.eqHigh.frequency.value = 7000;
    this.eqHigh.gain.value = 0;

    this.filterNode = ctx.createBiquadFilter();
    this.filterNode.type = 'allpass';
    this.filterNode.frequency.value = 1000;

    this.volumeGain = ctx.createGain();
    this.volumeGain.gain.value = this.channelVolume * this.crossGain;

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.levelData = new Float32Array(this.analyser.fftSize);

    this.input = this.eqLow;
    this.eqLow.connect(this.eqMid);
    this.eqMid.connect(this.eqHigh);
    this.eqHigh.connect(this.filterNode);
    this.filterNode.connect(this.volumeGain);
    this.volumeGain.connect(this.analyser);
    this.analyser.connect(engine.masterGain);

    // FX sends: parallel taps off the EQ output into the channel gain, so FX
    // stay post-EQ but still respect channel volume and the crossfader.
    this.fxIn = ctx.createGain();
    this.eqHigh.connect(this.fxIn);

    this.echo = ctx.createDelay(2);
    this.echo.delayTime.value = 0.25;
    this.echoFb = ctx.createGain();
    this.echoFb.gain.value = 0.45;
    this.echoWet = ctx.createGain();
    this.echoWet.gain.value = 0;
    this.fxIn.connect(this.echo);
    this.echo.connect(this.echoFb);
    this.echoFb.connect(this.echo);
    this.echo.connect(this.echoWet);
    this.echoWet.connect(this.volumeGain);

    this.verb = ctx.createConvolver();
    this.verb.buffer = makeImpulse(ctx, 2.2, 2.5);
    this.verbWet = ctx.createGain();
    this.verbWet.gain.value = 0;
    this.fxIn.connect(this.verb);
    this.verb.connect(this.verbWet);
    this.verbWet.connect(this.volumeGain);

    this.fluxLfo = null;
    this.fx = { echo: false, verb: false, flux: false };
  }

  Deck.prototype.effectiveRate = function () {
    return this.rate * (1 + this.bend / 100);
  };

  Deck.prototype.applyVolume = function () {
    var level = this.slipHeld ? 0 : clamp(this.channelVolume * this.crossGain, 0, 2);
    this.volumeGain.gain.value = level;
  };

  Deck.prototype.setVolume = function (v) {
    this.channelVolume = clamp(v, 0, 1.2);
    this.applyVolume();
  };

  Deck.prototype.setEQ = function (lowDb, midDb, highDb) {
    // DJ-mixer range: the low band can be cut into a near-kill so a manual
    // bass swap is possible; gains above centre are gentler.
    this.eqLow.gain.value = clamp(lowDb, -30, 12);
    this.eqMid.gain.value = clamp(midDb, -30, 12);
    this.eqHigh.gain.value = clamp(highDb, -30, 12);
  };

  Deck.prototype.setFilter = function (v) {
    var x = clamp(v, -1, 1);
    var node = this.filterNode;
    if (x < -0.02) {
      node.type = 'lowpass';
      node.frequency.value = clamp(20000 * Math.pow(200 / 20000, -x), 40, 20000);
      node.Q.value = 0.9;
    } else if (x > 0.02) {
      node.type = 'highpass';
      node.frequency.value = clamp(20 * Math.pow(4000 / 20, x), 20, 8000);
      node.Q.value = 0.9;
    } else {
      node.type = 'allpass';
    }
  };

  /** FX pads: tempo-synced echo, plate reverb, and a filter LFO ("flux"). */
  Deck.prototype.setFX = function (name, on) {
    var t = this.ctx.currentTime;
    if (name === 'echo') {
      this.fx.echo = !!on;
      this.echoWet.gain.setTargetAtTime(on ? 0.5 : 0, t, 0.05);
    } else if (name === 'verb') {
      this.fx.verb = !!on;
      this.verbWet.gain.setTargetAtTime(on ? 0.4 : 0, t, 0.08);
    } else if (name === 'flux') {
      this.fx.flux = !!on;
      if (on && !this.fluxLfo) {
        var lfo = this.ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = 0.3;
        var depth = this.ctx.createGain();
        depth.gain.value = 1400;
        lfo.connect(depth);
        depth.connect(this.filterNode.frequency);
        lfo.start();
        this.fluxLfo = lfo;
      } else if (!on && this.fluxLfo) {
        try { this.fluxLfo.stop(); } catch (err) { /* already stopped */ }
        this.fluxLfo = null;
      }
    }
  };

  Deck.prototype.clearFX = function () {
    this.setFX('echo', false);
    this.setFX('verb', false);
    this.setFX('flux', false);
  };

  /** 1/8-note echo time from the deck's own BPM. */
  Deck.prototype.syncEchoToTempo = function () {
    if (this.bpm > 0) this.echo.delayTime.value = Math.min(1.9, 30 / this.bpm);
  };

  Deck.prototype.loadTrack = function (track) {
    this.scratchEnd();
    this.scratchActive = false;
    this.scratchWasPlaying = false;
    this.slipHeld = false;
    this.revBuffer = null;
    this.stopSource();
    this.playing = false;
    this.clearFX();
    this.buffer = track.buffer;
    this.trackId = track.id;
    this.duration = track.duration || track.buffer.duration;
    this.bpm = track.bpm || 0;
    this.syncEchoToTempo();
    this.bend = 0;
    this.pausedPos = 0;
    this.loopBeats = 0;
    this.loopStart = 0;
    this.loopEnd = 0;
  };

  Deck.prototype.position = function () {
    if (!this.playing || !this.source) return this.pausedPos;
    var elapsed = this.ctx.currentTime - this.startedAt;
    // A source can be scheduled slightly in the future (sample-accurate cue in).
    if (elapsed < 0) return this.startedOffset;
    var pos = this.startedOffset + elapsed * this.effectiveRate();
    if (this.loopBeats > 0 && this.loopEnd > this.loopStart && pos >= this.loopEnd) {
      pos = this.loopStart + ((pos - this.loopStart) % (this.loopEnd - this.loopStart));
    }
    if (pos > this.duration) pos = this.duration;
    if (pos < 0) pos = 0;
    return pos;
  };

  Deck.prototype.stopSource = function () {
    var src = this.source;
    this.source = null;
    if (!src) return;
    try {
      src.onended = null;
      src.stop();
    } catch (err) {
      /* already stopped */
    }
  };

  /**
   * Starts the buffer at `offset` seconds. `when` delays the start by that many
   * seconds on the audio clock, which is what lets a mix drop in exactly on a
   * downbeat instead of whenever a timer happened to fire.
   */
  Deck.prototype.startAt = function (offset, when) {
    if (!this.buffer) return;
    var self = this;
    this.stopSource();

    var src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.playbackRate.value = this.effectiveRate();
    src.connect(this.input);

    var off = clamp(offset, 0, Math.max(0, this.duration - 0.02));

    if (this.loopBeats > 0 && this.loopEnd > this.loopStart) {
      src.loop = true;
      src.loopStart = this.loopStart;
      src.loopEnd = Math.min(this.loopEnd, this.duration);
      if (off < this.loopStart || off >= src.loopEnd) off = this.loopStart;
    }

    src.onended = function () {
      if (self.source !== src) return;
      if (self.loopBeats > 0) return;
      self.playing = false;
      self.source = null;
      self.pausedPos = 0;
      if (typeof self.onEnded === 'function') self.onEnded();
    };

    var delay = Math.max(0, when || 0);
    var startTime = this.ctx.currentTime + delay;
    src.start(startTime, off);
    this.source = src;
    this.startedAt = startTime;
    this.startedOffset = off;
    this.pausedPos = off;
    this.playing = true;
  };

  Deck.prototype.playAt = function (offset, delay) {
    if (!this.buffer) return;
    this.startAt(offset, delay);
  };

  // ---------------------------------------------------------------- scratch

  /** Reversed copy of the buffer, built once, for backward scratch grains. */
  Deck.prototype.buildReverse = function () {
    if (this.revBuffer || !this.buffer) return;
    var b = this.buffer;
    var rev = this.ctx.createBuffer(b.numberOfChannels, b.length, b.sampleRate);
    for (var c = 0; c < b.numberOfChannels; c++) {
      var src = b.getChannelData(c);
      var dst = rev.getChannelData(c);
      for (var i = 0, n = b.length; i < n; i++) dst[i] = src[n - 1 - i];
    }
    this.revBuffer = rev;
  };

  /** Grabs the deck for scratching: main audio stops, grains take over. */
  Deck.prototype.scratchStart = function () {
    if (!this.buffer) return false;
    this.buildReverse();

    this.scratchWasPlaying = this.playing && !this.slipHeld;
    this.scratchPos = this.slipHeld ? this.slipPosition() : this.position();
    this.scratchActive = true;

    if (this.playing && !this.slipHeld) {
      this.stopSource();
      this.playing = false;
    }
    return true;
  };

  /**
   * Plays one short grain at the scratch position, forward or backward.
   * `handSpeed` (1 = a normal drag) sets the grain's playback rate, which is
   * what gives faster scratches their pitch lift.
   */
  Deck.prototype.scratchMove = function (deltaSeconds, handSpeed) {
    if (!this.scratchActive || !this.buffer) return;

    this.scratchPos = clamp(this.scratchPos + deltaSeconds, 0, Math.max(0, this.duration - 0.05));

    var forward = deltaSeconds >= 0;
    var rate = clamp(handSpeed || 1, 0.7, 2.6);
    var grain = 0.075;

    var src = this.ctx.createBufferSource();
    src.buffer = forward ? this.buffer : (this.revBuffer || this.buffer);
    src.playbackRate.value = rate;
    src.connect(this.volumeGain);

    var offset = forward
      ? this.scratchPos
      : clamp(this.duration - this.scratchPos - grain * rate, 0, Math.max(0, this.duration - grain * rate));

    var now = this.ctx.currentTime;
    src.start(now, offset, grain * rate);

    if (this.scratchGrain) {
      try { this.scratchGrain.stop(); } catch (err) { /* already finished */ }
    }
    this.scratchGrain = src;
  };

  Deck.prototype.scratchEnd = function () {
    if (!this.scratchActive) return;
    this.scratchActive = false;

    if (this.scratchGrain) {
      try { this.scratchGrain.stop(); } catch (err) { /* already finished */ }
      this.scratchGrain = null;
    }

    var target = this.scratchPos;

    if (this.slip && this.scratchWasPlaying) {
      // Slip: the record kept moving underneath, so resume where it would be.
      target = this.slipHeld ? this.slipPosition() : this.scratchPos;
    }

    this.pausedPos = target;

    if (this.scratchWasPlaying) {
      this.slipHeld = false;
      this.playing = false;
      this.startAt(target);
      this.applyVolume();
    }
  };

  Deck.prototype.play = function () {
    if (!this.buffer) return;

    // Coming back from a slip hold: the source never stopped, so just unmute
    // and the record carries on from where it would have been.
    if (this.slipHeld) {
      this.slipHeld = false;
      this.applyVolume();
      return;
    }

    if (this.playing) return;
    this.startAt(clamp(this.pausedPos, 0, Math.max(0, this.duration - 0.02)));
  };

  Deck.prototype.pause = function () {
    if (!this.playing) return;

    if (this.slip && this.buffer && !this.slipHeld) {
      // Slip: keep the clock running silently instead of stopping the source.
      this.slipHeld = true;
      this.slipStartCtx = this.ctx.currentTime;
      this.slipStartPos = this.position();
      this.applyVolume();
      return;
    }

    var pos = this.position();
    this.stopSource();
    this.playing = false;
    this.pausedPos = pos;
  };

  /** Where the record would be right now if slip hadn't muted it. */
  Deck.prototype.slipPosition = function () {
    if (!this.slipHeld) return this.position();
    var elapsed = this.ctx.currentTime - this.slipStartCtx;
    return clamp(this.slipStartPos + elapsed * this.rate, 0, this.duration);
  };

  Deck.prototype.setSlip = function (on) {
    this.slip = !!on;
    // Turning slip off while held turns it into a normal pause.
    if (!this.slip && this.slipHeld) {
      var pos = this.slipPosition();
      this.slipHeld = false;
      this.stopSource();
      this.playing = false;
      this.pausedPos = pos;
      this.applyVolume();
    }
  };

  Deck.prototype.toggle = function () {
    if (this.playing) this.pause();
    else this.play();
  };

  /** Stops completely, whatever slip is doing. Used when the set moves on. */
  Deck.prototype.stopNow = function () {
    this.slipHeld = false;
    this.stopSource();
    this.playing = false;
    this.applyVolume();
  };

  Deck.prototype.seek = function (t) {
    var target = clamp(t, 0, Math.max(0, this.duration - 0.02));
    this.pausedPos = target;
    if (this.playing) this.startAt(target);
  };

  Deck.prototype.setRate = function (rate) {
    var safe = clamp(rate, 0.5, 2);
    var pos = this.position();
    this.rate = safe;
    this.syncEchoToTempo();
    this.pausedPos = pos;
    if (this.playing && this.source) {
      this.source.playbackRate.value = this.effectiveRate();
      this.startedAt = this.ctx.currentTime;
      this.startedOffset = pos;
    }
  };

  /**
   * Temporary pitch bend for jog-wheel nudging: the deck rides faster or
   * slower while the finger is down, then snaps back to its base tempo.
   */
  Deck.prototype.setBend = function (percent) {
    this.bend = clamp(percent, -30, 30);
    if (this.playing && this.source) {
      var pos = this.position();
      this.source.playbackRate.value = this.effectiveRate();
      this.startedAt = this.ctx.currentTime;
      this.startedOffset = pos;
    }
  };

  Deck.prototype.setLoop = function (beats) {
    var pos = this.position();
    if (!beats || !this.bpm) {
      this.loopBeats = 0;
      this.loopStart = 0;
      this.loopEnd = 0;
      if (this.playing) this.startAt(pos);
      return;
    }
    var beat = 60 / this.bpm;
    var start = Math.floor(pos / beat) * beat;
    this.loopBeats = beats;
    this.loopStart = start;
    this.loopEnd = start + beat * beats;
    if (this.playing) this.startAt(start);
    else this.pausedPos = start;
  };

  Deck.prototype.effectiveBPM = function () {
    return this.bpm * this.rate;
  };

  Deck.prototype.syncTo = function (other, alignBeats) {
    if (!this.bpm || !other || !other.bpm) return;
    var target = other.bpm * other.rate;
    this.setRate(clamp(target / this.bpm, 0.5, 2));

    // Tempo alone is only half of sync: when both decks are running, line the
    // beats up so the kicks land together. Both timelines now advance at the
    // same real-time speed, so comparing beat phases in each track's own
    // timeline is valid.
    if (!alignBeats || !this.playing || !other.playing) return;

    var myBeat = 60 / this.bpm;
    var otherBeat = 60 / other.bpm;
    var phaseMe = (this.position() / myBeat) % 1;
    var phaseOther = (other.position() / otherBeat) % 1;
    var delta = (phaseOther - phaseMe) * myBeat;
    if (delta > myBeat / 2) delta -= myBeat;
    if (delta < -myBeat / 2) delta += myBeat;
    // Only re-schedule for meaningful drift; a seek restarts the buffer source.
    if (Math.abs(delta) > myBeat * 0.06) {
      this.seek(this.position() + delta);
    }
  };

  Deck.prototype.level = function () {
    this.analyser.getFloatTimeDomainData(this.levelData);
    var peak = 0;
    var d = this.levelData;
    for (var i = 0; i < d.length; i++) {
      var v = Math.abs(d[i]);
      if (v > peak) peak = v;
    }
    return clamp((20 * Math.log10(Math.max(peak, 1e-6)) + 60) / 60, 0, 1);
  };

  // ----------------------------------------------------------------- engine

  function Engine() {
    this.ctx = null;
    this.decks = null;
    this.masterGain = null;
    this.masterAnalyser = null;
    this.masterData = null;
    this.recordDest = null;
    this.recorder = null;
    this.recordChunks = null;
    this.recordType = 'audio/webm';
    this.masterVolume = 0.85;
    this.crossfader = 0.5;
  }

  Engine.prototype.ensureContext = function () {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      return this.ctx;
    }

    var Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) {
      throw new Error('Web Audio is not available in this browser');
    }

    var ctx = new Ctor();
    this.ctx = ctx;

    var master = ctx.createGain();
    master.gain.value = this.masterVolume;

    var analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;

    master.connect(analyser);
    analyser.connect(ctx.destination);

    this.masterGain = master;
    this.masterAnalyser = analyser;
    this.masterData = new Float32Array(analyser.fftSize);

    if (typeof ctx.createMediaStreamDestination === 'function') {
      this.recordDest = ctx.createMediaStreamDestination();
      master.connect(this.recordDest);
    }

    this.decks = {
      a: new Deck(ctx, this, 'a'),
      b: new Deck(ctx, this, 'b')
    };
    this.applyCrossfader();

    // Sampler bus: pads fire over the master, always audible.
    this.padBus = ctx.createGain();
    this.padBus.gain.value = 0.9;
    this.padBus.connect(master);

    return ctx;
  };

  Engine.prototype.playPad = function (buffer) {
    if (!buffer || !this.ctx) return;
    var src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.padBus);
    src.start();
  };

  Engine.prototype.deck = function (id) {
    this.ensureContext();
    return this.decks[id];
  };

  Engine.prototype.applyCrossfader = function () {
    if (!this.decks) return;
    var x = this.crossfader * Math.PI / 2;
    this.decks.a.crossGain = Math.cos(x);
    this.decks.b.crossGain = Math.sin(x);
    this.decks.a.applyVolume();
    this.decks.b.applyVolume();
  };

  Engine.prototype.setCrossfader = function (v) {
    this.crossfader = clamp(v, 0, 1);
    this.applyCrossfader();
  };

  Engine.prototype.setMasterVolume = function (v) {
    this.masterVolume = clamp(v, 0, 1);
    if (this.masterGain) this.masterGain.gain.value = this.masterVolume;
  };

  Engine.prototype.masterLevel = function () {
    if (!this.masterAnalyser) return 0;
    this.masterAnalyser.getFloatTimeDomainData(this.masterData);
    var peak = 0;
    var d = this.masterData;
    for (var i = 0; i < d.length; i++) {
      var v = Math.abs(d[i]);
      if (v > peak) peak = v;
    }
    return clamp((20 * Math.log10(Math.max(peak, 1e-6)) + 60) / 60, 0, 1);
  };

  Engine.prototype.masterPeakDb = function () {
    if (!this.masterAnalyser) return -Infinity;
    this.masterAnalyser.getFloatTimeDomainData(this.masterData);
    var peak = 0;
    var d = this.masterData;
    for (var i = 0; i < d.length; i++) {
      var v = Math.abs(d[i]);
      if (v > peak) peak = v;
    }
    return 20 * Math.log10(Math.max(peak, 1e-6));
  };

  /** Level + peak dB in a single analyser read, for the per-frame loop. */
  Engine.prototype.masterMeter = function () {
    if (!this.masterAnalyser) return { level: 0, db: -Infinity };
    this.masterAnalyser.getFloatTimeDomainData(this.masterData);
    var peak = 0;
    var d = this.masterData;
    for (var i = 0; i < d.length; i++) {
      var v = Math.abs(d[i]);
      if (v > peak) peak = v;
    }
    var db = 20 * Math.log10(Math.max(peak, 1e-6));
    return { level: clamp((db + 60) / 60, 0, 1), db: db };
  };

  Engine.prototype.startRecording = function () {
    this.ensureContext();
    if (!this.recordDest || typeof window.MediaRecorder === 'undefined') {
      return false;
    }

    var types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    var mime = '';
    for (var i = 0; i < types.length; i++) {
      if (window.MediaRecorder.isTypeSupported && window.MediaRecorder.isTypeSupported(types[i])) {
        mime = types[i];
        break;
      }
    }

    var rec;
    try {
      rec = mime
        ? new window.MediaRecorder(this.recordDest.stream, { mimeType: mime })
        : new window.MediaRecorder(this.recordDest.stream);
    } catch (err) {
      return false;
    }

    var chunks = [];
    rec.ondataavailable = function (e) {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    rec.start();

    this.recorder = rec;
    this.recordChunks = chunks;
    this.recordType = rec.mimeType || mime || 'audio/webm';
    return true;
  };

  Engine.prototype.stopRecording = function () {
    var rec = this.recorder;
    var chunks = this.recordChunks || [];
    var type = this.recordType || 'audio/webm';
    this.recorder = null;
    this.recordChunks = null;

    if (!rec) return Promise.resolve(null);

    return new Promise(function (resolve) {
      rec.onstop = function () {
        resolve(new Blob(chunks, { type: type }));
      };
      try {
        rec.stop();
      } catch (err) {
        resolve(null);
      }
    });
  };

  // ------------------------------------------------------- built-in tracks

  var DEMOS = [
    {
      title: 'Neon Pulse', artist: 'AuxRush Synth', bpm: 124,
      bassRoot: 55, pattern: [0, -1, 0, 12, -1, 0, 7, -1],
      closedHat: 0.16, openHat: 0.30, doubleStab: false
    },
    {
      title: 'Midnight Drive', artist: 'AuxRush Synth', bpm: 128,
      bassRoot: 49, pattern: [0, 12, 0, 12, 0, 12, 3, 12],
      closedHat: 0.18, openHat: 0.22, doubleStab: true
    },
    {
      title: 'After Hours', artist: 'AuxRush Synth', bpm: 122,
      bassRoot: 43.65, pattern: [0, -1, 7, -1, 0, -1, 12, -1],
      closedHat: 0.14, openHat: 0.34, doubleStab: false
    },
    {
      title: 'Warehouse', artist: 'AuxRush Synth', bpm: 126,
      bassRoot: 61.74, pattern: [0, 0, 12, 0, 12, 7, 0, 12],
      closedHat: 0.20, openHat: 0.26, doubleStab: true
    }
  ];

  function noiseBuffer(ctx, seconds) {
    var len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buf;
  }

  function scheduleKick(ctx, out, t) {
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.9, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    osc.connect(gain);
    gain.connect(out);
    osc.start(t);
    osc.stop(t + 0.34);
  }

  function scheduleHat(ctx, out, t, noise, level, length) {
    var src = ctx.createBufferSource();
    src.buffer = noise;
    var hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    var gain = ctx.createGain();
    gain.gain.setValueAtTime(level, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    src.connect(hp);
    hp.connect(gain);
    gain.connect(out);
    src.start(t);
    src.stop(t + length + 0.02);
  }

  function scheduleClap(ctx, out, t, noise) {
    var src = ctx.createBufferSource();
    src.buffer = noise;
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1500;
    bp.Q.value = 1.2;
    var gain = ctx.createGain();
    gain.gain.setValueAtTime(0.35, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    src.connect(bp);
    bp.connect(gain);
    gain.connect(out);
    src.start(t);
    src.stop(t + 0.2);
  }

  function scheduleBass(ctx, out, t, freq, length) {
    var osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    lp.Q.value = 6;
    var gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.26, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.05, length));
    osc.connect(lp);
    lp.connect(gain);
    gain.connect(out);
    osc.start(t);
    osc.stop(t + Math.max(0.06, length) + 0.02);
  }

  function scheduleStab(ctx, out, t, root) {
    var ratios = [1, 1.189, 1.498, 2];
    for (var i = 0; i < ratios.length; i++) {
      var osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = root * ratios[i];
      var gain = ctx.createGain();
      var amp = 0.16 / (i + 1);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(amp, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      osc.connect(gain);
      gain.connect(out);
      osc.start(t);
      osc.stop(t + 0.32);
    }
  }

  function renderDemo(groove, bars) {
    var sr = 44100;
    var beat = 60 / groove.bpm;
    var barDur = beat * 4;
    var total = barDur * bars + 1;

    var OfflineCtor = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    var ctx = new OfflineCtor(2, Math.ceil(sr * total), sr);

    var bus = ctx.createGain();
    bus.gain.value = 0.8;
    bus.connect(ctx.destination);

    var noise = noiseBuffer(ctx, 0.4);

    for (var bar = 0; bar < bars; bar++) {
      var t0 = bar * barDur;

      for (var b = 0; b < 4; b++) {
        scheduleKick(ctx, bus, t0 + b * beat);
      }

      scheduleClap(ctx, bus, t0 + beat, noise);
      scheduleClap(ctx, bus, t0 + 3 * beat, noise);

      for (var e = 0; e < 8; e++) {
        var th = t0 + e * beat / 2;
        if (e % 2 === 1) {
          scheduleHat(ctx, bus, th, noise, groove.openHat, 0.26);
        } else {
          scheduleHat(ctx, bus, th, noise, groove.closedHat, 0.07);
        }
      }

      for (var n = 0; n < groove.pattern.length; n++) {
        var note = groove.pattern[n];
        if (note < 0) continue;
        var freq = groove.bassRoot * Math.pow(2, note / 12);
        scheduleBass(ctx, bus, t0 + n * beat / 2, freq, beat / 2 * 0.9);
      }

      if (bar % 4 === 0) {
        scheduleStab(ctx, bus, t0, groove.bassRoot * 4);
      }
      if (groove.doubleStab && bar % 2 === 1) {
        scheduleStab(ctx, bus, t0 + beat, groove.bassRoot * 4);
      }
    }

    return ctx.startRendering();
  }

  // ------------------------------------------------------------- sampler

  var PAD_NAMES = ['AIR HORN', 'SIREN', 'LASER', 'RISER', 'CRASH', 'STAB', 'BELL', 'BLIP'];

  function renderPad(kind, sr) {
    var OfflineCtor = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    var lengths = { 'AIR HORN': 1.2, SIREN: 1.6, LASER: 0.5, RISER: 2.4, CRASH: 1.8, STAB: 0.7, BELL: 1.4, BLIP: 0.25 };
    var ctx = new OfflineCtor(2, Math.ceil(sr * (lengths[kind] || 1)), sr);
    var out = ctx.createGain();
    out.gain.value = 0.8;
    out.connect(ctx.destination);

    function osc(type, freq, t0, t1, gain) {
      var o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(freq, t0);
      var g = ctx.createGain();
      g.gain.setValueAtTime(gain, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t1);
      o.connect(g);
      g.connect(out);
      o.start(t0);
      o.stop(t1 + 0.02);
      return o;
    }

    function noise(t0, t1, gain, filterType, f0, f1) {
      var len = Math.floor(sr * (t1 - t0));
      var buf = ctx.createBuffer(1, Math.max(1, len), sr);
      var d = buf.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      var src = ctx.createBufferSource();
      src.buffer = buf;
      var flt = ctx.createBiquadFilter();
      flt.type = filterType;
      flt.frequency.setValueAtTime(f0, t0);
      if (f1) flt.frequency.exponentialRampToValueAtTime(f1, t1);
      var g = ctx.createGain();
      g.gain.setValueAtTime(gain, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t1);
      src.connect(flt);
      flt.connect(g);
      g.connect(out);
      src.start(t0);
      src.stop(t1 + 0.02);
    }

    if (kind === 'AIR HORN') {
      [370, 466, 554].forEach(function (f) {
        var o = osc('sawtooth', f, 0, 1.15, 0.18);
        var vib = ctx.createOscillator();
        vib.frequency.value = 5.5;
        var vg = ctx.createGain();
        vg.gain.value = f * 0.012;
        vib.connect(vg);
        vg.connect(o.frequency);
        vib.start(0);
        vib.stop(1.2);
      });
    } else if (kind === 'SIREN') {
      var o = ctx.createOscillator();
      o.type = 'sine';
      for (var i = 0; i < 4; i++) {
        o.frequency.setValueAtTime(520, i * 0.4);
        o.frequency.linearRampToValueAtTime(880, i * 0.4 + 0.2);
        o.frequency.linearRampToValueAtTime(520, i * 0.4 + 0.4);
      }
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.25, 0);
      g.gain.setValueAtTime(0.25, 1.45);
      g.gain.exponentialRampToValueAtTime(0.0001, 1.6);
      o.connect(g);
      g.connect(out);
      o.start(0);
      o.stop(1.62);
    } else if (kind === 'LASER') {
      var laser = osc('square', 1800, 0, 0.4, 0.2);
      laser.frequency.exponentialRampToValueAtTime(120, 0.38);
    } else if (kind === 'RISER') {
      noise(0, 2.3, 0.22, 'bandpass', 300, 6000);
    } else if (kind === 'CRASH') {
      noise(0, 1.7, 0.5, 'highpass', 3000, 9000);
    } else if (kind === 'STAB') {
      [220, 261.63, 329.63].forEach(function (f, i) {
        osc('sawtooth', f, 0, 0.6, 0.14 / (i + 1));
      });
    } else if (kind === 'BELL') {
      osc('sine', 1046.5, 0, 1.3, 0.2);
      osc('sine', 1568, 0, 0.9, 0.08);
      osc('sine', 2637, 0, 0.5, 0.05);
    } else if (kind === 'BLIP') {
      osc('square', 880, 0, 0.18, 0.2);
    }

    return ctx.startRendering();
  }

  /** Renders all sampler pads offline; resolves as a name → AudioBuffer map. */
  function renderPads() {
    var sr = 44100;
    var out = {};
    return PAD_NAMES.reduce(function (chain, kind) {
      return chain.then(function (map) {
        return renderPad(kind, sr).then(function (buffer) {
          map[kind] = buffer;
          return map;
        });
      });
    }, Promise.resolve(out));
  }

  window.AuxRush = {
    Engine: Engine,
    Deck: Deck,
    analyzeBuffer: analyzeBuffer,
    renderDemo: renderDemo,
    renderPads: renderPads,
    PAD_NAMES: PAD_NAMES,
    DEMOS: DEMOS,
    clamp: clamp
  };
})();
