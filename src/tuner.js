import { PitchListener } from './pitch.js';
import { freqToMidi, midiToName, centsOff } from './notes.js';

const IN_TUNE_CENTS = 5;
const SMOOTH_ALPHA = 0.25;

export function createTuner(options, callbacks = {}) {
  const { noiseGate, inputGain, inputDeviceId, minFreq, maxFreq } = options;
  const { onReading } = callbacks;

  const listener = new PitchListener({
    noiseGate,
    inputGain,
    minFreq,
    maxFreq,
    centsTolerance: 100,
    stableFramesRequired: 999,
  });

  let raf = null;
  let smoothedFreq = null;

  function tick() {
    const level = listener.rmsLevel;
    const rawFreq = listener.lastFreq;

    if (rawFreq == null) {
      smoothedFreq = null;
      if (onReading) onReading({ silent: true, level });
    } else {
      smoothedFreq =
        smoothedFreq == null ? rawFreq : smoothedFreq + SMOOTH_ALPHA * (rawFreq - smoothedFreq);
      const midi = Math.round(freqToMidi(smoothedFreq));
      const cents = centsOff(smoothedFreq, midi);
      const inTune = Math.abs(cents) <= IN_TUNE_CENTS;
      if (onReading) {
        onReading({
          freq: smoothedFreq,
          midi,
          name: midiToName(midi),
          cents,
          inTune,
          level,
        });
      }
    }

    raf = requestAnimationFrame(tick);
  }

  return {
    getListener() {
      return listener;
    },

    async start() {
      await listener.start(inputDeviceId || undefined);
      listener.setListeningEnabled(true);
      raf = requestAnimationFrame(tick);
    },

    stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = null;
      smoothedFreq = null;
      listener.stop();
    },

    setNoiseGate(value) {
      listener.setNoiseGate(value);
    },

    setInputGain(value) {
      listener.setInputGain(value);
    },
  };
}
