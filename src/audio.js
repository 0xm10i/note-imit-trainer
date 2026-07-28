let ctx = null;
let outputGain = null;
let metronomeGain = null;
let drumGain = null;

const PLAYBACK_VOLUME_MIN = 0;
const PLAYBACK_VOLUME_MAX = 2;

export function getAudioContext() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  return ctx;
}

function getOutputGain() {
  const ac = getAudioContext();
  if (!outputGain) {
    outputGain = ac.createGain();
    outputGain.gain.value = 1;
    outputGain.connect(ac.destination);
  }
  return outputGain;
}

function getMetronomeGain() {
  const ac = getAudioContext();
  if (!metronomeGain) {
    metronomeGain = ac.createGain();
    metronomeGain.gain.value = 1;
    metronomeGain.connect(getOutputGain());
  }
  return metronomeGain;
}

export function setPlaybackVolume(linear) {
  const v = Math.min(PLAYBACK_VOLUME_MAX, Math.max(PLAYBACK_VOLUME_MIN, linear));
  const g = getOutputGain();
  g.gain.setValueAtTime(v, g.context.currentTime);
  return v;
}

export function setMetronomeVolume(linear) {
  const v = Math.min(PLAYBACK_VOLUME_MAX, Math.max(PLAYBACK_VOLUME_MIN, linear));
  const g = getMetronomeGain();
  g.gain.setValueAtTime(v, g.context.currentTime);
  return v;
}

function getDrumGain() {
  const ac = getAudioContext();
  if (!drumGain) {
    drumGain = ac.createGain();
    drumGain.gain.value = 1;
    drumGain.connect(getOutputGain());
  }
  return drumGain;
}

export function setDrumVolume(linear) {
  const v = Math.min(PLAYBACK_VOLUME_MAX, Math.max(PLAYBACK_VOLUME_MIN, linear));
  const g = getDrumGain();
  g.gain.setValueAtTime(v, g.context.currentTime);
  return v;
}

function scheduleNoiseBurst(ac, when, duration, peak, filterType, filterFreq, filterQ) {
  const bufferSize = Math.ceil(ac.sampleRate * duration) + 1;
  const buffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i += 1) {
    data[i] = Math.random() * 2 - 1;
  }

  const source = ac.createBufferSource();
  source.buffer = buffer;

  const filter = ac.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.value = filterFreq;
  filter.Q.value = filterQ;

  const gain = ac.createGain();
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(peak, when + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.001, when + duration);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(getDrumGain());
  source.start(when);
  source.stop(when + duration + 0.02);
}

/**
 * @param {'kick'|'snare'|'hhClosed'} voice
 * @param {number} when AudioContext time
 */
export function scheduleDrumHit(voice, when) {
  const ac = getAudioContext();

  if (voice === 'kick') {
    const duration = 0.35;
    const end = when + duration;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(0.85, when + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.001, end);
    gain.connect(getDrumGain());

    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, when);
    osc.frequency.exponentialRampToValueAtTime(50, when + 0.08);
    osc.connect(gain);
    osc.start(when);
    osc.stop(end + 0.02);
    return;
  }

  if (voice === 'snare') {
    scheduleNoiseBurst(ac, when, 0.18, 0.45, 'bandpass', 1800, 0.8);
    const bodyEnd = when + 0.12;
    const body = ac.createGain();
    body.gain.setValueAtTime(0, when);
    body.gain.linearRampToValueAtTime(0.25, when + 0.003);
    body.gain.exponentialRampToValueAtTime(0.001, bodyEnd);
    body.connect(getDrumGain());
    const osc = ac.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 180;
    osc.connect(body);
    osc.start(when);
    osc.stop(bodyEnd + 0.01);
    return;
  }

  if (voice === 'hhClosed') {
    scheduleNoiseBurst(ac, when, 0.05, 0.22, 'highpass', 7000, 0.7);
  }
}

export async function resumeAudioContext() {
  const ac = getAudioContext();
  if (ac.state === 'suspended') await ac.resume();
  return ac;
}

/**
 * Harmonically rich tone for ear training (fundamental + harmonics, ADSR).
 * @returns {Promise<void>} resolves when playback envelope finishes on the audio timeline
 */
export function playNote(midi, durationSec = 1.2) {
  const ac = getAudioContext();
  const now = ac.currentTime;
  const endTime = now + durationSec + 0.05;
  const freq = 440 * 2 ** ((midi - 69) / 12);

  const master = ac.createGain();
  master.gain.setValueAtTime(0, now);
  master.gain.linearRampToValueAtTime(0.35, now + 0.02);
  master.gain.setValueAtTime(0.35, now + durationSec - 0.15);
  master.gain.exponentialRampToValueAtTime(0.001, now + durationSec);
  master.connect(getOutputGain());

  const harmonics = [
    { n: 1, gain: 1 },
    { n: 2, gain: 0.45 },
    { n: 3, gain: 0.28 },
    { n: 4, gain: 0.18 },
    { n: 5, gain: 0.12 },
    { n: 6, gain: 0.08 },
  ];

  for (const { n, gain } of harmonics) {
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq * n;
    const g = ac.createGain();
    g.gain.value = gain / harmonics.length;
    osc.connect(g);
    g.connect(master);
    osc.start(now);
    osc.stop(endTime);
  }

  return new Promise((resolve) => {
    const delayMs = Math.max(0, (endTime - ac.currentTime) * 1000);
    setTimeout(resolve, delayMs);
  });
}

/**
 * Short success bell (quiet, inharmonic partials).
 * @returns {Promise<void>}
 */
export function playSuccessBell(durationSec = 0.65) {
  const ac = getAudioContext();
  const now = ac.currentTime;
  const endTime = now + durationSec + 0.05;
  const baseFreq = 440 * 2 ** ((84 - 69) / 12);

  const master = ac.createGain();
  master.gain.setValueAtTime(0, now);
  master.gain.linearRampToValueAtTime(0.22, now + 0.008);
  master.gain.exponentialRampToValueAtTime(0.001, now + durationSec);
  master.connect(getOutputGain());

  const partials = [
    { ratio: 1, gain: 1 },
    { ratio: 2, gain: 0.35 },
    { ratio: 2.4, gain: 0.2 },
  ];

  for (const { ratio, gain } of partials) {
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = baseFreq * ratio;
    const g = ac.createGain();
    g.gain.value = gain / partials.length;
    osc.connect(g);
    g.connect(master);
    osc.start(now);
    osc.stop(endTime);
  }

  const osc2 = ac.createOscillator();
  osc2.type = 'sine';
  osc2.frequency.value = 440 * 2 ** ((88 - 69) / 12);
  const g2 = ac.createGain();
  g2.gain.value = 0.12;
  osc2.connect(g2);
  g2.connect(master);
  osc2.start(now);
  osc2.stop(endTime);

  return new Promise((resolve) => {
    const delayMs = Math.max(0, (endTime - ac.currentTime) * 1000);
    setTimeout(resolve, delayMs);
  });
}

/**
 * Metronome click scheduled on the audio timeline.
 * @param {boolean} accent
 * @param {number} when AudioContext time
 */
export function scheduleMetronomeClick(accent, when) {
  const ac = getAudioContext();
  const duration = 0.045;
  const end = when + duration;
  const freq = accent ? 1200 : 800;
  const peak = accent ? 0.32 : 0.2;

  const gain = ac.createGain();
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(peak, when + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.001, end);
  gain.connect(getMetronomeGain());

  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = freq;
  osc.connect(gain);
  osc.start(when);
  osc.stop(end + 0.01);
}
