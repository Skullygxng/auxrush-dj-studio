# djapp.md — AuxRush Revamp Blueprint

*Research-backed plan for making AuxRush feel like a real DJ product. Sources: official
pages and help docs of djay (Algoriddim), edjing (MWM), Cross DJ (Mixvibes), Serato DJ
Pro, Traktor Pro 4, Rekordbox, VirtualDJ, plus the web-DJ field (YouDJ, PartyCloud).
Verified via the vendors' own pages and App Store listings; reviewed at phone viewport
where possible. Marketing pages, not hands-on sessions — treat specifics as high
confidence for features, medium for feel.*

---

## 1. Why we're here

The current app has a correct *engine* (sync that beat-aligns, bass-swap automix,
beat-snapped cues, phase meter, −30 dB EQ kill) but it doesn't *feel* like a DJ setup.
The audit said it, and the research confirms exactly why: the feel of the majors comes
from a layer we never built — **library that persists, layout that matches DJ mental
models, performance pads, FX you can fire mid-mix, and automix as a configurable
surface instead of a toggle.**

---

## 2. The competitive landscape (condensed)

### djay Pro / djay iOS (Algoriddim) — the benchmark
- **Stems:** Neural Mix real-time separation (vocals/drums/bass/instruments) via
  AudioShake on-device; per-stem AI waveforms that re-render as stem sliders move.
- **Keylock/key:** advanced time-stretch, key detection, colored waveforms, auto-gain,
  **Fluid Beatgrid** engine that follows tempo drift mid-track.
- **Loops/sequencer:** Looper with up to **48 time-stretched, beat-matched loops per
  track**; live Sequencer with auto-quantized taps; 1000+ sample packs.
- **FX:** 40+ effects; **Crossfader Fusion** — morphing two tracks by deconstructing
  them and applying filters/FX per stem.
- **Automix (their docs are a design spec in themselves):**
  - queue from *manual*, **"Matching Songs" AI suggestions based on the current track**,
    or a playlist;
  - **transition FX styles: Filter, Echo, Tremolo, Riser, Neural Mix stem-swap**, plus
    *Automatic* (randomly picks a style);
  - duration in **bars, seconds, or Automatic**;
  - tempo strategy: **Automatic / Sync / Sync + Tempo Blend** (holds the playing track's
    BPM if the gap is small so the floor doesn't hear a jump);
  - auto or manual song start/end points; **"Mix Now"** fires the earliest viable blend.
- **Mobile UX:** portrait = two turntables flanking a central mixer; pro mode = two
  horizontal waveforms with the library beside them; the library is a slide-over panel
  that never stops playback; load by dragging onto an idle deck.
- Streaming everywhere (Spotify/Tidal/Apple Music/Beatport), but **no recording or stems
  on DRM streams**.

### edjing Mix (MWM) — the consumer mass-market app (250M+ downloads)
- **Smart EQ:** stem-aware EQ that isolates vocals/percussion/instruments rather than
  frequency bands.
- **Loops 1/64–128 beats**, hot cues, beat grids, BPM editor (tap, ×2, ÷2, reset) — and
  cue/grid data **surviving engine upgrades** is advertised (persistence as a feature).
- **Automix:** queue-driven, transition length **in seconds or beats**, adjustable
  start/end points, max playback time per song, reorder/shuffle/skip, Auto Sync toggle.
  Explicitly: *Sync aligns decks; Automix additionally picks the sequence and fires
  transitions.*
- 20+ live FX, Stemz separation, HD recording (wav/aiff), **DJ School** guided lessons,
  Mixfader hardware, PHASE.

### Cross DJ (Mixvibes) — the closest two-deck mobile analogue
The cleanest checklist to steal: portrait one-handed mixing, zoomable waveforms,
zero-latency scratch, **keylock**, auto-sync + quantized launch, **pitch 4–100% +
pitch bend**, **loops 1/32–32 beats beat-locked**, hot cues, **quantize mode, slip
mode**, DJM-style 3-band EQ, **vinyl markers for scratch control**, 30+ FX, **sampler
with 40 one-shots + 40 loops + record your own**, stem isolation, auto-gain, split-cue
pre-listening, Ableton Link, MIDI.

### Serato DJ Pro
- **Stems** on performance pads; **Lucid Beatgrids** + dynamic waveforms (horizontal or
  vertical); 4-deck; 50+ FX; **streaming from Apple Music, Beatport, SoundCloud,
  Spotify and Tidal simultaneously**; Pitch 'n Time keylock/key-shift; Pro pad modes:
  **Stems FX, Beat Jump, Slicer**; Smart Sync; smart crates. **No recording of streamed
  sets.**

### Traktor Pro 4
- Stems via **iZotope RX** with per-stem waveform + per-stem volume/filter/FX;
  **flexible beatgrids that follow tempo changes without audio degradation on sync**;
  **Elastique 3 time-stretch**; 43 FX + 9 post-fader single-knob **Mixer FX**; Xone:95 /
  DJM-600 EQ/filter emulations; **Flux Mode (slip)** + Reverse; hot cues / hot loops /
  **beatjumps**; Pattern Player (drum kits); Remix Decks; Ozone limiter; 8 cue/loop
  slots per deck. Its public comparison table is a great **rubric**: sync modes (tempo
  vs beat sync, auto-master, nudge), keylock per deck, EQ and filter models.

### Rekordbox (Pioneer)
4-part stems, **AI vocal-position detection and automatic personalized cue points**,
cloud analysis, Cloud Library Sync (8 devices), mobile app with full performance mode
and on-phone cue/grid editing, aggressive plan gating ($0–$30/mo).

### VirtualDJ — the feature ceiling
Real-time stems with **ModernEQ (stem-level EQ replacing frequency EQs)**, stem pads,
unlimited sampler banks + pads editor, **ScratchDNA** (automated scratch routines),
**Sandbox mode** (audition the next mix ahead of the live output, auto-return — killer
prep feature), **intelligent automix with editor + auto song-structure detection**,
Genius DJ suggestions, karaoke, video mixing, DMX lighting, 300+ controllers. Free for
non-pro.

### Web DJ apps
- **YouDJ** is the only maintained no-install web mixer that matters: 2 decks, 16 FX,
  sampler, vinyl scratching, **AutoSync/AutoBPM so beginners can mix without
  knowledge**, keylock claim, loops, hot cues, 3-band EQ, playlist automix, demo tracks
  preloaded. 100M+ uses.
- **Partycloud.fm** (iWebDJ engine) proved browser + SoundCloud catalog mixing works,
  but is mostly dormant.
- **The browser DJ field is effectively empty.** That is AuxRush's strategic opening —
  no incumbent web product has the majors' feature depth.

---

## 3. The shared DNA of every serious DJ app

1. **Analysis-first library.** BPM, Camelot key, colored waveforms, beat grids computed
   on load; the best add auto-generated cue points and song-structure detection.
2. **Stems are table stakes** — every single major ships real-time separation, and the
   differentiator is *where* stems surface: pads (Serato), EQ knobs (VirtualDJ
   ModernEQ), crossfader (djay Fusion), B-side control vinyl.
3. **Automix is a settings surface, not a toggle:** transition style, duration in
   bars/seconds/auto, tempo strategy, start/end mode, and a "Mix Now" button.
4. **Pro-feel details that recur everywhere:** distinct jog gestures (scratch vs pitch
   bend), EQ full-kill, CDJ cue preview, **beat jump**, **slip/flux mode**, quantize
   toggle, phase meters, auto-gain, keylock, split-cue pre-listening, recorder.
5. **Mobile UX:** library as a slide-over panel while decks keep playing; portrait
   layout = decks above, mixer between; big thumb-sized pads; **beginner onboarding is
   a headline feature** (DJ School, AutoSync, AI suggestions) — not an afterthought.
6. **Freemium monetization:** stems/recording/FX behind a Pro tier.

---

## 4. Gap analysis — AuxRush vs the DNA

| Capability | Majors | AuxRush today | Verdict |
|---|---|---|---|
| BPM / key / waveform analysis | all | ✅ on load | keep |
| Colored waveforms | djay/Serato | ❌ | P2 |
| Library persistence | all | ❌ session-only | **P0** |
| Library usable while decks play | all | sheet blocks view, decks keep playing | P0 (panel) |
| EQ full kill | all | ✅ −30 dB | keep |
| Keylock | djay/Serato/Traktor | ❌ playbackRate only | **P1 — biggest gap** |
| Jog scratch vs pitch bend | all | bend only | P1 |
| Slip/flux mode | Traktor/Cross | ❌ | P1 |
| Quantize toggle | Cross | implicit only | P1 |
| Beat jump | Serato/Traktor | ❌ | P1 |
| FX (beat-synced, XY pads) | all | ❌ | P1 |
| Sampler pads | Cross/VirtualDJ/edjing | ❌ | P1 |
| Stems | all | ❌ | P2 (see §7) |
| Automix as settings surface | djay/edjing | hard-coded brain | **P1** |
| Song structure for mix points | VirtualDJ/rekordbox | ✅ mixIn/mixOut | keep |
| Recorder | edjing/edjing HD | ✅ webm session-only | P2 (wav via offline render) |
| Beginner onboarding | edjing/YouDJ | ❌ | P2 |
| Video mixing | djay/VirtualDJ | ❌ (watch-only shelf) | P3 |
| 4-deck, MIDI, DVS, streaming | pro tier | ❌ | out of scope |

---

## 5. The revamp plan

### P0 — Foundation (do first; everything else sits on this)

**T1. Library persistence (IndexedDB).**
Store imported audio as Blob in an IndexedDB store `tracks`, plus a `state` store for
cues, BPM, key, energy, mixIn/mixOut and history. On boot: load metadata instantly from
`state`, decode buffers lazily per load (keep only 2–3 decoded buffers alive; release
the deck's buffer on unload). Also persist recordings metadata. Acceptance: reload the
page → library identical, decks re-loadable, cues intact. This is the single biggest
"this is a real product" change.

**T2. Layout revamp — portrait mixer stack.**
Adopt the djay portrait grammar: deck A with waveform on top, **center mixer column
(vertical channel faders + crossfader + filter), deck B below**, transport row directly
under each waveform. Kill the current `deck-mix` grid of horizontal sliders — knobs
read as form controls; vertical faders read as a mixer. Add a mixer strip that shows
both decks' BPM/key side by side with the BEATS meter. Desktop: three columns (already
have) but with the vertical-fader center.

**T3. Library as slide-over, never blocking.**
The current full-screen sheet stops the eyes, not the decks. Make the library a
right-side slide-over (desktop) / bottom sheet (phone) with **mini transport in its
header** (both decks' play state + crossfader mini), so mixing continues while
browsing. Drag or tap-to-load onto an idle deck.

**T4. Session recorder → downloadable + importable.**
Keep MediaRecorder, but name recordings with timestamp, store metadata (duration, size)
in the same IndexedDB, add a playback preview row, and allow re-importing a recording
as a track. Also offer `WAV` export by re-rendering the recorded segments offline if
MediaRecorder gives webm/opus.

### P1 — Performance feel (the "pro hands" pass)

**T5. Keylock via AudioWorklet time-stretch.**
The single biggest pro-feel gap. Plan: port **SoundTouchJS** (or Rubber Band WASM) as an
AudioWorklet inserted between the buffer source and `eqLow`; playbackRate then changes
tempo while the worklet corrects pitch. Ship as **a per-deck keylock toggle** defaulting
ON, with graceful fallback to `playbackRate` where the worklet fails. Acceptance: sync a
±8% track and the key doesn't audibly shift. *Effort: the largest ticket in this
document; do after P0 because everything else is cheap in comparison.*

**T6. Dual-gesture jog wheels.**
Two distinct gestures on the platter, like every major app:
- **Tap-drag on the platter edge while playing = scratch** — grab the audio position
  (seek-follow the finger), scrub back and forth, release resumes from the grabbed
  point (optionally with slip, see T7);
- **Quick forward/backward flick near the edge = pitch bend ±6%** (current bend gesture,
  kept, with a bigger range than ±30% allowed while nudging: ±50% transient).
Implement via pointer position relative to platter center + angular velocity; use the
existing `setBend` for nudging and a new `deck.scratch(pos)` for grabbing.

**T7. Slip/flux mode toggle.**
When paused/muted/looped while slip is on, audio keeps "playing" conceptually and
re-enters at where it would have been — implement by tracking virtual position with the
existing audio clock and only muting (gain to 0) rather than pausing the source.
Serato/Traktor use it constantly for trick edits.

**T8. Quantize toggle + beat jump.**
Global per-deck quantize (default ON): cue set, loop start and seeks snap to the beat
grid (cues already do; extend to loops and seeks when ON). Add **Beat Jump −1/+1/+2/+4
bars** buttons that jump the playhead by whole bars without stopping audio (schedule the
new segment on the audio clock like automix does).

**T9. FX bank — start with 4 beat-synced single-knob FX.**
Traktor's "Mixer FX" model (one knob per deck, always available) is the right first
step, then a pad sheet:
- **Echo** (tempo-synced delay at 1/8 with feedback, knob = wet, tap = hold),
- **Reverb** (convolver with a synthesized plate impulse),
- **Filter sweep on pads** (reuse the sweep filter with automation),
- **Noise** (white-noise oscillator mixed post-EQ, gated on hold).
Implement with a per-deck parallel send chain off `eqHigh`; wet gain crossfaded by the
knob. Fire mid-mix, recorded on the master bus automatically.

**T10. Sampler pads — 8 pads, synthesized.**
Follow Cross DJ: pads trigger one-shots through a dedicated bus into master. Synthesize
on first launch (air horn, siren, laser, riser, crash, stab, vocal-ish formant blip,
bell) into small WAVs, or render with OfflineAudioContext like the built-in grooves.
Hold-to-repeat at 1/8-note for sirens/risers. Pads live in a slide-up tray.

**T11. Automix settings surface ("Automix brain, user hands").**
We already have the AI scoring (tempo/key/energy/freshness) and beat-aligned bass-swap
transitions — djay proves this design; expose it:
- **Transition style:** Current (bass swap), Filter lift, Echo-out, Cut, Stem-swap
  (P2, once stems exist), Automatic (random pick);
- **Duration:** bars (8/16/32) or seconds, or Auto (existing tempo-gap logic);
- **Tempo strategy:** Sync (match incoming to outgoing) / **Tempo Blend** (keep playing
  BPM when gap < 6% — djay's trick that avoids floor jumps);
- **Start/end points:** auto (structure detection, already have) or manual;
- **"Mix Now"** button: fire the earliest viable blend immediately;
- Queue list with drag-reorder (edjing) and the existing "Next · reason" line kept.

**T12. Persistence of the AI state + "Matching Songs" panel.**
Show the scored shortlist (top 5 with reasons) behind the AUTO DJ button — the research
shows "Matching Songs" is djay's most-loved automix feature. We compute it; display it.

### P2 — Differentiators (web-specific wins)

**T13. Stems (choose the pragmatic path).**
Real-time neural separation in a browser is possible (Meta's Demucs/MusicGen-class
models run in WASM/ONNX-Web) but heavy. Two pragmatic tiers:
- **Tier A (ship first): offline stems.** Run separation at import time with
  progress UI ("separating vocals…"), cache 4 stem buffers in IndexedDB per track.
  Playback = 4 parallel sources into per-stem gains/EQ; UI = stem pads + ModernEQ-style
  stem knobs. This is exactly how the "offline pre-rendered stems" workaround pattern
  works and it's rock solid.
- **Tier B (later): on-the-fly** with an AudioWorklet model, flagged experimental.
Tier A alone unlocks: a cappella/instrumental decks, stem-swap automix (djay's Neural
Mix transition style), Smart EQ, acapella-over-bass mixing — the feature that makes
people screenshot the app.

**T14. Colored waveforms.** Frequency-band colored waveform (bass=blue, mids=green,
highs=white, like Serato/rekordbox) — we already compute FFT for key detection; reuse
it to color the 1400-peak array at analysis time. Cheap, massive visual upgrade.

**T15. Beginner layer (edjing DJ School / YouDJ AutoSync).**
- First-run coach marks (5 tooltips: play, sync, crossfader, jog, automix);
- "Easy mode" that hides pitch/quantize detail and keeps sync+automix;
- One-tap demo set: auto-loads two built-ins, runs one automix transition as a demo.

**T16. Recorder upgrade + WAV export** (offline render path from T4).

**T17. Set history / "hours" view.** edjing-style: every automix transition logged
(track in → track out, timestamp, key change) — great for practicing and for the
"did the AI do something cool" feeling.

### P3 — Later

Video mixing (needs a second `<video>` + canvas compositing, no audio routing),
4-deck, MIDI controllers (Web MIDI is Chrome-only), Ableton Link (UDP — needs a server
or local-network permission), streaming catalogs (DRM walls — only public/CC sources
like SoundCloud public tracks are feasible), multi-user/PartyLink.

---

## 6. Web Audio realities & workarounds (from research)

- **Latency:** keep the graph small; schedule on `ctx.currentTime` (we already do for
  drops/automix); warn when output is Bluetooth (huge latency makes nudging useless —
  show a "wired headphones recommended" hint).
- **Keylock:** no native support — AudioWorklet time-stretch (T5) is the community
  solution; offline pre-render as fallback.
- **Autoplay:** context starts suspended; resume on first pointer event (we do); never
  trust `play()` promises.
- **DRM:** Spotify/Apple Music/YouTube audio cannot enter Web Audio (EME). This is why
  the majors gate stems/recording on streams. For us: local files + CC catalog +
  user-imported audio only.
- **Memory:** decoded PCM ≈ 10 MB/min stereo; lazy decode + evict-on-unload +
  IndexedDB blobs is the standard fix (pairs with T1).
- **Safari:** stricter background audio, different meter behavior — test there; the
  iOS PWA route (add-to-home-screen) is the best mobile delivery.

---

## 7. What NOT to build (anti-scope)

- **DRM streaming catalogs** — legally and technically dead ends in a browser.
- **4-deck mode** — doubles UI complexity before the 2-deck feel is great.
- **MIDI/DVS hardware** — great later, meaningless without a working web core.
- **Cloud accounts** — IndexedDB + file export is enough for a long time.

---

## 8. Suggested order

```
T1 persistence → T2 layout → T3 slide-over library → T4 recorder
→ T9 FX → T10 sampler → T11 automix surface → T12 next-list
→ T8 quantize+beat jump → T7 slip → T6 dual-gesture jog
→ T5 keylock → T14 colored waveforms → T13 stems → T15 onboarding
```
Rationale: persistence and layout change everything about how the app feels for the
effort spent; FX/sampler/automix-surface are cheap wins with big perceived value;
keylock and stems are the expensive differentiators that turn it into a serious product.

---

## 9. Progress log

Shipped since this plan was written:

- **T1 persistence** — IndexedDB stores audio blobs + analysis + cues; imports and
  recordings survive a reload, decks re-load lazily.
- **T2 layout** — portrait mixer stack with vertical channel faders and a central
  strip (BPM/key readouts, BEATS meter, automix surface).
- **T3 slide-over library** with a mini transport in its header.
- **T4/T16 recorder** — persisted recordings with download and delete.
- **T8** quantize toggle + beat jump, **T9** echo/verb/flux FX pads,
  **T10** 8-pad sampler, **T11** automix settings surface (style/length/Mix Now),
  **T12** scored "next" list.
- **T6/T7** scratch (hub drag, grains both ways) and slip mode (SLIP chip).

Still open from the plan: **T5 keylock** (AudioWorklet time-stretch), **T13 stems**,
**T14 colored waveforms**, **T15 onboarding**, **T17 set history**.

## 10. Honest research caveats

- Findings come from vendor pages, help docs and store listings — not hands-on use of
  each app's current build. Feature *existence* is high-confidence; exact feel details
  (e.g. djay's bend ranges) are inferred.
- The web-DJ field survey found no maintained incumbent beyond YouDJ — claims about
  "empty space" rest on that search.
- djay's Neural Mix transition style and Tempo Blend descriptions come from Algoriddim's
  own automix documentation and are the primary inspiration for T11.
