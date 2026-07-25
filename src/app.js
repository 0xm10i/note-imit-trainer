import { createSession } from './session.js';
import {
  loadSettings,
  saveSettings,
  settingsToMidi,
  readForm,
  fillForm,
  saveLastSession,
} from './settings.js';
import { midiToName } from './notes.js';
import { resumeAudioContext } from './audio.js';
import { listAudioInputDevices as listDevices } from './pitch.js';

const viewHome = document.getElementById('view-home');
const viewPractice = document.getElementById('view-practice');
const viewResults = document.getElementById('view-results');
const settingsForm = document.getElementById('settings-form');
const btnStart = document.getElementById('btn-start');
const btnToggleSettings = document.getElementById('btn-toggle-settings');
const btnStop = document.getElementById('btn-stop');
const btnHome = document.getElementById('btn-home');
const practiceProgress = document.getElementById('practice-progress');
const practiceStatus = document.getElementById('practice-status');
const practiceReveal = document.getElementById('practice-reveal');
const practiceLive = document.getElementById('practice-live');
const micMeter = document.getElementById('mic-meter');
const resultsSummary = document.getElementById('results-summary');
const resultsPerNote = document.getElementById('results-per-note');
const settingsSaved = document.getElementById('settings-saved');
const inputDeviceSelect = document.getElementById('input-device-select');

let settings = loadSettings();
let activeSession = null;
let meterRaf = null;

function showView(name) {
  const map = { home: viewHome, practice: viewPractice, results: viewResults };
  for (const [key, el] of Object.entries(map)) {
    const active = key === name;
    el.classList.toggle('view-active', active);
    el.hidden = !active;
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

function updatePracticeUi(payload) {
  const midiSettings = settingsToMidi(settings);
  practiceProgress.textContent = `${payload.progress ?? 0} / ${midiSettings.notesPerSet}`;

  if (payload.state === 'playing') {
    practiceStatus.textContent = 'Listen…';
    practiceReveal.classList.add('hidden');
  } else if (payload.state === 'listening') {
    practiceStatus.textContent = 'Play the note';
    practiceReveal.classList.add('hidden');
  } else if (payload.state === 'wrong') {
    practiceStatus.textContent = 'Not quite — listen again';
    practiceReveal.classList.add('hidden');
  } else if (payload.state === 'correct') {
    practiceStatus.textContent = 'Correct!';
    practiceReveal.textContent = payload.revealedName;
    practiceReveal.classList.remove('hidden');
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
    <dt>Notes completed</dt><dd>${results.completed}</dd>
    <dt>First-try accuracy</dt><dd>${results.firstTryPct.toFixed(1)}%</dd>
    <dt>Avg. time per note</dt><dd>${(results.avgTimeMs / 1000).toFixed(1)}s</dd>
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

btnStart.addEventListener('click', async () => {
  try {
    await resumeAudioContext();
    const midiSettings = settingsToMidi(settings);
    showView('practice');
    practiceReveal.classList.add('hidden');
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
});

btnStop.addEventListener('click', async () => {
  if (activeSession) {
    await activeSession.stop();
    activeSession = null;
  }
  stopMeter();
  showView('home');
});

btnHome.addEventListener('click', () => showView('home'));

bindSettings();
