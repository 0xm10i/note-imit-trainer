import { nameToMidi } from './notes.js';

export const DEFAULTS = {
  notesPerSet: 100,
  strings: 5,
  lowestNote: 'B0',
  highestNote: 'G2',
  frets: 22,
  noiseGate: 0.015,
  centsTolerance: 40,
  showLiveDetection: false,
  inputDeviceId: '',
};

const STORAGE_KEY = 'note-imit-trainer-settings';
const LAST_SESSION_KEY = 'note-imit-trainer-last-session';

export function loadSettings() {
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
    strings: parseInt(fd.get('strings'), 10),
    lowestNote: String(fd.get('lowestNote')).trim(),
    highestNote: String(fd.get('highestNote')).trim(),
    frets: parseInt(fd.get('frets'), 10),
    noiseGate: parseFloat(fd.get('noiseGate')),
    centsTolerance: parseInt(fd.get('centsTolerance'), 10),
    showLiveDetection: form.showLiveDetection.checked,
    inputDeviceId: String(fd.get('inputDeviceId') || ''),
  };
}

export function fillForm(form, settings) {
  form.notesPerSet.value = settings.notesPerSet;
  form.strings.value = settings.strings;
  form.lowestNote.value = settings.lowestNote;
  form.highestNote.value = settings.highestNote;
  form.frets.value = settings.frets;
  form.noiseGate.value = settings.noiseGate;
  form.centsTolerance.value = settings.centsTolerance;
  form.showLiveDetection.checked = settings.showLiveDetection;
  if (form.inputDeviceId) form.inputDeviceId.value = settings.inputDeviceId;
}

export function saveLastSession(results) {
  localStorage.setItem(LAST_SESSION_KEY, JSON.stringify({ ...results, savedAt: Date.now() }));
}

export function loadLastSession() {
  try {
    const raw = localStorage.getItem(LAST_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
