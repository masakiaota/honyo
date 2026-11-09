// Adapted from PFN plamo-translate-cli (Apache-2.0). See licenses/PlamoMetal.txt.
// Modified for Swift, four model sizes and configurable query/KV head ratios.
enum MetalSources {
    static let qdot = #"""
inline float qdot4(const device uint* w, thread const float* xt, float sum, float scale, float bias) {
    uint a = w[0], c = w[1];
    float accum = xt[0] * float(a & 15u) + xt[1] * float(a & 0xf0u) + xt[2] * float(a & 0xf00u) + xt[3] * float(a & 0xf000u)
        + xt[4] * float((a >> 16) & 15u) + xt[5] * float((a >> 16) & 0xf0u) + xt[6] * float((a >> 16) & 0xf00u) + xt[7] * float(a >> 28 << 12)
        + xt[8] * float(c & 15u) + xt[9] * float(c & 0xf0u) + xt[10] * float(c & 0xf00u) + xt[11] * float(c & 0xf000u)
        + xt[12] * float((c >> 16) & 15u) + xt[13] * float((c >> 16) & 0xf0u) + xt[14] * float((c >> 16) & 0xf00u) + xt[15] * float(c >> 28 << 12);
    return scale * accum + bias * sum;
}
"""#
    static let denseDot = #"""
inline float dot16(const device half* w, thread const float* xt) {
    float accum = 0;
    for (uint i = 0; i < 16; ++i) accum += xt[i] * float(w[i]);
    return accum;
}
"""#
    static let qmv = #"""
uint lane = thread_index_in_simdgroup;
uint row = threadgroup_position_in_grid.x * 8 + simdgroup_index_in_threadgroup * 4;

float r0 = 0, r1 = 0, r2 = 0, r3 = 0;
for (uint k = 0; k < cols; k += 512) {
    
const device T* xl = x + k + lane * 16;
float sum = 0;
float xt[16];
for (uint i = 0; i < 4; ++i) {
    float x0 = xl[4 * i], x1 = xl[4 * i + 1], x2 = xl[4 * i + 2], x3 = xl[4 * i + 3];
    sum += x0 + x1 + x2 + x3;
    xt[4 * i] = x0;
    xt[4 * i + 1] = x1 / 16.0f;
    xt[4 * i + 2] = x2 / 256.0f;
    xt[4 * i + 3] = x3 / 4096.0f;
}

    r0 += qdot4(w + (row + 0 + 0) * (cols / 8) + k / 8 + lane * 2, xt, sum, scales[(row + 0 + 0) * (cols / 64) + k / 64 + lane / 4], biases[(row + 0 + 0) * (cols / 64) + k / 64 + lane / 4]);
    r1 += qdot4(w + (row + 1 + 0) * (cols / 8) + k / 8 + lane * 2, xt, sum, scales[(row + 1 + 0) * (cols / 64) + k / 64 + lane / 4], biases[(row + 1 + 0) * (cols / 64) + k / 64 + lane / 4]);
    r2 += qdot4(w + (row + 2 + 0) * (cols / 8) + k / 8 + lane * 2, xt, sum, scales[(row + 2 + 0) * (cols / 64) + k / 64 + lane / 4], biases[(row + 2 + 0) * (cols / 64) + k / 64 + lane / 4]);
    r3 += qdot4(w + (row + 3 + 0) * (cols / 8) + k / 8 + lane * 2, xt, sum, scales[(row + 3 + 0) * (cols / 64) + k / 64 + lane / 4], biases[(row + 3 + 0) * (cols / 64) + k / 64 + lane / 4]);
}
r0 = simd_sum(r0); r1 = simd_sum(r1); r2 = simd_sum(r2); r3 = simd_sum(r3);
if (lane == 0) {
    y[row] = Y(r0); y[row + 1] = Y(r1); y[row + 2] = Y(r2); y[row + 3] = Y(r3);
}
"""#
    static let denseMV = #"""
uint lane = thread_index_in_simdgroup;
uint row = threadgroup_position_in_grid.x * 8 + simdgroup_index_in_threadgroup * 4;

float r0 = 0, r1 = 0, r2 = 0, r3 = 0;
for (uint k = 0; k < cols; k += 512) {
    
const device T* xl = x + k + lane * 16;
float xt[16];
for (uint i = 0; i < 16; ++i) xt[i] = xl[i];

    r0 += dot16(w + (row + 0 + 0) * cols + k + lane * 16, xt);
    r1 += dot16(w + (row + 1 + 0) * cols + k + lane * 16, xt);
    r2 += dot16(w + (row + 2 + 0) * cols + k + lane * 16, xt);
    r3 += dot16(w + (row + 3 + 0) * cols + k + lane * 16, xt);
}
r0 = simd_sum(r0); r1 = simd_sum(r1); r2 = simd_sum(r2); r3 = simd_sum(r3);
if (lane == 0) {
    y[row] = Y(r0); y[row + 1] = Y(r1); y[row + 2] = Y(r2); y[row + 3] = Y(r3);
}
"""#
    static let gate = #"""
uint lane = thread_index_in_simdgroup;
uint row = threadgroup_position_in_grid.x * 8 + simdgroup_index_in_threadgroup * 4;

float g0 = 0, g1 = 0, g2 = 0, g3 = 0, u0 = 0, u1 = 0, u2 = 0, u3 = 0;
for (uint k = 0; k < cols; k += 512) {
    
const device T* xl = x + k + lane * 16;
float sum = 0;
float xt[16];
for (uint i = 0; i < 4; ++i) {
    float x0 = xl[4 * i], x1 = xl[4 * i + 1], x2 = xl[4 * i + 2], x3 = xl[4 * i + 3];
    sum += x0 + x1 + x2 + x3;
    xt[4 * i] = x0;
    xt[4 * i + 1] = x1 / 16.0f;
    xt[4 * i + 2] = x2 / 256.0f;
    xt[4 * i + 3] = x3 / 4096.0f;
}

    g0 += qdot4(w + (row + 0 + 0) * (cols / 8) + k / 8 + lane * 2, xt, sum, scales[(row + 0 + 0) * (cols / 64) + k / 64 + lane / 4], biases[(row + 0 + 0) * (cols / 64) + k / 64 + lane / 4]);
    g1 += qdot4(w + (row + 1 + 0) * (cols / 8) + k / 8 + lane * 2, xt, sum, scales[(row + 1 + 0) * (cols / 64) + k / 64 + lane / 4], biases[(row + 1 + 0) * (cols / 64) + k / 64 + lane / 4]);
    g2 += qdot4(w + (row + 2 + 0) * (cols / 8) + k / 8 + lane * 2, xt, sum, scales[(row + 2 + 0) * (cols / 64) + k / 64 + lane / 4], biases[(row + 2 + 0) * (cols / 64) + k / 64 + lane / 4]);
    g3 += qdot4(w + (row + 3 + 0) * (cols / 8) + k / 8 + lane * 2, xt, sum, scales[(row + 3 + 0) * (cols / 64) + k / 64 + lane / 4], biases[(row + 3 + 0) * (cols / 64) + k / 64 + lane / 4]);
    u0 += qdot4(w + (row + 0 + half_rows) * (cols / 8) + k / 8 + lane * 2, xt, sum, scales[(row + 0 + half_rows) * (cols / 64) + k / 64 + lane / 4], biases[(row + 0 + half_rows) * (cols / 64) + k / 64 + lane / 4]);
    u1 += qdot4(w + (row + 1 + half_rows) * (cols / 8) + k / 8 + lane * 2, xt, sum, scales[(row + 1 + half_rows) * (cols / 64) + k / 64 + lane / 4], biases[(row + 1 + half_rows) * (cols / 64) + k / 64 + lane / 4]);
    u2 += qdot4(w + (row + 2 + half_rows) * (cols / 8) + k / 8 + lane * 2, xt, sum, scales[(row + 2 + half_rows) * (cols / 64) + k / 64 + lane / 4], biases[(row + 2 + half_rows) * (cols / 64) + k / 64 + lane / 4]);
    u3 += qdot4(w + (row + 3 + half_rows) * (cols / 8) + k / 8 + lane * 2, xt, sum, scales[(row + 3 + half_rows) * (cols / 64) + k / 64 + lane / 4], biases[(row + 3 + half_rows) * (cols / 64) + k / 64 + lane / 4]);
}
g0 = simd_sum(g0); g1 = simd_sum(g1); g2 = simd_sum(g2); g3 = simd_sum(g3);
u0 = simd_sum(u0); u1 = simd_sum(u1); u2 = simd_sum(u2); u3 = simd_sum(u3);
float g = lane == 0 ? g0 : lane == 1 ? g1 : lane == 2 ? g2 : g3;
float u = lane == 0 ? u0 : lane == 1 ? u1 : lane == 2 ? u2 : u3;
if (lane < 4) y[row + lane] = T(g / (1.0f + exp(-g)) * u);
"""#
    static let norm = #"""
threadgroup float partial[groups];
uint sg = simdgroup_index_in_threadgroup;
uint lane = thread_index_in_simdgroup;
uint at = sg * 32 + lane;
uint steps = n / (groups * 32);
float sum = 0, s;
for (uint i = 0; i < steps; ++i) { float v = a[at + i * groups * 32]; sum += v * v; }

sum = simd_sum(sum);
if (lane == 0) partial[sg] = sum;
threadgroup_barrier(mem_flags::mem_threadgroup);
s = rsqrt(simd_sum(lane < groups ? partial[lane] : 0.0f) / float(n) + eps);
threadgroup_barrier(mem_flags::mem_threadgroup);

sum = 0;
for (uint i = 0; i < steps; ++i) {
    uint j = at + i * groups * 32;
    T t = T(float(b[j]) + float(T(float(T(float(a[j]) * s)) * wa[j])));
    r[j] = t;
    sum += float(t) * float(t);
}

sum = simd_sum(sum);
if (lane == 0) partial[sg] = sum;
threadgroup_barrier(mem_flags::mem_threadgroup);
s = rsqrt(simd_sum(lane < groups ? partial[lane] : 0.0f) / float(n) + eps);
threadgroup_barrier(mem_flags::mem_threadgroup);

for (uint i = 0; i < steps; ++i) {
    uint j = at + i * groups * 32;
    normed[j] = T(float(T(float(r[j]) * s)) * wb[j]);
}
"""#
    static let embed = #"""
threadgroup float partial[groups];
uint sg = simdgroup_index_in_threadgroup;
uint lane = thread_index_in_simdgroup;
uint at = sg * 32 + lane;
uint steps = n / (groups * 32);
const device T* e = table + uint(token[0]) * n;
float sum = 0, s;
for (uint i = 0; i < steps; ++i) { float v = e[at + i * groups * 32]; sum += v * v; }

sum = simd_sum(sum);
if (lane == 0) partial[sg] = sum;
threadgroup_barrier(mem_flags::mem_threadgroup);
s = rsqrt(simd_sum(lane < groups ? partial[lane] : 0.0f) / float(n) + eps);
threadgroup_barrier(mem_flags::mem_threadgroup);

for (uint i = 0; i < steps; ++i) {
    uint j = at + i * groups * 32;
    T v = e[j];
    r[j] = v;
    normed[j] = T(float(T(float(v) * s)) * wb[j]);
}
"""#
    static let attention = #"""
threadgroup float qh[128], ks[128], partial[groups * 128], denoms[groups];
uint head = threadgroup_position_in_grid.x;
uint group = head / head_ratio;
uint sg = simdgroup_index_in_threadgroup;
uint lane = thread_index_in_simdgroup;
uint slot = params[1], stored = params[2], cap = params[3];
const device T* table = rope + params[0] * 128;
const device T* own_key = qkv + q_dim + group * 128;
const device T* own_value = qkv + q_dim + kv_dim + group * 128 + lane;
if (sg < 2) {
    const device T* src = sg == 0 ? qkv + head * 128 : own_key;
    const device float* nw = sg == 0 ? q_weight : k_weight;
    float a0 = src[lane], a1 = src[lane + 32], a2 = src[lane + 64], a3 = src[lane + 96];
    float s = rsqrt(simd_sum(a0 * a0 + a1 * a1 + a2 * a2 + a3 * a3) / 128.0f + eps);
    a0 = float(T(float(T(a0 * s)) * nw[lane]));
    a1 = float(T(float(T(a1 * s)) * nw[lane + 32]));
    a2 = float(T(float(T(a2 * s)) * nw[lane + 64]));
    a3 = float(T(float(T(a3 * s)) * nw[lane + 96]));
    float c0 = table[lane], c1 = table[lane + 32], s0 = table[lane + 64], s1 = table[lane + 96];
    T r0 = T(a0 * c0 - a2 * s0), r1 = T(a1 * c1 - a3 * s1), r2 = T(a2 * c0 + a0 * s0), r3 = T(a3 * c1 + a1 * s1);
    if (sg == 0) {
        qh[lane] = r0; qh[lane + 32] = r1; qh[lane + 64] = r2; qh[lane + 96] = r3;
    } else {
        ks[lane] = r0; ks[lane + 32] = r1; ks[lane + 64] = r2; ks[lane + 96] = r3;
        if (head % head_ratio == 0) {
            device T* kw = const_cast<device T*>(keys) + (group * cap + slot) * 128 + lane;
            kw[0] = r0; kw[32] = r1; kw[64] = r2; kw[96] = r3;
            device T* vw = const_cast<device T*>(values) + (group * cap + slot) * 128 + lane;
            vw[0] = own_value[0]; vw[32] = own_value[32]; vw[64] = own_value[64]; vw[96] = own_value[96];
        }
    }
}
threadgroup_barrier(mem_flags::mem_threadgroup);
float q0 = qh[lane], q1 = qh[lane + 32], q2 = qh[lane + 64], q3 = qh[lane + 96];
// Softmax relative to the query's own key: exp cannot overflow and the denominator stays positive.
float bias = simd_sum(q0 * ks[lane] + q1 * ks[lane + 32] + q2 * ks[lane + 64] + q3 * ks[lane + 96]) * attention_scale;
bool first = sg == 0;
float a0 = first ? float(own_value[0]) : 0.0f, a1 = first ? float(own_value[32]) : 0.0f;
float a2 = first ? float(own_value[64]) : 0.0f, a3 = first ? float(own_value[96]) : 0.0f;
float den = first ? 1.0f : 0.0f;
for (uint j = sg; j < stored; j += groups) {
    if (j == slot) continue;
    const device T* kr = keys + (group * cap + j) * 128 + lane;
    float p = exp(min(simd_sum(q0 * kr[0] + q1 * kr[32] + q2 * kr[64] + q3 * kr[96]) * attention_scale - bias, 70.0f));
    const device T* vr = values + (group * cap + j) * 128 + lane;
    den += p;
    a0 += p * vr[0]; a1 += p * vr[32]; a2 += p * vr[64]; a3 += p * vr[96];
}
uint at = sg * 128 + lane;
partial[at] = a0; partial[at + 32] = a1; partial[at + 64] = a2; partial[at + 96] = a3;
if (lane == 0) denoms[sg] = den;
threadgroup_barrier(mem_flags::mem_threadgroup);
if (sg < 4) {
    float total = simd_sum(lane < groups ? denoms[lane] : 0.0f);
    float acc = 0;
    for (uint i = 0; i < groups; ++i) acc += partial[i * 128 + sg * 32 + lane];
    out[head * 128 + sg * 32 + lane] = T(acc / total);
}
"""#
}
