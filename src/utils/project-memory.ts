/**
 * Backward-compatible barrel re-export for project storage modules.
 *
 * All storage operations are now split across focused modules:
 * - storage-utils.ts  — shared enums, types, filesystem helpers, validation
 * - plan-store.ts     — Plan CRUD and index maintenance
 * - knowledge-store.ts — Knowledge entry CRUD and index maintenance
 * - task-store.ts     — Task CRUD, index, and markdown render
 *
 * All original exports are preserved here for backward compatibility.
 */

export * from "./knowledge-store.js";
export * from "./plan-store.js";
export * from "./storage-utils.js";
export * from "./task-store.js";
