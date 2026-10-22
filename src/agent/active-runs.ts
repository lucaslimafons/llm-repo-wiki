/**
 * In-flight chat runs by chat id, so the Stop button can cancel the model server-side. A closed tab
 * only drops the HTTP stream and the run still finishes and persists; Stop is the explicit cancel.
 * In-memory is enough: this app is one local process.
 */
const active = new Map<string, AbortController>();

export function beginRun(chatId: string): AbortController {
  active.get(chatId)?.abort();
  const controller = new AbortController();
  active.set(chatId, controller);
  return controller;
}

export function endRun(chatId: string, controller: AbortController) {
  if (active.get(chatId) === controller) active.delete(chatId);
}

/** True when a run was found and cancelled. */
export function stopRun(chatId: string): boolean {
  const controller = active.get(chatId);
  if (!controller) return false;
  controller.abort();
  active.delete(chatId);
  return true;
}
