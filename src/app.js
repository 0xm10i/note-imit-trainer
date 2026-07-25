import { createSession } from './session.js';
import { createTuner } from './tuner.js';
import {
  loadSettings,
  saveSettings,
  settingsToMidi,
  readForm,
  fillForm,
  saveLastSession,
} from './settings.js';
import {
  midiToName,
  midiToFreq,
  buildTuning,
  playableRange,
  TUNING_STRING_COUNT,
} from './notes.js';
import { resumeAudioContext } from './audio.js';
import { listAudioInputDevices as listDevices } from './pitch.js';

const viewHome = document.getElementById('view-home');
const viewPractice = document.getElementById('view-practice');
const viewTuner = document.getElementById('view-tuner');
const viewResults = document.getElementById('view-results');
const settingsForm = document.getElementById('settings-form');
const btnToggleSettings = document.getElementById('btn-toggle-settings');
const btnTuner = document.getElementById('btn-tuner');
const btnTunerBack = document.getElementById('btn-tuner-back');
const btnStop = document.getElementById('btn-stop');
const btnHome = document.getElementById('btn-home');
const practiceProgress = document.getElementById('practice-progress');
const practiceStatus = document.getElementById('practice-status');
const practiceSequence = document.getElementById('practice-sequence');
const practiceHint = document.getElementById('practice-hint');
const practiceReveal = document.getElementById('practice-reveal');
const practiceLive = document.getElementById('practice-live');
const micMeter = document.getElementById('mic-meter');
const tunerNote = document.getElementById('tuner-note');
const tunerCents = document.getElementById('tuner-cents');
const tunerFreq = document.getElementById('tuner-freq');
const tunerNeedle = document.getElementById('tuner-needle');
const tunerMeter = document.getElementById('tuner-meter');
const tunerCard = document.querySelector('.tuner-card');
const resultsSummary = document.getElementById('results-summary');
const resultsPerNote = document.getElementById('results-per-note');
const settingsSaved = document.getElementById('settings-saved');
const inputDeviceSelect = document.getElementById('input-device-select');

let settings = loadSettings();
let activeSession = null;
let activeTuner = null;
let activeNoteCount = 1;
let meterRaf = null;

function showView(name) {
  const map = { home: viewHome, practice: viewPractice, tuner: viewTuner, results: viewResults };
  for (const [key, el] of Object.entries(map)) {
    const active = key === name;
    el.classList.toggle('view-active', active);
    el.hidden = !active;
  }
}

function tunerFreqBounds() {
  const ms = settingsToMidi(settings);
  const tuning = buildTuning({
    strings: TUNING_STRING_COUNT,
    lowestMidi: ms.lowestMidi,
    highestMidi: ms.highestMidi,
  });
  const { min, max } = playableRange({ tuning, frets: settings.frets });
  return {
    minFreq: Math.max(25, midiToFreq(min) * 0.94),
    maxFreq: Math.min(800, midiToFreq(max) * 1.06),
  };
}

function resetTunerUi() {
  tunerNote.textContent = '—';
  tunerCents.textContent = '';
  tunerFreq.textContent = '';
  tunerNeedle.style.left = '50%';
  tunerMeter.style.width = '0%';
  tunerCard.classList.remove('in-tune');
}

function updateTunerUi(reading) {
  const level = Math.min(1, reading.level * 25);
  tunerMeter.style.width = `${level * 100}%`;

  if (reading.silent) {
    tunerNote.textContent = '—';
    tunerCents.textContent = '';
    tunerFreq.textContent = '';
    tunerNeedle.style.left = '50%';
    tunerCard.classList.remove('in-tune');
    return;
  }

  tunerNote.textContent = reading.name;
  const sign = reading.cents >= 0 ? '+' : '';
  tunerCents.textContent = `${sign}${reading.cents.toFixed(0)} ¢`;
  tunerFreq.textContent = `${reading.freq.toFixed(1)} Hz`;
  const clamped = Math.max(-50, Math.min(50, reading.cents));
  tunerNeedle.style.left = `${50 + clamped}%`;
  tunerCard.classList.toggle('in-tune', reading.inTune);
}

function stopTuner() {
  if (activeTuner) {
    activeTuner.stop();
    activeTuner = null;
  }
  resetTunerUi();
}

async function startTuner() {
  try {
    showView('tuner');
    resetTunerUi();
    const { minFreq, maxFreq } = tunerFreqBounds();
    activeTuner = createTuner(
      {
        noiseGate: settings.noiseGate,
        inputDeviceId: settings.inputDeviceId,
        minFreq,
        maxFreq,
      },
      { onReading: updateTunerUi },
    );
    await activeTuner.start();
  } catch (err) {
    stopTuner();
    showView('home');
    alert(err.message || 'Could not start tuner. Check microphone permission.');
  }
}

function formatDuration(ms) {
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

async function populateDevices() {
  try {
    await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    /* labels may be empty until permission */
  }
  const devices = await listDevices();
  inputDeviceSelect.innerHTML = '<option value="">Default</option>';
  for (const d of devices) {
    const opt = document.createElement('option');
    opt.value = d.deviceId;
    opt.textContent = d.label || `Microphone ${inputDeviceSelect.length}`;
    inputDeviceSelect.appendChild(opt);
  }
  inputDeviceSelect.value = settings.inputDeviceId || '';
}

function bindSettings() {
  fillForm(settingsForm, settings);
  populateDevices();
}

settingsForm.addEventListener('submit', (e) => {
  e.preventDefault();
  try {
    settings = readForm(settingsForm);
    saveSettings(settings);
    settingsSaved.classList.remove('hidden');
    setTimeout(() => settingsSaved.classList.add('hidden'), 2000);
  } catch (err) {
    alert(err.message || 'Invalid settings');
  }
});

btnToggleSettings.addEventListener('click', () => {
  settingsForm.classList.toggle('hidden');
});

function clearPracticeHint() {
  practiceHint.innerHTML = '';
  practiceHint.removeAttribute('aria-label');
  practiceHint.classList.add('hidden');
}

const HINT_LABELS = {
  correct: 'correct',
  up: 'higher',
  down: 'lower',
  same: 'same pitch',
};

const HINT_SYMBOLS = {
  correct: '✓',
  up: '↑',
  down: '↓',
  same: '=',
};

function renderHints(hints) {
  if (!hints || hints.length === 0) {
    clearPracticeHint();
    return;
  }
  practiceHint.innerHTML = '';
  const labels = [];
  hints.forEach((kind, i) => {
    const span = document.createElement('span');
    span.className = 'hint-slot';
    if (kind === 'correct') span.classList.add('hint-correct');
    span.textContent = HINT_SYMBOLS[kind] || '?';
    practiceHint.appendChild(span);
    labels.push(`note ${i + 1} ${HINT_LABELS[kind] || kind}`);
  });
  practiceHint.setAttribute('aria-label', labels.join(', '));
  practiceHint.classList.remove('hidden');
}

function updateSequenceProgress(noteCount, targetIndex, state) {
  if (noteCount <= 1) {
    practiceSequence.classList.add('hidden');
    practiceSequence.textContent = '';
    return;
  }
  if (state === 'listening' || state === 'sequence-progress' || state === 'wrong') {
    const pos = state === 'listening' ? targetIndex + 1 : Math.min(targetIndex + 1, noteCount);
    practiceSequence.textContent = `Note ${pos} of ${noteCount}`;
    practiceSequence.classList.remove('hidden');
  } else if (state === 'playing') {
    practiceSequence.textContent = `Listen to ${noteCount} notes`;
    practiceSequence.classList.remove('hidden');
  } else {
    practiceSequence.classList.add('hidden');
  }
}

function updatePracticeUi(payload) {
  const midiSettings = settingsToMidi(settings);
  const noteCount = payload.noteCount ?? activeNoteCount;
  practiceProgress.textContent = `${payload.progress ?? 0} / ${midiSettings.notesPerSet}`;

  updateSequenceProgress(noteCount, payload.targetIndex ?? 0, payload.state);

  if (payload.state === 'pick') {
    clearPracticeHint();
    practiceReveal.classList.add('hidden');
  } else if (payload.state === 'playing') {
    practiceStatus.textContent = noteCount > 1 ? 'Listen…' : 'Listen…';
    practiceReveal.classList.add('hidden');
    renderHints(payload.hints);
  } else if (payload.state === 'listening') {
    practiceStatus.textContent = noteCount > 1 ? 'Play the sequence' : 'Play the note';
    practiceReveal.classList.add('hidden');
    clearPracticeHint();
  } else if (payload.state === 'sequence-progress') {
    practiceStatus.textContent = noteCount > 1 ? 'Play the sequence' : 'Play the note';
    if (payload.partialReveal) {
      practiceReveal.textContent = payload.acceptedNames?.join(' · ') ?? payload.partialReveal;
      practiceReveal.classList.remove('hidden');
    }
  } else if (payload.state === 'wrong') {
    practiceStatus.textContent = 'Not quite — listen again';
    practiceReveal.classList.add('hidden');
    clearPracticeHint();
  } else if (payload.state === 'correct') {
    practiceStatus.textContent = 'Correct!';
    clearPracticeHint();
    const names = payload.revealedNames ?? [];
    practiceReveal.textContent = names.length ? names.join(' · ') : '';
    practiceReveal.classList.remove('hidden');
    practiceSequence.classList.add('hidden');
  }
}

function startMeter(listener) {
  const tick = () => {
    if (!activeSession) return;
    const level = Math.min(1, listener.rmsLevel * 25);
    micMeter.style.width = `${level * 100}%`;
    if (settings.showLiveDetection && listener.lastDetectedMidi != null) {
      practiceLive.textContent = `Detected: ${midiToName(listener.lastDetectedMidi)}`;
      practiceLive.classList.remove('hidden');
    } else if (!settings.showLiveDetection) {
      practiceLive.classList.add('hidden');
    }
    meterRaf = requestAnimationFrame(tick);
  };
  meterRaf = requestAnimationFrame(tick);
}

function stopMeter() {
  if (meterRaf) cancelAnimationFrame(meterRaf);
  meterRaf = null;
  micMeter.style.width = '0%';
}

function renderResults(results) {
  resultsSummary.innerHTML = `
    <dt>Total time</dt><dd>${formatDuration(results.totalTimeMs)}</dd>
    <dt>Sequences completed</dt><dd>${results.completed}</dd>
    <dt>First-try accuracy</dt><dd>${results.firstTryPct.toFixed(1)}%</dd>
    <dt>Avg. time per sequence</dt><dd>${(results.avgTimeMs / 1000).toFixed(1)}s</dd>
    <dt>Wrong attempts</dt><dd>${results.wrongAttempts}</dd>
    <dt>Longest streak</dt><dd>${results.longestStreak}</dd>
  `;
  resultsPerNote.innerHTML = '';
  const top = results.perNote.filter((n) => n.wrongAttempts > 0).slice(0, 12);
  if (top.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'No wrong attempts — perfect run!';
    resultsPerNote.appendChild(li);
  } else {
    for (const row of top) {
      const li = document.createElement('li');
      li.innerHTML = `<span>${row.name}</span><span class="wrong">${row.wrongAttempts} miss${row.wrongAttempts === 1 ? '' : 'es'}</span>`;
      resultsPerNote.appendChild(li);
    }
  }
}

async function startPractice(noteCount) {
  stopTuner();
  try {
    await resumeAudioContext();
    activeNoteCount = noteCount;
    const midiSettings = { ...settingsToMidi(settings), noteCount };
    showView('practice');
    practiceReveal.classList.add('hidden');
    clearPracticeHint();
    practiceSequence.classList.add('hidden');
    practiceStatus.textContent = 'Starting…';

    activeSession = createSession(midiSettings, {
      onStateChange: updatePracticeUi,
      onCorrect: () => {},
      onWrong: () => {},
      onFinished: (results) => {
        saveLastSession(results);
        stopMeter();
        activeSession = null;
        renderResults(results);
        showView('results');
      },
    });

    startMeter(activeSession.getListener());
    await activeSession.start();
  } catch (err) {
    activeSession = null;
    stopMeter();
    showView('home');
    alert(err.message || 'Could not start practice. Check microphone permission.');
  }
}

for (const btn of document.querySelectorAll('.btn-start')) {
  btn.addEventListener('click', () => {
    const count = parseInt(btn.getAttribute('data-note-count'), 10);
    void startPractice(count);
  });
}

btnStop.addEventListener('click', async () => {
  if (activeSession) {
    await activeSession.stop();
    activeSession = null;
  }
  stopMeter();
  showView('home');
});

btnHome.addEventListener('click', () => showView('home'));

btnTuner.addEventListener('click', () => {
  void startTuner();
});

btnTunerBack.addEventListener('click', () => {
  stopTuner();
  showView('home');
});

bindSettings();
