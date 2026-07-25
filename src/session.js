import { buildTuning, playableRange, pickRandomNote, midiToName } from './notes.js';
import { playNote, resumeAudioContext } from './audio.js';
import { PitchListener } from './pitch.js';

const PLAYBACK_TAIL_MS = 200;

function waitForSilence(listener, noiseGate, maxMs = 3000) {
  const threshold = noiseGate * 0.6;
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      if (listener.rmsLevel < threshold) {
        resolve();
        return;
      }
      if (Date.now() - start > maxMs) {
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    };
    tick();
  });
}

export function createSession(settings, callbacks) {
  const tuning = buildTuning({
    strings: settings.strings,
    lowestMidi: settings.lowestMidi,
    highestMidi: settings.highestMidi,
  });
  const range = playableRange({ tuning, frets: settings.frets });
  const minFreq = 440 * 2 ** ((range.min - 69) / 12) * 0.9;
  const maxFreq = 440 * 2 ** ((range.max - 69) / 12) * 1.1;

  const listener = new PitchListener({
    noiseGate: settings.noiseGate,
    centsTolerance: settings.centsTolerance,
    minFreq,
    maxFreq,
  });

  let state = 'idle';
  let targetMidi = null;
  let previousMidi = null;
  let noteIndex = 0;
  let awaitingSilence = false;
  let attemptsOnCurrent = 0;
  let noteStartedAt = 0;

  const stats = {
    totalNotes: settings.notesPerSet,
    completed: 0,
    firstTryCorrect: 0,
    wrongAttempts: 0,
    totalTimeMs: 0,
    longestStreak: 0,
    currentStreak: 0,
    perNote: {},
    startedAt: null,
    noteTimings: [],
  };

  function recordPerNote(midi, wrongDelta, firstTry) {
    const name = midiToName(midi);
    if (!stats.perNote[name]) {
      stats.perNote[name] = { midi, wrongAttempts: 0, appearances: 0, firstTryCorrect: 0 };
    }
    stats.perNote[name].appearances++;
    stats.perNote[name].wrongAttempts += wrongDelta;
    if (firstTry) stats.perNote[name].firstTryCorrect++;
  }

  async function playTarget() {
    state = 'playing';
    listener.setGated(true);
    callbacks.onStateChange?.({ state, targetMidi, noteIndex, attemptsOnCurrent });
    await resumeAudioContext();
    await playNote(targetMidi);
    await new Promise((r) => setTimeout(r, PLAYBACK_TAIL_MS));
    listener.setGated(false);
    listener.resetStability();
    state = 'listening';
    callbacks.onStateChange?.({ state, targetMidi, noteIndex, attemptsOnCurrent });
  }

  async function nextNote() {
    if (noteIndex >= settings.notesPerSet) {
      state = 'finished';
      stats.totalTimeMs = Date.now() - stats.startedAt;
      listener.stop();
      callbacks.onFinished?.(getResults(stats));
      return;
    }
    attemptsOnCurrent = 0;
    targetMidi = pickRandomNote(range.min, range.max, previousMidi);
    previousMidi = targetMidi;
    noteStartedAt = Date.now();
    noteIndex++;
    callbacks.onStateChange?.({
      state: 'pick',
      targetMidi: null,
      noteIndex,
      attemptsOnCurrent,
      progress: noteIndex - 1,
    });
    await playTarget();
  }

  function handleStable(detectedMidi) {
    if (state !== 'listening' || awaitingSilence) return;
    if (detectedMidi === targetMidi) {
      const firstTry = attemptsOnCurrent === 0;
      const elapsed = Date.now() - noteStartedAt;
      stats.noteTimings.push(elapsed);
      stats.completed++;
      if (firstTry) {
        stats.firstTryCorrect++;
        stats.currentStreak++;
        stats.longestStreak = Math.max(stats.longestStreak, stats.currentStreak);
      }
      recordPerNote(targetMidi, attemptsOnCurrent, firstTry);
      listener.consumeStable(detectedMidi);
      awaitingSilence = true;
      callbacks.onCorrect?.({ midi: targetMidi, name: midiToName(targetMidi), firstTry });
      callbacks.onStateChange?.({
        state: 'correct',
        targetMidi,
        noteIndex,
        attemptsOnCurrent,
        revealedName: midiToName(targetMidi),
      });
      waitForSilence(listener, settings.noiseGate).then(() => {
        awaitingSilence = false;
        nextNote();
      });
    } else {
      attemptsOnCurrent++;
      stats.wrongAttempts++;
      stats.currentStreak = 0;
      listener.consumeStable(detectedMidi);
      listener.resetStability();
      callbacks.onWrong?.({ played: detectedMidi, target: targetMidi });
      callbacks.onStateChange?.({ state: 'wrong', targetMidi, noteIndex, attemptsOnCurrent });
      playTarget();
    }
  }

  listener.onStable(handleStable);

  return {
    async start() {
      if (state !== 'idle') return;
      stats.startedAt = Date.now();
      await listener.start(settings.inputDeviceId || undefined);
      state = 'running';
      noteIndex = 0;
      previousMidi = null;
      await nextNote();
    },
    async stop() {
      listener.stop();
      state = 'idle';
    },
    getStats: () => ({ ...stats }),
    getListener: () => listener,
    getState: () => state,
  };
}

export function getResults(stats) {
  const avgTime =
    stats.noteTimings.length > 0
      ? stats.noteTimings.reduce((a, b) => a + b, 0) / stats.noteTimings.length
      : 0;
  const firstTryPct =
    stats.completed > 0 ? (stats.firstTryCorrect / stats.completed) * 100 : 0;
  const perNoteList = Object.entries(stats.perNote)
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.wrongAttempts - a.wrongAttempts);

  return {
    totalTimeMs: stats.totalTimeMs,
    completed: stats.completed,
    firstTryCorrect: stats.firstTryCorrect,
    firstTryPct,
    wrongAttempts: stats.wrongAttempts,
    avgTimeMs: avgTime,
    longestStreak: stats.longestStreak,
    perNote: perNoteList,
  };
}
