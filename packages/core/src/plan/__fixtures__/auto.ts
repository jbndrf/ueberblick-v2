/** Test helper: adds the automatic action `tasks.<task>.auto.<name>` to a plain project file (C-004). */
interface Tasks {
  tasks?: Record<string, { auto?: Record<string, unknown> }>;
}

export function addAuto(file: object, task: string, name: string, entry: Record<string, unknown>): void {
  const t = (file as Tasks).tasks?.[task];
  if (t === undefined) throw new Error(`fixture has no task ${task}`);
  t.auto = { ...t.auto, [name]: entry };
}
