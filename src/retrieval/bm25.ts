/**
 * BM25 (Okapi BM25) scoring algorithm for full-text search.
 */

const K1 = 1.2;
const B = 0.75;

export interface Document {
  id: string;
  fields: Record<string, string>;
}

export interface ScoredResult {
  id: string;
  score: number;
}

export interface Bm25Index {
  search(query: string, limit?: number): ScoredResult[];
}

/**
 * Tokenizes input text: lowercase, split on non-alphanumeric, filter short tokens.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2);
}

/**
 * Creates a BM25 index over the given documents with field weights.
 */
export function createBm25Index(
  documents: Document[],
  fieldWeights: Record<string, number>,
): Bm25Index {
  const N = documents.length;
  const fieldNames = Object.keys(fieldWeights);

  // Pre-compute: tokenized fields, field lengths, avg field lengths, document frequencies
  const tokenizedDocs: Map<string, Map<string, string[]>> = new Map();
  const fieldLengthSums: Record<string, number> = {};
  const fieldLengthCounts: Record<string, number> = {};

  for (const field of fieldNames) {
    fieldLengthSums[field] = 0;
    fieldLengthCounts[field] = 0;
  }

  for (const doc of documents) {
    const fieldTokens = new Map<string, string[]>();
    for (const field of fieldNames) {
      const tokens = tokenize(doc.fields[field] ?? "");
      fieldTokens.set(field, tokens);
      fieldLengthSums[field] += tokens.length;
      fieldLengthCounts[field] += 1;
    }
    tokenizedDocs.set(doc.id, fieldTokens);
  }

  const avgFieldLen: Record<string, number> = {};
  for (const field of fieldNames) {
    avgFieldLen[field] = N > 0 ? fieldLengthSums[field] / N : 0;
  }

  // Document frequency: count each doc once per term (across all fields)
  const df: Map<string, number> = new Map();
  for (const doc of documents) {
    const fieldTokens = tokenizedDocs.get(doc.id)!;
    const termsInDoc = new Set<string>();
    for (const field of fieldNames) {
      for (const token of fieldTokens.get(field) ?? []) {
        termsInDoc.add(token);
      }
    }
    for (const term of termsInDoc) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }

  return {
    search(query: string, limit = 10): ScoredResult[] {
      const queryTerms = tokenize(query);
      if (queryTerms.length === 0 || N === 0) return [];

      const results: ScoredResult[] = [];

      for (const doc of documents) {
        let docScore = 0;
        const fieldTokens = tokenizedDocs.get(doc.id)!;

        for (const term of queryTerms) {
          const termDf = df.get(term) ?? 0;
          if (termDf === 0) continue;

          const idf = Math.log((N - termDf + 0.5) / (termDf + 0.5) + 1);

          for (const field of fieldNames) {
            const tokens = fieldTokens.get(field) ?? [];
            const tf = tokens.filter((t) => t === term).length;
            if (tf === 0) continue;

            const fieldLen = tokens.length;
            const avgLen = avgFieldLen[field];
            const tfNorm =
              (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (fieldLen / (avgLen || 1))));
            const weight = fieldWeights[field] ?? 1;

            docScore += idf * tfNorm * weight;
          }
        }

        if (docScore > 0) {
          results.push({ id: doc.id, score: docScore });
        }
      }

      results.sort((a, b) => b.score - a.score);
      return results.slice(0, limit);
    },
  };
}
