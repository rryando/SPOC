/**
 * Graph cache invalidation hook.
 *
 * Decoupled from graph-retrieval to avoid circular imports.
 * graph-retrieval registers its cache here at module load;
 * write paths call invalidateGraphCache() after mutations.
 */

export type InvalidateFn = (slug: string) => void;

let _invalidate: InvalidateFn | null = null;

/**
 * Called by graph-retrieval at module load to register the singleton cache's invalidate method.
 */
export function registerGraphCacheInvalidator(fn: InvalidateFn): void {
  _invalidate = fn;
}

/**
 * Invalidate the graph cache for a project slug.
 * No-op if the graph module hasn't been loaded yet.
 */
export function invalidateGraphCache(slug: string): void {
  if (_invalidate) _invalidate(slug);
}
