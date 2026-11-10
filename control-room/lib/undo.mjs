// In-memory undo stack for control-room saves. save() pushes {label, before} (the document as it was
// before the save); the toast's Undo pops it and saves `before` again as 'Undo: ' + label.
// It lives only in memory: a reload starts empty, and a 409 conflict (a teammate saved) must clear()
// it, because the stored documents are then out of date.
// `before` is kept by reference: the caller must not mutate it afterwards (app.js always edits a clone).
export function createUndo(limit = 20) {
  const max = Math.max(1, Math.floor(Number(limit)) || 20);
  let stack = [];
  const listeners = new Set();
  const emit = () => { for (const fn of listeners) try { fn(stack.length); } catch { /* a listener must not break saving */ } };
  return {
    push(label, before) {
      if (before === undefined || before === null) return stack.length;
      stack.push({label: String(label ?? ''), before, at: Date.now()});
      if (stack.length > max) stack = stack.slice(stack.length - max);
      emit();
      return stack.length;
    },
    // The latest entry {label, before, at}, removed from the stack; null when empty.
    pop() { const e = stack.pop() || null; if (e) emit(); return e; },
    clear() { if (stack.length) { stack = []; emit(); } },
    peek() { return stack[stack.length - 1] || null; },
    get size() { return stack.length; },
    get limit() { return max; },
    // fn(size) after every change; returns an unsubscribe function.
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
