import { existsSync, watch } from "node:fs";

const DIAGRAM_SUFFIX = ".diagram.mmd";

export interface WatcherOptions {
  debounceMs?: number;
}

export interface DiagramWatcher {
  close(): void;
}

/**
 * Watch a plans directory for `.diagram.mmd` changes.
 * Calls `onChange(planId)` with debouncing per file.
 * Returns a handle with `close()`. Handles missing directories gracefully.
 */
export function watchDiagramFiles(
  plansDir: string,
  onChange: (planId: string) => void,
  options: WatcherOptions = {},
): DiagramWatcher {
  const debounceMs = options.debounceMs ?? 250;

  if (!existsSync(plansDir)) {
    return { close() {} };
  }

  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let closed = false;

  const fsWatcher = watch(plansDir, (_eventType, filename) => {
    if (closed || !filename || !filename.endsWith(DIAGRAM_SUFFIX)) return;
    const planId = filename.slice(0, -DIAGRAM_SUFFIX.length);

    const existing = timers.get(planId);
    if (existing) clearTimeout(existing);

    timers.set(
      planId,
      setTimeout(() => {
        timers.delete(planId);
        if (!closed) onChange(planId);
      }, debounceMs),
    );
  });

  return {
    close() {
      closed = true;
      fsWatcher.close();
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
}
