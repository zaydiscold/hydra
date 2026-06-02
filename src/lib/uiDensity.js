const STORAGE_KEY = 'hydra.uiDensity';
const CHANGE_EVENT = 'hydra-ui-density-change';
const VALID_DENSITIES = new Set(['comfortable', 'compact']);

export function getStoredUiDensity() {
  if (typeof window === 'undefined') return 'comfortable';
  const value = window.localStorage?.getItem(STORAGE_KEY);
  return VALID_DENSITIES.has(value) ? value : 'comfortable';
}

export function setStoredUiDensity(density) {
  const value = VALID_DENSITIES.has(density) ? density : 'comfortable';
  window.localStorage?.setItem(STORAGE_KEY, value);
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { density: value } }));
  return value;
}

export function subscribeUiDensity(listener) {
  const onChange = (event) => listener(event.detail?.density || getStoredUiDensity());
  const onStorage = (event) => {
    if (event.key === STORAGE_KEY) listener(getStoredUiDensity());
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
}

