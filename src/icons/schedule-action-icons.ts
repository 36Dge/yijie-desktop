import { createLucideIcon } from "@lucide/vue";

export const ScheduleHistory = createLucideIcon("schedule-history", [
  ["circle", { cx: 12, cy: 12, r: 9 }],
  ["path", { d: "M12 6.5V12l4 4" }],
]);

export const ScheduleDelete = createLucideIcon("schedule-delete", [
  ["path", { d: "M9.5 3.5h5M3.5 7h17" }],
  ["path", { d: "m5.75 7 .75 12a2 2 0 0 0 2 1.875h7a2 2 0 0 0 2-1.875l.75-12" }],
  ["path", { d: "M10 11v6m4-6v6" }],
]);
