import { midiFromFreqWithCents } from './notes.js';

const DEFAULT_FFT = 32768;
const DECIMATE = 2;

function rms(buffer) {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
  return Math.sqrt(sum / buffer.length);
}

/**
 * McLeod Pitch Method (MPM) on a decimated buffer.
 * Returns { freq, clarity } or null.
 */
export function detectPitchMpm(samples, sampleRate, minFreq = 25, maxFreq = 400) {
  const n = samples.length;
  if (n < 64) return null;

  const floor = Math.floor(sampleRate / 800); // max ~800 Hz for bass range upper harmonics
  const ceil = Math.floor(sampleRate / 25); // min ~25 Hz
  if (ceil <= floor + 2) return null;

  const nsdf = new Float32Array(ceil);
  for (let tau = floor; tau < ceil; tau++) {
    let ac = 0;
    let m0 = 0;
    let mTau = 0;
    const limit = n - tau;
    for (let i = 0; i < limit; i++) {
      const a = samples[i];
      const b = samples[i + tau];
      ac += a * b;
      m0 += a * a;
      mTau += b * b;
    }
    const denom = m0 + mTau;
    nsdf[tau] = denom > 0 ? (2 * ac) / denom : 0;
  }

  let maxVal = -1;
  for (let tau = floor; tau < ceil; tau++) {
    if (nsdf[tau] > maxVal) maxVal = nsdf[tau];
  }
  if (maxVal < 0.25) return null;

  const threshold = maxVal * 0.9;

  const peaks = [];
  for (let t = floor + 1; t < ceil - 1; t++) {
    const isPeak = nsdf[t] >= nsdf[t - 1] && nsdf[t] >= nsdf[t + 1];
    if (isPeak && nsdf[t] >= threshold) peaks.push({ tau: t, clarity: nsdf[t] });
  }
  if (peaks.length === 0) {
    let tau = floor;
    while (tau < ceil - 1 && nsdf[tau] < threshold) tau++;
    while (tau + 1 < ceil && nsdf[tau + 1] > nsdf[tau]) tau++;
    peaks.push({ tau, clarity: nsdf[tau] });
  }

  let bestFreq = null;
  let bestClarity = -1;
  for (const peak of peaks) {
    const baseFreq = sampleRate / peak.tau;
    for (let k = -5; k <= 5; k++) {
      const f = baseFreq * 2 ** k;
      if (f < minFreq || f > maxFreq) continue;
      const tau = Math.round(sampleRate / f);
      if (tau < floor || tau >= ceil) continue;
      const clarity = nsdf[tau];
      const score = clarity * (1 + 0.12 * Math.log2(f / minFreq));
      if (score > bestClarity) {
        bestClarity = score;
        bestFreq = f;
      }
    }
  }

  if (bestFreq == null || bestClarity < 0.25) return null;
  return { freq: bestFreq, clarity: bestClarity };
}


function lowPassDecimate(timeDomain, factor) {
  const outLen = Math.floor(timeDomain.length / factor);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const base = i * factor;
    let sum = 0;
    let count = 0;
    for (let k = -2; k <= 2; k++) {
      const idx = base + k;
      if (idx >= 0 && idx < timeDomain.length) {
        sum += timeDomain[idx];
        count++;
      }
    }
    out[i] = sum / count;
  }
  return out;
}

export function detectPitchFromTimeDomain(timeDomain, sampleRate, minFreq = 25, maxFreq = 400) {
  const decimated = lowPassDecimate(timeDomain, DECIMATE);
  const sr = sampleRate / DECIMATE;
  const result = detectPitchMpm(decimated, sr, minFreq, maxFreq);
  if (!result) return null;
  return result;
}

export class PitchListener {
  constructor(options = {}) {
    this.noiseGate = options.noiseGate ?? 0.015;
    this.centsTolerance = options.centsTolerance ?? 40;
    this.minFreq = options.minFreq ?? 25;
    this.maxFreq = options.maxFreq ?? 400;
    this.stableFramesRequired = options.stableFramesRequired ?? 5;

    this.stream = null;
    this.analyser = null;
    this.audioContext = null;
    this.buffer = null;
    this.gated = false;

    this._stableMidi = null;
    this._stableCount = 0;
    this._lastMidi = null;
    this._onStable = null;
    this._onWrong = null;
    this._raf = null;
    this.rmsLevel = 0;
    this.lastDetectedMidi = null;
    this.lastFreq = null;
  }

  async start(deviceId) {
    const constraints = {
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      },
    };
    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = this.audioContext.createMediaStreamSource(this.stream);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = DEFAULT_FFT;
    this.buffer = new Float32Array(this.analyser.fftSize);
    source.connect(this.analyser);
    this._loop();
  }

  stop() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    if (!this.stream && !this.audioContext) return;
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop();
      this.stream = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.analyser = null;
    this.buffer = null;
  }

  setGated(gated) {
    this.gated = gated;
    if (gated) {
      this._stableMidi = null;
      this._stableCount = 0;
      this._lastMidi = null;
    }
  }

  resetStability() {
    this._stableMidi = null;
    this._stableCount = 0;
    this._lastMidi = null;
  }

  onStable(cb) {
    this._onStable = cb;
  }

  onWrong(cb) {
    this._onWrong = cb;
  }

  _loop() {
    if (!this.analyser || !this.buffer) return;
    this.analyser.getFloatTimeDomainData(this.buffer);
    const level = rms(this.buffer);
    this.rmsLevel = level;

    if (!this.gated && level >= this.noiseGate) {
      const sr = this.audioContext.sampleRate;
      const pitch = detectPitchFromTimeDomain(this.buffer, sr, this.minFreq, this.maxFreq);
      if (pitch) {
        this.lastFreq = pitch.freq;
        const midi = midiFromFreqWithCents(pitch.freq, this.centsTolerance);
        this.lastDetectedMidi = midi;
        if (midi !== null) {
          if (midi === this._lastMidi) {
            this._stableCount++;
          } else {
            this._lastMidi = midi;
            this._stableCount = 1;
          }
          if (this._stableCount >= this.stableFramesRequired && midi !== this._stableMidi) {
            this._stableMidi = midi;
            if (this._onStable) this._onStable(midi);
          }
        }
      } else {
        this._lastMidi = null;
        this._stableCount = 0;
        this.lastDetectedMidi = null;
      }
    } else if (level < this.noiseGate * 0.6) {
      this._lastMidi = null;
      this._stableCount = 0;
    }

    this._raf = requestAnimationFrame(() => this._loop());
  }

  /** Consume a stable detection once (for session to avoid double-fire). */
  consumeStable(midi) {
    if (this._stableMidi === midi) {
      this._stableMidi = null;
      this._lastMidi = null;
      this._stableCount = 0;
    }
  }
}

export async function listAudioInputDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === 'audioinput');
}

/** Synthesize bass-like waveform for offline pitch verification. */
export function synthesizeBassLikeTone(midi, length, sampleRate) {
  const freq = 440 * 2 ** ((midi - 69) / 12);
  const buf = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const f0 = Math.sin(2 * Math.PI * freq * t) * 0.35;
    const h2 = Math.sin(2 * Math.PI * freq * 2 * t) * 0.25;
    const h3 = Math.sin(2 * Math.PI * freq * 3 * t) * 0.15;
    buf[i] = f0 + h2 + h3;
  }
  return buf;
}

export function verifyPitchDetectionAcrossRange(minMidi, maxMidi) {
  const sampleRate = 48000;
  const windowLen = 16384;
  const failures = [];
  for (let midi = minMidi; midi <= maxMidi; midi += 12) {
    const samples = synthesizeBassLikeTone(midi, windowLen, sampleRate);
    const detected = detectPitchFromTimeDomain(samples, sampleRate, 25, 400);
    const expectedFreq = 440 * 2 ** ((midi - 69) / 12);
    if (!detected || Math.abs(detected.freq - expectedFreq) / expectedFreq > 0.03) {
      failures.push({ midi, expectedFreq, detected });
    }
  }
  return failures;
}
