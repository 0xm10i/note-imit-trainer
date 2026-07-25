let ctx = null;

export function getAudioContext() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  return ctx;
}

export async function resumeAudioContext() {
  const ac = getAudioContext();
  if (ac.state === 'suspended') await ac.resume();
  return ac;
}

/**
 * Harmonically rich tone for ear training (fundamental + harmonics, ADSR).
 * @returns {Promise<void>} resolves when playback envelope finishes
 */
export function playNote(midi, durationSec = 1.2) {
  const ac = getAudioContext();
  const now = ac.currentTime;
  const freq = 440 * 2 ** ((midi - 69) / 12);

  const master = ac.createGain();
  master.gain.setValueAtTime(0, now);
  master.gain.linearRampToValueAtTime(0.35, now + 0.02);
  master.gain.setValueAtTime(0.35, now + durationSec - 0.15);
  master.gain.exponentialRampToValueAtTime(0.001, now + durationSec);
  master.connect(ac.destination);

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
    osc.stop(now + durationSec + 0.05);
  }

  return new Promise((resolve) => {
    setTimeout(resolve, durationSec * 1000 + 50);
  });
}
