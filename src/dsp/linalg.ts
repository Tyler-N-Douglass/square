/**
 * Private linear algebra for the DSP layer — implemented in-repo (SPEC §0:
 * zero runtime deps; §3.1: write the math yourself). Owned by A2.
 *
 * Contents: dense Gaussian elimination with partial pivoting (for the 9×9
 * quadric normal equations) and a cyclic Jacobi eigensolver for symmetric
 * 3×3 matrices (for the ellipsoid axes). Both are small, deterministic, and
 * property-tested via the calibration suite.
 */

/** Solve A·x = b for square A (row-major, n×n), Gaussian elimination with partial pivoting. */
export function solveLinear(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  // Work on copies; the caller's arrays stay untouched.
  const m: number[][] = a.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r]![col]!) > Math.abs(m[pivot]![col]!)) pivot = r;
    }
    if (Math.abs(m[pivot]![col]!) < 1e-12) return null; // singular
    if (pivot !== col) {
      const tmp = m[col]!;
      m[col] = m[pivot]!;
      m[pivot] = tmp;
    }
    const prow = m[col]!;
    for (let r = col + 1; r < n; r++) {
      const row = m[r]!;
      const f = row[col]! / prow[col]!;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) row[c] = row[c]! - f * prow[c]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    const row = m[r]!;
    let acc = row[n]!;
    for (let c = r + 1; c < n; c++) acc -= row[c]! * x[c]!;
    x[r] = acc / row[r]!;
  }
  return x;
}

export interface EigenSym3 {
  /** Eigenvalues, unordered (paired with `vectors` columns). */
  values: [number, number, number];
  /** Row-major 3×3 whose COLUMNS are the unit eigenvectors. */
  vectors: number[][];
}

/**
 * Cyclic Jacobi eigendecomposition for a symmetric 3×3 matrix.
 * Deterministic; converges quadratically; 32 sweeps is far more than enough.
 */
export function eigenSym3(mat: number[][]): EigenSym3 {
  const a: number[][] = mat.map((row) => [...row]);
  const v: number[][] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  const rotate = (p: number, q: number): void => {
    const apq = a[p]![q]!;
    if (Math.abs(apq) < 1e-15) return;
    const app = a[p]![p]!;
    const aqq = a[q]![q]!;
    const theta = (aqq - app) / (2 * apq);
    const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
    const c = 1 / Math.sqrt(t * t + 1);
    const s = t * c;
    for (let k = 0; k < 3; k++) {
      const akp = a[k]![p]!;
      const akq = a[k]![q]!;
      a[k]![p] = c * akp - s * akq;
      a[k]![q] = s * akp + c * akq;
    }
    for (let k = 0; k < 3; k++) {
      const apk = a[p]![k]!;
      const aqk = a[q]![k]!;
      a[p]![k] = c * apk - s * aqk;
      a[q]![k] = s * apk + c * aqk;
    }
    for (let k = 0; k < 3; k++) {
      const vkp = v[k]![p]!;
      const vkq = v[k]![q]!;
      v[k]![p] = c * vkp - s * vkq;
      v[k]![q] = s * vkp + c * vkq;
    }
  };
  for (let sweep = 0; sweep < 32; sweep++) {
    const off =
      Math.abs(a[0]![1]!) + Math.abs(a[0]![2]!) + Math.abs(a[1]![2]!);
    if (off < 1e-13) break;
    rotate(0, 1);
    rotate(0, 2);
    rotate(1, 2);
  }
  return { values: [a[0]![0]!, a[1]![1]!, a[2]![2]!], vectors: v };
}

/** Multiply two row-major 3×3 matrices. */
export function mul3(a: number[][], b: number[][]): number[][] {
  const out: number[][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let acc = 0;
      for (let k = 0; k < 3; k++) acc += a[i]![k]! * b[k]![j]!;
      out[i]![j] = acc;
    }
  }
  return out;
}

/** Multiply a row-major 3×3 matrix by a 3-vector. */
export function mulVec3(a: number[][], x: readonly number[]): [number, number, number] {
  return [
    a[0]![0]! * x[0]! + a[0]![1]! * x[1]! + a[0]![2]! * x[2]!,
    a[1]![0]! * x[0]! + a[1]![1]! * x[1]! + a[1]![2]! * x[2]!,
    a[2]![0]! * x[0]! + a[2]![1]! * x[1]! + a[2]![2]! * x[2]!,
  ];
}
