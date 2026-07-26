import { buildTuning, playableRange, pickRandomSequence, midiToName, TUNING_STRING_COUNT } from './notes.js';
import { playNote, playSuccessBell, resumeAudioContext } from './audio.js';
import { PitchListener } from './pitch.js';

const PLAYBACK_TAIL_MS = 280;
const SEQUENCE_GAP_MS = 150;
const WRONG_REPLAY_DELAY_MS = 600;
const CORRECT_HOLD_MS = 800;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForSilence(listener, maxMs = 3000) {
  const threshold = listener.noiseGate * 0.6;
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

function buildWrongHints(targetSequence, targetIndex, detectedMidi) {
  return targetSequence.slice(0, targetIndex + 1).map((midi, i) => {
    if (i < targetIndex) return 'correct';
    if (midi === detectedMidi) return 'same';
    return midi > detectedMidi ? 'up' : 'down';
  });
}

export function createSession(settings, callbacks) {
  const noteCount = Math.min(3, Math.max(1, settings.noteCount ?? 1));
  const tuning = buildTuning({
    strings: TUNING_STRING_COUNT,
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
  let targetSequence = [];
  let targetIndex = 0;
  let previousLastMidi = null;
  let roundIndex = 0;
  let awaitingSilence = false;
  let attemptsOnCurrent = 0;
  let roundStartedAt = 0;
  let playTargetGeneration = 0;
  let pendingHints = null;

  function sessionPayload(extra = {}) {
    return {
      state,
      targetSequence,
      targetIndex,
      noteCount,
      attemptsOnCurrent,
      progress: stats.completed,
      ...extra,
    };
  }

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

  function recordPerNote(midi, wrongDelta, firstTry, countAppearance = true) {
    const name = midiToName(midi);
    if (!stats.perNote[name]) {
      stats.perNote[name] = { midi, wrongAttempts: 0, appearances: 0, firstTryCorrect: 0 };
    }
    if (countAppearance) stats.perNote[name].appearances++;
    stats.perNote[name].wrongAttempts += wrongDelta;
    if (firstTry) stats.perNote[name].firstTryCorrect++;
  }

  async function playTarget() {
    const generation = ++playTargetGeneration;
    state = 'playing';
    targetIndex = 0;
    listener.setListeningEnabled(false);
    callbacks.onStateChange?.(sessionPayload({ hints: pendingHints }));
    await resumeAudioContext();
    for (let i = 0; i < targetSequence.length; i++) {
      await playNote(targetSequence[i]);
      if (generation !== playTargetGeneration) return;
      if (i < targetSequence.length - 1) {
        await delay(SEQUENCE_GAP_MS);
        if (generation !== playTargetGeneration) return;
      }
    }
    await delay(PLAYBACK_TAIL_MS);
    if (generation !== playTargetGeneration) return;
    listener.setMicCaptureEnabled(true);
    await waitForSilence(listener);
    if (generation !== playTargetGeneration) return;
    listener.resetStability();
    listener.setListeningEnabled(true);
    pendingHints = null;
    state = 'listening';
    callbacks.onStateChange?.(sessionPayload());
  }

  async function nextNote() {
    if (roundIndex >= settings.notesPerSet) {
      state = 'finished';
      stats.totalTimeMs = Date.now() - stats.startedAt;
      listener.stop();
      callbacks.onFinished?.(getResults(stats));
      return;
    }
    attemptsOnCurrent = 0;
    pendingHints = null;
    targetSequence = pickRandomSequence(
      range.min,
      range.max,
      noteCount,
      settings.maxIntervalSemitones,
      previousLastMidi,
    );
    previousLastMidi = targetSequence[targetSequence.length - 1];
    targetIndex = 0;
    roundStartedAt = Date.now();
    roundIndex++;
    callbacks.onStateChange?.(
      sessionPayload({
        state: 'pick',
        acceptedNames: [],
      }),
    );
    await playTarget();
  }

  async function handleCorrectCelebration(firstTry) {
    const generation = playTargetGeneration;
    pendingHints = null;
    listener.setListeningEnabled(false);
    const revealedNames = targetSequence.map((m) => midiToName(m));
    callbacks.onCorrect?.({ sequence: targetSequence, names: revealedNames, firstTry });
    callbacks.onStateChange?.(
      sessionPayload({
        state: 'correct',
        revealedNames,
      }),
    );
    await resumeAudioContext();
    await playSuccessBell();
    if (generation !== playTargetGeneration) return;
    await delay(CORRECT_HOLD_MS);
    if (generation !== playTargetGeneration) return;
    listener.setMicCaptureEnabled(true);
    await waitForSilence(listener);
    if (generation !== playTargetGeneration) return;
    awaitingSilence = false;
    await nextNote();
  }

  function onSequenceNoteCorrect() {
    const acceptedMidi = targetSequence[targetIndex];
    recordPerNote(acceptedMidi, 0, false);
    const acceptedNames = targetSequence.slice(0, targetIndex + 1).map((m) => midiToName(m));
    callbacks.onStateChange?.(
      sessionPayload({
        state: 'sequence-progress',
        acceptedNames,
        partialReveal: acceptedNames[acceptedNames.length - 1],
      }),
    );
    targetIndex++;
    listener.consumeStable(acceptedMidi);
    listener.resetStability();
  }

  async function handleStable(detectedMidi) {
    if (state !== 'listening' || awaitingSilence || !listener.isListeningEnabled()) return;
    const expected = targetSequence[targetIndex];
    if (expected == null) return;
    if (targetIndex > 0 && detectedMidi === targetSequence[targetIndex - 1]) return;

    if (detectedMidi === expected) {
      const isLast = targetIndex === targetSequence.length - 1;
      if (!isLast) {
        onSequenceNoteCorrect();
        return;
      }
      const firstTry = attemptsOnCurrent === 0;
      const elapsed = Date.now() - roundStartedAt;
      stats.noteTimings.push(elapsed);
      stats.completed++;
      if (firstTry) {
        stats.firstTryCorrect++;
        stats.currentStreak++;
        stats.longestStreak = Math.max(stats.longestStreak, stats.currentStreak);
      } else {
        stats.currentStreak = 0;
      }
      recordPerNote(expected, 0, firstTry);
      listener.consumeStable(detectedMidi);
      awaitingSilence = true;
      void handleCorrectCelebration(firstTry);
    } else {
      attemptsOnCurrent++;
      stats.wrongAttempts++;
      stats.currentStreak = 0;
      recordPerNote(expected, 1, false, false);
      const hints = buildWrongHints(targetSequence, targetIndex, detectedMidi);
      pendingHints = hints;
      listener.consumeStable(detectedMidi);
      listener.resetStability();
      callbacks.onWrong?.({ played: detectedMidi, hints });
      callbacks.onStateChange?.(
        sessionPayload({
          state: 'wrong',
          hints,
        }),
      );
      const generation = playTargetGeneration;
      listener.setListeningEnabled(false);
      targetIndex = 0;
      await delay(WRONG_REPLAY_DELAY_MS);
      if (generation !== playTargetGeneration) return;
      await playTarget();
    }
  }

  listener.onStable((midi) => {
    void handleStable(midi);
  });

  return {
    async start() {
      if (state !== 'idle') return;
      stats.startedAt = Date.now();
      listener.setListeningEnabled(false);
      await listener.start(settings.inputDeviceId || undefined);
      listener.setListeningEnabled(false);
      state = 'running';
      roundIndex = 0;
      previousLastMidi = null;
      await nextNote();
    },
    async stop() {
      playTargetGeneration++;
      listener.stop();
      state = 'idle';
    },
    getStats: () => ({ ...stats }),
    getListener: () => listener,
    getState: () => state,
    setNoiseGate(value) {
      listener.setNoiseGate(value);
    },
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
