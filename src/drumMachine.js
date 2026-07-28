import { getAudioContext, resumeAudioContext, scheduleDrumHit } from './audio.js';

const LOOKAHEAD_SEC = 0.1;
const SCHEDULER_MS = 25;

export const DRUM_VOICES = ['kick', 'snare', 'hhClosed'];

export const DRUM_VOICE_LABELS = {
  kick: 'K',
  snare: 'S',
  hhClosed: 'H',
};

function emptyPattern(stepCount) {
  const pattern = {};
  for (const voice of DRUM_VOICES) {
    pattern[voice] = Array.from({ length: stepCount }, () => false);
  }
  return pattern;
}

function resizePattern(pattern, stepCount) {
  const next = emptyPattern(stepCount);
  for (const voice of DRUM_VOICES) {
    const old = pattern[voice] ?? [];
    for (let i = 0; i < stepCount; i += 1) {
      next[voice][i] = i < old.length ? old[i] : false;
    }
  }
  return next;
}

export function createDrumMachine(options, callbacks = {}) {
  const { onStep } = callbacks;

  let bpm = options.bpm ?? 90;
  let beats = options.beats ?? 4;
  let subBeats = options.subBeats ?? 4;
  let stepCount = beats * subBeats;
  let pattern = emptyPattern(stepCount);
  let stepIndex = 0;
  let schedulerId = null;
  let nextStepTime = 0;
  let running = false;
  let paused = false;

  function stepDurationSec() {
    return 60 / bpm / subBeats;
  }

  function fireStep() {
    for (const voice of DRUM_VOICES) {
      if (pattern[voice][stepIndex]) scheduleDrumHit(voice, nextStepTime);
    }
    if (onStep) onStep({ stepIndex });
    nextStepTime += stepDurationSec();
    stepIndex = (stepIndex + 1) % stepCount;
  }

  function scheduleSteps() {
    const ac = getAudioContext();
    while (nextStepTime < ac.currentTime + LOOKAHEAD_SEC) {
      fireStep();
    }
  }

  function clearScheduler() {
    if (schedulerId) clearInterval(schedulerId);
    schedulerId = null;
  }

  function resizeGrid(newBeats, newSubBeats) {
    beats = newBeats;
    subBeats = newSubBeats;
    stepCount = beats * subBeats;
    pattern = resizePattern(pattern, stepCount);
    stepIndex = 0;
  }

  return {
    getBpm() {
      return bpm;
    },

    getBeats() {
      return beats;
    },

    getSubBeats() {
      return subBeats;
    },

    getStepCount() {
      return stepCount;
    },

    getPattern() {
      return pattern;
    },

    getStepIndex() {
      return stepIndex;
    },

    isRunning() {
      return running;
    },

    isPaused() {
      return paused;
    },

    setBpm(value) {
      bpm = Math.min(240, Math.max(40, value));
    },

    setBeats(value) {
      const next = Math.min(16, Math.max(1, value));
      if (next === beats) return;
      stop();
      resizeGrid(next, subBeats);
    },

    setSubBeats(value) {
      const next = Math.min(16, Math.max(1, value));
      if (next === subBeats) return;
      stop();
      resizeGrid(beats, next);
    },

    toggleStep(voice, step) {
      if (!DRUM_VOICES.includes(voice) || step < 0 || step >= stepCount) return;
      pattern[voice][step] = !pattern[voice][step];
    },

    async start() {
      if (running && !paused) return;
      await resumeAudioContext();
      const ac = getAudioContext();
      running = true;
      paused = false;
      if (!schedulerId) {
        nextStepTime = ac.currentTime + 0.05;
        schedulerId = setInterval(scheduleSteps, SCHEDULER_MS);
        scheduleSteps();
      }
    },

    pause() {
      if (!running || paused) return;
      paused = true;
      clearScheduler();
    },

    async resume() {
      if (!running || !paused) return;
      await resumeAudioContext();
      const ac = getAudioContext();
      paused = false;
      nextStepTime = ac.currentTime + 0.05;
      schedulerId = setInterval(scheduleSteps, SCHEDULER_MS);
      scheduleSteps();
    },

    stop() {
      running = false;
      paused = false;
      clearScheduler();
      stepIndex = 0;
      if (onStep) onStep({ stepIndex: 0 });
    },

    resetPosition() {
      stepIndex = 0;
      if (running && !paused) {
        const ac = getAudioContext();
        nextStepTime = ac.currentTime + 0.05;
      }
      if (onStep) onStep({ stepIndex: 0 });
    },
  };
}
