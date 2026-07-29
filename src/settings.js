import { nameToMidi } from './notes.js';

export const DEFAULTS = {
  notesPerSet: 100,
  lowestNote: 'B0',
  highestNote: 'G2',
  frets: 22,
  maxIntervalSemitones: 7,
  noiseGate: 0.015,
  inputGain: 3,
  centsTolerance: 40,
  showLiveDetection: false,
  inputDeviceId: '',
  playbackVolume: 1,
  metronomeVolume: 1,
};

const STORAGE_KEY = 'bass-tools-settings';
const LAST_SESSION_KEY = 'bass-tools-last-session';
const LEGACY_STORAGE_KEY = 'note-imit-trainer-settings';
const LEGACY_LAST_SESSION_KEY = 'note-imit-trainer-last-session';

function migrateStorageKey(newKey, legacyKey) {
  if (localStorage.getItem(newKey) != null) return;
  const legacy = localStorage.getItem(legacyKey);
  if (legacy == null) return;
  localStorage.setItem(newKey, legacy);
  localStorage.removeItem(legacyKey);
}

export function loadSettings() {
  migrateStorageKey(STORAGE_KEY, LEGACY_STORAGE_KEY);
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function settingsToMidi(settings) {
  return {
    ...settings,
    lowestMidi: nameToMidi(settings.lowestNote),
    highestMidi: nameToMidi(settings.highestNote),
  };
}

export function readForm(form) {
  const fd = new FormData(form);
  return {
    notesPerSet: parseInt(fd.get('notesPerSet'), 10),
    lowestNote: String(fd.get('lowestNote')).trim(),
    highestNote: String(fd.get('highestNote')).trim(),
    frets: parseInt(fd.get('frets'), 10),
    maxIntervalSemitones: Math.min(24, Math.max(1, parseInt(fd.get('maxIntervalSemitones'), 10))),
    noiseGate: parseFloat(fd.get('noiseGate')),
    inputGain: Math.min(8, Math.max(0.5, parseFloat(fd.get('inputGain')) || 3)),
    centsTolerance: parseInt(fd.get('centsTolerance'), 10),
    showLiveDetection: form.showLiveDetection.checked,
    inputDeviceId: String(fd.get('inputDeviceId') || ''),
    playbackVolume: Math.min(2, Math.max(0, parseFloat(fd.get('playbackVolume')) || 1)),
  };
}

export function fillForm(form, settings) {
  form.notesPerSet.value = settings.notesPerSet;
  form.lowestNote.value = settings.lowestNote;
  form.highestNote.value = settings.highestNote;
  form.frets.value = settings.frets;
  form.maxIntervalSemitones.value = settings.maxIntervalSemitones;
  form.noiseGate.value = settings.noiseGate;
  if (form.inputGain) form.inputGain.value = settings.inputGain;
  form.centsTolerance.value = settings.centsTolerance;
  form.showLiveDetection.checked = settings.showLiveDetection;
  if (form.inputDeviceId) form.inputDeviceId.value = settings.inputDeviceId;
  if (form.playbackVolume) form.playbackVolume.value = settings.playbackVolume;
}

export function saveLastSession(results) {
  localStorage.setItem(LAST_SESSION_KEY, JSON.stringify({ ...results, savedAt: Date.now() }));
}

export function loadLastSession() {
  migrateStorageKey(LAST_SESSION_KEY, LEGACY_LAST_SESSION_KEY);
  try {
    const raw = localStorage.getItem(LAST_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
