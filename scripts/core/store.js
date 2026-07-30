export function createStore(initialState) {
  let state = structuredClone(initialState);
  const listeners = new Set();
  return {
    getState: () => state,
    setState(update) {
      const next = typeof update === "function" ? update(state) : update;
      if (next === state) return;
      state = { ...state, ...next };
      listeners.forEach((listener) => listener(state));
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
  };
}
