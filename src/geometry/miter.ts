/**
 * Simple + compound miter solver — SPEC §4.5.2. Frozen contract (ADR-004):
 * tests/unit/miter-canonical.test.ts calls exactly this.
 *
 * DERIVED FROM ROTATION GEOMETRY, per ADR-009 — not transcribed from the
 * spec's candidate formulas. The construction, in code below:
 *
 *   1. World frame: z up. The two molding runs leave the joint along unit
 *      directions u1, u2 in the horizontal plane, separated by the corner
 *      angle C (C = 180° is a flat splice: the runs are collinear-opposite).
 *   2. The bisecting cut plane is the mirror plane that reflects one prism
 *      onto the other. It contains the vertical and the bisector of the two
 *      runs, so its normal is along u1 − u2 (horizontal).
 *   3. The installed→saw rotation lays the crown's back flat on the table:
 *      the piece's body triad {length, cross-face, back-normal} maps onto the
 *      saw triad {fence X, table Y, table-normal Z}. The back normal of the
 *      installed crown is the wall normal swung about the run axis by the
 *      spring angle S.
 *   4. Transform the cut-plane normal into the saw frame and read the saw
 *      settings off the unit normal (nx, ny, nz):
 *        miter (table rotation from square) = atan(|ny| / |nx|)
 *        bevel (blade tilt from vertical)   = asin(|nz|)
 *
 * Closed forms this construction reduces to, with D = (180° − C)/2:
 *        miter = atan( sin S · tan D )      — matches the spec's candidate
 *        bevel = asin( cos S · sin D )      — the candidate says cos D; that
 *                                             coincides at C = 90° (sin 45° =
 *                                             cos 45°) and fails everywhere
 *                                             else, worst at the flat splice
 *                                             where it returns 90° − S.
 * Full derivation: docs/physics-craft.md.
 *
 * Conventions: cornerDeg C = the wall corner angle (90 = square inside
 * corner, 180 = flat splice). springDeg S = crown spring angle measured from
 * the wall. Cut laid flat on the saw table. miterDeg = table rotation from
 * square, bevelDeg = blade tilt from vertical; both reported as positive
 * magnitudes with direction handled by the saw card.
 */

export interface CompoundCut { miterDeg: number; bevelDeg: number; }

// ---------------------------------------------------------------------------
// Minimal vec3 helpers. Deliberately local: A3 owns src/geometry/vec.ts and
// Phase 1 runs in parallel (charter isolation) — a dozen lines is cheaper
// than a cross-boundary dependency.
// ---------------------------------------------------------------------------

type V3 = readonly [number, number, number];

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;

const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const normalize = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};

const Z_UP: V3 = [0, 0, 1];

function assertCorner(cornerDeg: number): void {
  if (!Number.isFinite(cornerDeg) || cornerDeg <= 0 || cornerDeg >= 360) {
    throw new RangeError('Corner angle must be between 0° and 360°, exclusive.');
  }
}

function assertSpring(springDeg: number): void {
  if (!Number.isFinite(springDeg) || springDeg < 0 || springDeg > 90) {
    throw new RangeError('Spring angle must be between 0° and 90°.');
  }
}

/** Run direction of piece 1, leaving the joint. Bisector of the corner is +x. */
function run1(cornerDeg: number): V3 {
  const half = (cornerDeg / 2) * RAD;
  return [Math.cos(half), Math.sin(half), 0];
}

/** Run direction of piece 2, leaving the joint (mirror of run 1 across x–z). */
function run2(cornerDeg: number): V3 {
  const half = (cornerDeg / 2) * RAD;
  return [Math.cos(half), -Math.sin(half), 0];
}

/**
 * Unit normal of the bisecting cut plane, world frame. The joint plane of two
 * identical prisms is the mirror plane that reflects run 1 onto run 2 while
 * fixing the vertical, so its normal lies along u1 − u2. It contains z and the
 * corner bisector. Well-defined for every C in (0°, 360°), including the flat
 * splice, where u1 − u2 stays finite while u1 + u2 vanishes.
 */
function cutNormalWorld(cornerDeg: number): V3 {
  return normalize(sub(run1(cornerDeg), run2(cornerDeg)));
}

/** Read saw settings off the cut-plane unit normal expressed in the saw frame. */
function extractSettings(nx: number, ny: number, nz: number): CompoundCut {
  return {
    miterDeg: Math.atan2(Math.abs(ny), Math.abs(nx)) * DEG,
    bevelDeg: Math.asin(Math.min(1, Math.abs(nz))) * DEG,
  };
}

/**
 * Compound miter for crown cut FLAT (back down on the table) — SPEC §4.5.2.
 * Canonicals: 90/45 → 35.26/30.00 · 90/38 → 31.62/33.86 · 180/any → 0/0.
 */
export function compoundMiter(cornerDeg: number, springDeg: number): CompoundCut {
  assertCorner(cornerDeg);
  assertSpring(springDeg);
  const s = springDeg * RAD;

  const u1 = run1(cornerDeg);          // piece 1 length, installed
  const wallNormal = cross(u1, Z_UP);  // horizontal normal of wall 1, into the room

  // Body triad of the installed piece, in world coordinates:
  //   a1 — along the length            → saw X (along the fence)
  //   a3 — normal to the crown's back  → saw Z (table normal): the wall normal
  //        swung about the run axis by the spring angle
  //   a2 — cross-face direction        → saw Y (completes the frame)
  const a1 = u1;
  const a3 = sub(scale(wallNormal, Math.cos(s)), scale(Z_UP, Math.sin(s)));
  const a2 = cross(a3, a1);

  // Installed→saw is the rotation taking {a1,a2,a3} to the saw axes, so the
  // cut normal's saw-frame components are its projections on the body triad.
  const n = cutNormalWorld(cornerDeg);
  return extractSettings(dot(n, a1), dot(n, a2), dot(n, a3));
}

/** Simple miter: two pieces meeting at corner angle C, split evenly. */
export function simpleMiter(cornerDeg: number): number {
  assertCorner(cornerDeg);
  // Same machinery, degenerate case: the piece lies in the plane of the
  // corner, so the cut-plane normal has no component along the table normal
  // and the whole cut is table rotation: (180 − C)/2.
  return (180 - cornerDeg) / 2;
}

/**
 * Asymmetric miter — SPEC §4.3.4: the two miters at a corner must sum to
 * 180° − C. When one piece is already cut at `fixedPieceDeg`, the mate takes
 * the remainder. May be negative or exceed 90° when the fixed cut can't meet
 * that corner — the caller gates; nothing is clamped.
 */
export function asymmetricMiter(cornerDeg: number, fixedPieceDeg: number): number {
  assertCorner(cornerDeg);
  if (!Number.isFinite(fixedPieceDeg)) {
    throw new RangeError('Fixed piece angle must be a finite number of degrees.');
  }
  return (180 - cornerDeg) - fixedPieceDeg;
}

/**
 * Nested (in-position) crown — SPEC §4.5.2. The crown stands against the
 * fence at its spring angle, upside down: the saw's fence plays the wall, the
 * table plays the ceiling. The installed frame maps rigidly onto the saw
 * frame — world-up goes to the table plane — so the spring angle drops out:
 * miter = D = (180° − C)/2, bevel = 0. The spec's candidate "single miter
 * atan(tan D / cos S)" is NOT this saw setting — it belongs to the face-line
 * family (see crownFaceLine and docs/physics-craft.md).
 */
export function nestedCrown(cornerDeg: number): CompoundCut {
  assertCorner(cornerDeg);
  // Body triad under the nested hold: length along the fence; the
  // ceiling-contact face sits on the table, so world-up maps to the table
  // normal (sign is immaterial — extraction takes magnitudes).
  const a1 = run1(cornerDeg);
  const a3: V3 = [0, 0, -1];
  const a2 = cross(a3, a1);
  const n = cutNormalWorld(cornerDeg);
  return extractSettings(dot(n, a1), dot(n, a2), dot(n, a3));
}

export interface FaceLine {
  /** Angle of the marked line from square-across-the-face. Equals the flat-cut miter setting. */
  fromSquareDeg: number;
  /** Angle of the marked line from the long edge of the stock. Complement of the above. */
  fromEdgeDeg: number;
}

/**
 * FACE LINE — the cut line marked on the sloped face of the crown, for a
 * hand saw or a layout check. NOT a saw setting; the numbers a compound saw
 * takes are compoundMiter (flat) or nestedCrown (nested).
 *
 * Derived: intersect the bisecting cut plane with the face plane (the plane
 * through the run direction and the up-slope direction at spring angle S),
 * then measure the line inside that face. The from-square angle comes out
 * equal to the flat-cut miter — it is the same physical line the flat-set saw
 * draws across the face. The spec's atan(tan D / cos S) family reproduces the
 * from-edge value only at a 90° corner with a 45° spring; see
 * docs/physics-craft.md for the coincidence structure.
 */
export function crownFaceLine(cornerDeg: number, springDeg: number): FaceLine {
  assertCorner(cornerDeg);
  assertSpring(springDeg);
  const s = springDeg * RAD;

  const u1 = run1(cornerDeg);
  const wallNormal = cross(u1, Z_UP);
  // Up-slope direction across the face: vertical swung off the wall by S.
  const upSlope = add(scale(Z_UP, Math.cos(s)), scale(wallNormal, Math.sin(s)));
  const faceNormal = cross(u1, upSlope);

  // The marked line lies in both the face plane and the cut plane.
  const line = normalize(cross(cutNormalWorld(cornerDeg), faceNormal));
  const alongLength = Math.abs(dot(line, u1));
  const acrossFace = Math.abs(dot(line, normalize(upSlope)));
  return {
    fromSquareDeg: Math.atan2(alongLength, acrossFace) * DEG,
    fromEdgeDeg: Math.atan2(acrossFace, alongLength) * DEG,
  };
}

// ---------------------------------------------------------------------------
// Saw card — SPEC §4.5.2. Data only; the BEVEL tool renders it in Phase 2.
// Copy follows kit/BRAND.md: verb first, plain, active.
// ---------------------------------------------------------------------------

export type CutMethod = 'flat' | 'nested';
export type CornerType = 'inside' | 'outside';
export type PieceSide = 'left' | 'right';

export interface SawCardInput {
  /** Measured corner angle, wall to wall, degrees. */
  cornerDeg: number;
  /** Crown spring angle from the wall, degrees. */
  springDeg: number;
  method: CutMethod;
  /** Defaults to 'inside'. */
  corner?: CornerType;
  /** Which side of the corner this piece lands on, facing the corner. Defaults to 'left'. */
  piece?: PieceSide;
}

export interface SawCardData {
  method: CutMethod;
  miterDeg: number;
  bevelDeg: number;
  tiltDirection: string;
  fenceSide: string;
  keeperSide: string;
  flipMate: string;
  testCutNote: string;
}

const fmt1 = (deg: number): string => `${deg.toFixed(1)}°`;

/**
 * The numbers and the handling for one piece of one corner. Method matters:
 * flat and nested take different settings for the same corner, and handing a
 * carpenter the wrong family wastes a stick of molding — the card always
 * states which hold the numbers are for.
 */
export function sawCard(input: SawCardInput): SawCardData {
  const corner: CornerType = input.corner ?? 'inside';
  const piece: PieceSide = input.piece ?? 'left';
  const cut = input.method === 'flat'
    ? compoundMiter(input.cornerDeg, input.springDeg)
    : nestedCrown(input.cornerDeg);

  // Which way the table swings, with the finished face presented as the
  // fenceSide line describes. Mirrors for the mating piece and for outside
  // corners.
  const swing: PieceSide = (corner === 'inside') === (piece === 'left') ? 'right' : 'left';
  const otherSwing: PieceSide = swing === 'right' ? 'left' : 'right';

  if (input.method === 'flat') {
    return {
      method: 'flat',
      miterDeg: cut.miterDeg,
      bevelDeg: cut.bevelDeg,
      tiltDirection: `Tilt the blade left ${fmt1(cut.bevelDeg)}. Swing the table ${swing} ${fmt1(cut.miterDeg)}.`,
      fenceSide: 'Lay the crown flat on the table, finished face up, ceiling edge against the fence.',
      keeperSide: `Keep the piece on the ${piece} side of the blade.`,
      flipMate: `The mate takes the same tilt with the table swung ${otherSwing} ${fmt1(cut.miterDeg)} — keep the other side of the blade.`,
      testCutNote: 'Cut a test piece from scrap first.',
    };
  }
  return {
    method: 'nested',
    miterDeg: cut.miterDeg,
    bevelDeg: cut.bevelDeg,
    tiltDirection: `No tilt — the blade stays square. The fence holds the spring angle. Swing the table ${swing} ${fmt1(cut.miterDeg)}.`,
    fenceSide: 'Stand the crown upside down against the fence: ceiling contact flat on the table, wall contact flat on the fence. Clamp a stop block to hold the spring angle.',
    keeperSide: `Keep the piece on the ${piece} side of the blade.`,
    flipMate: `The mate mirrors: swing the table ${otherSwing} ${fmt1(cut.miterDeg)} and keep the other side of the blade.`,
    testCutNote: 'Cut a test piece from scrap first.',
  };
}
