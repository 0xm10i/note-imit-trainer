import { getAudioContext, resumeAudioContext, scheduleMetronomeClick } from './audio.js';

const LOOKAHEAD_SEC = 0.1;
const SCHEDULER_MS = 25;

export function createMetronome(options, callbacks = {}) {
  const { onBeat } = callbacks;

  let bpm = options.bpm ?? 90;
  let beatsPerMeasure = options.beatsPerMeasure ?? 4;
  let schedulerId = null;
  let nextBeatTime = 0;
  let beatIndex = 0;
  let running = false;

  function isAccent() {
    return beatIndex % beatsPerMeasure === 0;
  }

  function scheduleBeats() {
    const ac = getAudioContext();
    while (nextBeatTime < ac.currentTime + LOOKAHEAD_SEC) {
      const accent = isAccent();
      scheduleMetronomeClick(accent, nextBeatTime);
      const beatInMeasure = (beatIndex % beatsPerMeasure) + 1;
      if (onBeat) onBeat({ beatInMeasure, accent });
      nextBeatTime += 60 / bpm;
      beatIndex += 1;
    }
  }

  return {
    getBpm() {
      return bpm;
    },

    getBeatsPerMeasure() {
      return beatsPerMeasure;
    },

    isRunning() {
      return running;
    },

    setBpm(value) {
      bpm = Math.min(240, Math.max(40, value));
    },

    setBeatsPerMeasure(value) {
      beatsPerMeasure = Math.min(16, Math.max(1, value));
    },

    async start() {
      if (running) return;
      await resumeAudioContext();
      const ac = getAudioContext();
      beatIndex = 0;
      nextBeatTime = ac.currentTime + 0.05;
      running = true;
      schedulerId = setInterval(scheduleBeats, SCHEDULER_MS);
      scheduleBeats();
    },

    stop() {
      if (!running) return;
      running = false;
      if (schedulerId) clearInterval(schedulerId);
      schedulerId = null;
      beatIndex = 0;
    },
  };
}
