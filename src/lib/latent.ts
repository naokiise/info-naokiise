// Project section texts into a 2D "latent space" map: TF-IDF vectors
// over word / CJK-bigram tokens, then a small t-SNE down to 2D.
// Deterministic (seeded PRNG) so the map is stable across reloads.

export type LatentPoint = { x: number; y: number };

// Tuned for a handful of points: a small learning rate with many
// iterations converges to a stable shape; higher rates diverge.
const TSNE_ITERATIONS = 2000;
const TSNE_LEARNING_RATE = 0.5;
const TSNE_MOMENTUM_EARLY = 0.5;
const TSNE_MOMENTUM_LATE = 0.8;
const TSNE_MOMENTUM_SWITCH = 250;

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const tokens = [...lower.matchAll(/[a-z][a-z0-9]+/g)].map((m) => m[0]);

  // CJK has no spaces; character bigrams stand in for words.
  for (const run of lower.match(/[぀-ヿ㐀-鿿]+/g) ?? []) {
    if (run.length === 1) {
      tokens.push(run);
      continue;
    }
    for (let i = 0; i < run.length - 1; i++) {
      tokens.push(run.slice(i, i + 2));
    }
  }

  return tokens;
}

function tfidfVectors(texts: string[]): Map<string, number>[] {
  const docs = texts.map((text) => {
    const tf = new Map<string, number>();
    for (const token of tokenize(text)) {
      tf.set(token, (tf.get(token) ?? 0) + 1);
    }
    return tf;
  });

  const docFreq = new Map<string, number>();
  for (const tf of docs) {
    for (const token of tf.keys()) {
      docFreq.set(token, (docFreq.get(token) ?? 0) + 1);
    }
  }

  return docs.map((tf) => {
    const vec = new Map<string, number>();
    let norm = 0;
    for (const [token, count] of tf) {
      const idf = Math.log((1 + docs.length) / (1 + (docFreq.get(token) ?? 0))) + 1;
      const weight = (1 + Math.log(count)) * idf;
      vec.set(token, weight);
      norm += weight * weight;
    }
    norm = Math.sqrt(norm) || 1;
    for (const [token, weight] of vec) {
      vec.set(token, weight / norm);
    }
    return vec;
  });
}

function cosine(a: Map<string, number>, b: Map<string, number>) {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [token, weight] of small) {
    dot += weight * (large.get(token) ?? 0);
  }
  return dot;
}

// Squared distances between L2-normalized vectors: 2 * (1 - cos).
function distanceMatrix(vectors: Map<string, number>[]): number[][] {
  const n = vectors.length;
  const d: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dist = Math.max(0, 2 * (1 - cosine(vectors[i], vectors[j])));
      d[i][j] = dist;
      d[j][i] = dist;
    }
  }
  return d;
}

// Per-point binary search for the bandwidth matching the target perplexity.
function affinities(d: number[][], perplexity: number): number[][] {
  const n = d.length;
  const targetEntropy = Math.log(perplexity);
  const p: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    let betaMin = -Infinity;
    let betaMax = Infinity;
    let beta = 1;

    for (let attempt = 0; attempt < 50; attempt++) {
      let sum = 0;
      for (let j = 0; j < n; j++) {
        p[i][j] = j === i ? 0 : Math.exp(-d[i][j] * beta);
        sum += p[i][j];
      }
      if (sum <= 0) sum = 1e-12;

      let entropy = 0;
      for (let j = 0; j < n; j++) {
        p[i][j] /= sum;
        if (p[i][j] > 1e-10) entropy -= p[i][j] * Math.log(p[i][j]);
      }

      const diff = entropy - targetEntropy;
      if (Math.abs(diff) < 1e-5) break;
      if (diff > 0) {
        betaMin = beta;
        beta = betaMax === Infinity ? beta * 2 : (beta + betaMax) / 2;
      } else {
        betaMax = beta;
        beta = betaMin === -Infinity ? beta / 2 : (beta + betaMin) / 2;
      }
    }
  }

  // Symmetrize.
  const joint: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  let total = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      joint[i][j] = (p[i][j] + p[j][i]) / (2 * n);
      total += joint[i][j];
    }
  }
  if (total > 0) {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        joint[i][j] = Math.max(joint[i][j] / total, 1e-12);
      }
    }
  }
  return joint;
}

function tsne(d: number[][], seed: number): LatentPoint[] {
  const n = d.length;
  const perplexity = Math.max(1.5, Math.min(5, (n - 1) / 2));
  const p = affinities(d, perplexity);
  const rand = mulberry32(seed);

  const y = Array.from({ length: n }, () => ({
    x: (rand() - 0.5) * 1e-2,
    y: (rand() - 0.5) * 1e-2,
  }));
  const velocity = Array.from({ length: n }, () => ({ x: 0, y: 0 }));
  const gain = Array.from({ length: n }, () => ({ x: 1, y: 1 }));

  for (let iter = 0; iter < TSNE_ITERATIONS; iter++) {
    const momentum =
      iter < TSNE_MOMENTUM_SWITCH ? TSNE_MOMENTUM_EARLY : TSNE_MOMENTUM_LATE;

    // Student-t affinities in the embedding.
    const num: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
    let qSum = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = y[i].x - y[j].x;
        const dy = y[i].y - y[j].y;
        const v = 1 / (1 + dx * dx + dy * dy);
        num[i][j] = v;
        num[j][i] = v;
        qSum += 2 * v;
      }
    }
    if (qSum <= 0) qSum = 1e-12;

    for (let i = 0; i < n; i++) {
      let gradX = 0;
      let gradY = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const q = Math.max(num[i][j] / qSum, 1e-12);
        const mult = 4 * (p[i][j] - q) * num[i][j];
        gradX += mult * (y[i].x - y[j].x);
        gradY += mult * (y[i].y - y[j].y);
      }

      gain[i].x = Math.max(
        0.01,
        Math.sign(gradX) === Math.sign(velocity[i].x)
          ? gain[i].x * 0.8
          : gain[i].x + 0.2,
      );
      gain[i].y = Math.max(
        0.01,
        Math.sign(gradY) === Math.sign(velocity[i].y)
          ? gain[i].y * 0.8
          : gain[i].y + 0.2,
      );

      velocity[i].x =
        momentum * velocity[i].x - TSNE_LEARNING_RATE * gain[i].x * gradX;
      velocity[i].y =
        momentum * velocity[i].y - TSNE_LEARNING_RATE * gain[i].y * gradY;
      y[i].x += velocity[i].x;
      y[i].y += velocity[i].y;
    }

    // Keep the embedding centered.
    const meanX = y.reduce((s, pt) => s + pt.x, 0) / n;
    const meanY = y.reduce((s, pt) => s + pt.y, 0) / n;
    for (const pt of y) {
      pt.x -= meanX;
      pt.y -= meanY;
    }
  }

  return y;
}

function normalizeToUnit(points: LatentPoint[]): LatentPoint[] {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX;
  const spanY = maxY - minY;

  return points.map((p) => ({
    x: spanX > 1e-9 ? (p.x - minX) / spanX : 0.5,
    y: spanY > 1e-9 ? (p.y - minY) / spanY : 0.5,
  }));
}

/**
 * Map each text to a point in [0,1]^2 where textual similarity
 * becomes spatial proximity (TF-IDF -> t-SNE).
 */
export function latentMapPositions(texts: string[], seed = 20260703): LatentPoint[] {
  if (texts.length === 0) return [];
  if (texts.length === 1) return [{ x: 0.5, y: 0.5 }];

  const vectors = tfidfVectors(texts);
  const distances = distanceMatrix(vectors);
  return normalizeToUnit(tsne(distances, seed));
}
