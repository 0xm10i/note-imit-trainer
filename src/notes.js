const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function midiToFreq(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function freqToMidi(freq) {
  return 69 + 12 * Math.log2(freq / 440);
}

export function midiToName(midi) {
  const octave = Math.floor(midi / 12) - 1;
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  return `${name}${octave}`;
}

export function nameToMidi(name) {
  const match = name.trim().match(/^([A-Ga-g])([#b]?)(-?\d+)$/);
  if (!match) throw new Error(`Invalid note name: ${name}`);
  const letter = match[1].toUpperCase();
  const accidental = match[2];
  const octave = parseInt(match[3], 10);
  let pc = NOTE_NAMES.indexOf(letter);
  if (pc < 0) throw new Error(`Invalid note name: ${name}`);
  if (accidental === '#') pc += 1;
  if (accidental === 'b') pc -= 1;
  pc = ((pc % 12) + 12) % 12;
  return (octave + 1) * 12 + pc;
}

/** Evenly spaced open-string tunings between lowest and highest MIDI (5 strings). */
export const TUNING_STRING_COUNT = 5;

export function buildTuning({ strings, lowestMidi, highestMidi }) {
  if (strings < 1) throw new Error('strings must be >= 1');
  if (lowestMidi > highestMidi) throw new Error('lowest must be <= highest');
  if (strings === 1) return [lowestMidi];
  const tuning = [];
  for (let i = 0; i < strings; i++) {
    const t = i / (strings - 1);
    tuning.push(Math.round(lowestMidi + t * (highestMidi - lowestMidi)));
  }
  return tuning;
}

export function playableRange({ tuning, frets }) {
  const min = Math.min(...tuning);
  const max = Math.max(...tuning) + frets;
  return { min, max };
}

export function allNotesInRange(min, max) {
  const notes = [];
  for (let m = min; m <= max; m++) notes.push(m);
  return notes;
}

export function pickRandomNote(min, max, excludeMidi = null) {
  const pool = allNotesInRange(min, max);
  if (pool.length === 0) throw new Error('empty note range');
  if (pool.length === 1) return pool[0];
  let candidate;
  let guard = 0;
  do {
    candidate = pool[Math.floor(Math.random() * pool.length)];
    guard++;
  } while (candidate === excludeMidi && guard < 50);
  return candidate;
}

export function pickRandomSequence(min, max, length, maxInterval, excludeFirstMidi = null) {
  if (length < 1) throw new Error('length must be >= 1');
  if (length === 1) return [pickRandomNote(min, max, excludeFirstMidi)];
  const seq = [pickRandomNote(min, max, excludeFirstMidi)];
  for (let i = 1; i < length; i++) {
    const prev = seq[i - 1];
    const lo = Math.max(min, prev - maxInterval);
    const hi = Math.min(max, prev + maxInterval);
    const pool = allNotesInRange(lo, hi).filter((m) => m !== prev);
    if (pool.length === 0) {
      seq.push(pickRandomNote(min, max, prev));
    } else {
      seq.push(pool[Math.floor(Math.random() * pool.length)]);
    }
  }
  return seq;
}

export function centsOff(freq, targetMidi) {
  const targetFreq = midiToFreq(targetMidi);
  return 1200 * Math.log2(freq / targetFreq);
}

export function midiFromFreqWithCents(freq, centsTolerance = 40) {
  const midi = Math.round(freqToMidi(freq));
  const cents = centsOff(freq, midi);
  if (Math.abs(cents) <= centsTolerance) return midi;
  return null;
}
