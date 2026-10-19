/**
 * IPPE: Infinitesimal Plane-based Pose Estimation (T. Collins and A. Bartoli,
 * "Infinitesimal Plane-Based Pose Estimation", IJCV 109(3), 2014). Re-derived
 * from the paper; no code was ported.
 *
 * Input: a homography H (`Mat3`, row-major) from **centred** model-plane
 * coordinates q = (a, b) (the model points' centroid at the origin) to
 * normalised image coordinates (x = (u − cx)/fx, y = (v − cy)/fy). The model
 * plane is the plane z = 0 of a model frame with axes (a, b, a × b).
 *
 * Output: the two rotations (model → CV camera) of the planar ambiguity, and,
 * given a rotation and the correspondences, the least-squares translation.
 *
 * Derivation (§3–4 of the paper). With h₃₃ = 1, the image of the model origin
 * is v = (h₁₃, h₂₃) and the Jacobian of the image map at q = 0 is
 * J = [h₁₁ − h₃₁v₁, h₁₂ − h₃₂v₁; h₂₁ − h₃₁v₂, h₂₂ − h₃₂v₂].
 * For a camera (R, t) this Jacobian is J = (1/t₃)·[I₂ | −v]·R̃, R̃ the first two
 * columns of R. Let R_v be the rotation taking ẑ to the ray (v, 1)/‖(v, 1)‖;
 * then [I₂ | −v]·R_v = [B | 0] with B 2×2 and invertible (BBᵀ = I + vvᵀ). So
 * A = B⁻¹J = (1/t₃)·(top-left 2×2 of R_vᵀR). The top-left 2×2 block M of a
 * rotation has largest singular value 1, hence γ = σ_max(A) = 1/t₃ and
 * M = A/γ. The block's third row c = (c₁, c₂) follows from orthonormality of
 * the first two columns: c₁² = 1 − M₁₁² − M₂₁², c₂² = 1 − M₁₂² − M₂₂²,
 * c₁c₂ = −(M₁₁M₁₂ + M₂₁M₂₂). The two signs ±c are the two solutions;
 * R = R_v·[m₁ m₂ m₁ × m₂] with columns m_i = (M₁ᵢ, M₂ᵢ, ±cᵢ).
 *
 * Non-null assertions (`!`) are on fixed-size typed-array reads (or reads with
 * indices < 2n), in range by construction.
 */
import type { Mat3 } from '../types.js';

/**
 * The two IPPE rotations (model → camera, CV, row-major) from H (centred model
 * plane → normalised image). Returns false if H is degenerate (h₃₃ ≈ 0 or not
 * finite). When the view is fronto-parallel both rotations coincide.
 */
export function ippeRotations(h: Mat3, r1: Mat3, r2: Mat3): boolean {
  const h33 = h[8]!;
  let f = 0;
  for (let i = 0; i < 9; i++) f += h[i]! * h[i]!;
  if (!(Math.abs(h33) > 1e-12 * Math.sqrt(f))) return false;
  const k = 1 / h33;
  const h11 = h[0]! * k, h12 = h[1]! * k, h13 = h[2]! * k; // prettier-ignore
  const h21 = h[3]! * k, h22 = h[4]! * k, h23 = h[5]! * k; // prettier-ignore
  const h31 = h[6]! * k, h32 = h[7]! * k; // prettier-ignore
  const v1 = h13;
  const v2 = h23;
  const j00 = h11 - h31 * v1;
  const j01 = h12 - h32 * v1;
  const j10 = h21 - h31 * v2;
  const j11 = h22 - h32 * v2;

  // R_v: rotation about the axis ẑ × (v, 1) = (−v₂, v₁, 0) taking ẑ onto the ray (v, 1)/‖(v, 1)‖
  const vn = Math.hypot(v1, v2);
  const s = Math.sqrt(1 + vn * vn);
  const cosT = 1 / s;
  const sinT = vn / s;
  let rv00 = 1, rv01 = 0, rv02 = 0, rv10 = 0, rv11 = 1, rv12 = 0, rv20 = 0, rv21 = 0, rv22 = 1; // prettier-ignore
  if (vn > 1e-15) {
    const kx = -v2 / vn;
    const ky = v1 / vn;
    const omc = 1 - cosT;
    rv00 = cosT + kx * kx * omc;
    rv01 = kx * ky * omc;
    rv02 = ky * sinT;
    rv10 = kx * ky * omc;
    rv11 = cosT + ky * ky * omc;
    rv12 = -kx * sinT;
    rv20 = -ky * sinT;
    rv21 = kx * sinT;
    rv22 = cosT;
  }
  // B = first two columns of [I | −v]·R_v
  const b00 = rv00 - v1 * rv20;
  const b01 = rv01 - v1 * rv21;
  const b10 = rv10 - v2 * rv20;
  const b11 = rv11 - v2 * rv21;
  const detB = b00 * b11 - b01 * b10;
  if (!(Math.abs(detB) > 0)) return false;
  // A = B⁻¹·J
  const a00 = (b11 * j00 - b01 * j10) / detB;
  const a01 = (b11 * j01 - b01 * j11) / detB;
  const a10 = (-b10 * j00 + b00 * j10) / detB;
  const a11 = (-b10 * j01 + b00 * j11) / detB;
  // largest singular value of A: σ₁² = (‖A‖F² + √(‖A‖F⁴ − 4 det²)) / 2
  const fro = a00 * a00 + a01 * a01 + a10 * a10 + a11 * a11;
  const detA = a00 * a11 - a01 * a10;
  const gamma = Math.sqrt((fro + Math.sqrt(Math.max(0, fro * fro - 4 * detA * detA))) / 2);
  if (!(gamma > 0) || !Number.isFinite(gamma)) return false;
  const m00 = a00 / gamma, m01 = a01 / gamma, m10 = a10 / gamma, m11 = a11 / gamma; // prettier-ignore
  const c0 = Math.sqrt(Math.max(0, 1 - m00 * m00 - m10 * m10));
  let c1 = Math.sqrt(Math.max(0, 1 - m01 * m01 - m11 * m11));
  if (m00 * m01 + m10 * m11 > 0) c1 = -c1; // c₀c₁ = −(m₀₀m₀₁ + m₁₀m₁₁), c₀ ≥ 0

  for (let sol = 0; sol < 2; sol++) {
    const out = sol === 0 ? r1 : r2;
    const sg = sol === 0 ? 1 : -1;
    // columns of R' = R_vᵀR: p = (m00, m10, ±c0), q = (m01, m11, ±c1), p × q
    const px = m00, py = m10, pz = sg * c0; // prettier-ignore
    const qx = m01, qy = m11, qz = sg * c1; // prettier-ignore
    const wx = py * qz - pz * qy;
    const wy = pz * qx - px * qz;
    const wz = px * qy - py * qx;
    // R = R_v · R'
    out[0] = rv00 * px + rv01 * py + rv02 * pz;
    out[1] = rv00 * qx + rv01 * qy + rv02 * qz;
    out[2] = rv00 * wx + rv01 * wy + rv02 * wz;
    out[3] = rv10 * px + rv11 * py + rv12 * pz;
    out[4] = rv10 * qx + rv11 * qy + rv12 * qz;
    out[5] = rv10 * wx + rv11 * wy + rv12 * wz;
    out[6] = rv20 * px + rv21 * py + rv22 * pz;
    out[7] = rv20 * qx + rv21 * qy + rv22 * qz;
    out[8] = rv20 * wx + rv21 * wy + rv22 * wz;
  }
  return true;
}

/**
 * Least-squares translation for a known rotation `r` (model → camera, CV,
 * row-major) from n model-plane points `model` ([a, b] interleaved, model
 * frame) and their normalised image points `img` ([x, y] interleaved).
 * Minimises the algebraic error of x·Z = X, y·Z = Y. Writes t into `out`;
 * false if the system is singular.
 */
export function ippeTranslation(
  r: Mat3,
  model: ArrayLike<number>,
  img: ArrayLike<number>,
  n: number,
  out: Float64Array,
): boolean {
  // rows [1, 0, −x]·t = x·P₃ − P₁ and [0, 1, −y]·t = y·P₃ − P₂, P = R·(a, b, 0)
  let sx = 0, sy = 0, sxy2 = 0, b1 = 0, b2 = 0, b3 = 0; // prettier-ignore
  for (let i = 0; i < n; i++) {
    const a = model[2 * i]!;
    const b = model[2 * i + 1]!;
    const x = img[2 * i]!;
    const y = img[2 * i + 1]!;
    const p1 = r[0]! * a + r[1]! * b;
    const p2 = r[3]! * a + r[4]! * b;
    const p3 = r[6]! * a + r[7]! * b;
    const e1 = x * p3 - p1;
    const e2 = y * p3 - p2;
    sx += x;
    sy += y;
    sxy2 += x * x + y * y;
    b1 += e1;
    b2 += e2;
    b3 -= x * e1 + y * e2;
  }
  // normal matrix [[n, 0, −Σx], [0, n, −Σy], [−Σx, −Σy, Σ(x² + y²)]], solved in closed form:
  // eliminate t₁ = (b₁ + Σx·t₃)/n, t₂ = (b₂ + Σy·t₃)/n
  const d = sxy2 - (sx * sx + sy * sy) / n;
  if (!(Math.abs(d) > 1e-300)) return false;
  const t3 = (b3 + (sx * b1 + sy * b2) / n) / d;
  out[0] = (b1 + sx * t3) / n;
  out[1] = (b2 + sy * t3) / n;
  out[2] = t3;
  return Number.isFinite(t3);
}
