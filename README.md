# AuxRush DJ Studio

A two-deck DJ mixer that runs in the browser on the Web Audio API. No build step, no
dependencies: open `index.html`.

## Decks

Each deck has play/pause, a CDJ-style cue button, tempo sync that also lines the
beats up, 1/2/4/8-beat loops, four beat-snapped hot cues (tap to set, press and
hold to clear), a scrubable scrolling waveform with beat grid, 3-band EQ that
sweeps to a full low cut, a sweep filter, channel volume, pitch and an
interactive jog wheel — drag the platter while a deck is playing to pitch-bend
it up to ±30% and ride a beat into phase, releasing snaps back to tempo.

CUE behaves like a CDJ: while playing, a press jumps back to the cue point and
keeps going; while paused, holding plays a preview from the cue and releasing
snaps back to it, paused.

## Mixer

Crossfader, master volume with a live LED meter, and set recording — the record
dot captures the master bus and the library lists recordings for download.

The strip also carries a BEATS phase meter: with both decks playing it reads
**IN PHASE** when their kicks land together, or **A AHEAD / B AHEAD** naming
which deck is early — nudge that deck's jog wheel until it locks. SYNC stays
lit on any deck riding a matched tempo.

## Library

Two tabs:

- **Mix** — the tracks that feed the decks: four built-in grooves synthesised in the
  browser at first launch, plus anything you import (`+ Import audio`). Every track is
  analysed for BPM, musical key on the Camelot wheel, energy and structure.
- **Videos** — paste a YouTube link and it becomes a card with the real thumbnail and an
  embedded player. YouTube's player will not hand its audio to the mixer, so videos are
  for watching; they can't be crossfaded or recorded.

## Auto DJ

An on-device decision engine, not a preset shuffle:

- scores candidates on tempo, harmonic key compatibility, an energy arc and freshness;
- mixes out at the outgoing track's detected outro, dropping the incoming track in after
  its intro on a bar line;
- picks the blend length from the tempo gap (32 / 16 / 8 beats), and does a bass swap
  with a filter lift through the transition;
- keeps running through the library, wrapping around, until switched off.

It also takes over when both decks are already playing: it lines the incoming deck's beat
up with the live one and blends from the side the crossfader is pointing at.

## Files

- `index.html` — the mixer
- `styles.css` — theme and layout
- `js/engine.js` — Web Audio engine, analyser, key detection, built-in track synth
- `js/app.js` — interface, display loop, AI set planning
- `selftest.html` — development harness: runs the app in-page and reports checks to the
  console (deck build, BPM/key/energy analysis, library, video shelf, Auto DJ arming)

## Known limits

Tempo matching uses playback rate, so a matched track is pitch-shifted — Web Audio has no
keylock without a time-stretcher. YouTube audio can't be routed into the mixer.
