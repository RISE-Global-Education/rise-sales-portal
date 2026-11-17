// Edit history, kept on the edited object itself: obj.history = [{ by, at, changes: { field: { from, to } } }], oldest first.
// record() applies the new values and adds one entry with only the fields that really changed (nothing when none did).
//  - mergeWithin (ms): saves by the same person within that time of their last save (`last`: { by, at }) are folded into
//    one entry: used where a form saves while you type (Spam Check notes), so history shows edits, not keystrokes.
//    With no history yet, those saves are still the first save (creating the record), so no entry is added.
const MAX = 100; // oldest entries are dropped past this
const same = (a, b) => JSON.stringify(a ?? '') === JSON.stringify(b ?? '');

function record(obj, next, user, { last, mergeWithin = 0, at = new Date().toISOString() } = {}) {
  const changes = {};
  for (const k of Object.keys(next)) if (!same(obj[k], next[k])) changes[k] = { from: obj[k] ?? '', to: next[k] ?? '' };
  if (!Object.keys(changes).length) return false;
  const hist = obj.history ? obj.history.slice() : [];
  const sameSession = mergeWithin > 0 && last && last.by === user.name && Date.parse(at) - Date.parse(last.at) < mergeWithin;
  if (!sameSession) hist.push({ by: user.name, at, changes });
  else if (hist.length) {
    // fold into the open entry; a field changed back to what it was drops out (an empty entry is skipped when shown)
    const e = hist[hist.length - 1] = { ...hist[hist.length - 1], at, changes: { ...hist[hist.length - 1].changes } };
    for (const [k, c] of Object.entries(changes)) {
      const from = k in e.changes ? e.changes[k].from : c.from;
      if (same(from, c.to)) delete e.changes[k]; else e.changes[k] = { from, to: c.to };
    }
  }
  Object.assign(obj, next);
  if (hist.length) obj.history = hist.slice(-MAX);
  return true;
}

// entries that still hold a change, oldest first
const entries = (obj) => ((obj && obj.history) || []).filter((e) => e.changes && Object.keys(e.changes).length);

module.exports = { record, entries, MAX };
