#!/usr/bin/env node
/**
 * make-sample-bin.js — 生成一个合成的 RIGOL .bin 波形文件（RG01 格式）。
 *
 * 用途：没有实物示波器时，用它造一个可被 index.html 正常打开的测试文件，
 *      方便演示、截图和验证解析逻辑。
 *
 * 用法：
 *   node tools/make-sample-bin.js                # 写到 sample/DHO814_demo.bin
 *   node tools/make-sample-bin.js out.bin        # 写到指定路径
 *   node tools/make-sample-bin.js out.bin --points 500000 --rate 2e9
 *
 * 参数：
 *   --points N    每通道采样点数（默认 200000）
 *   --rate  F     采样率 Hz（默认 1e9，即 1 GS/s）
 *   --cookie S    文件标识，可选 RG01 / RG02 / RG03（默认 RG01）
 */

const fs = require('fs');
const path = require('path');

const FILE_HDR_SIZE = 128;
const CH_HDR_SIZE = 140;

// ---------------------------------------------------------------- CLI parsing
function parseArgs(argv) {
  const out = { out: null, points: 200000, rate: 1e9, cookie: 'RG01' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--points') out.points = parseInt(argv[++i], 10);
    else if (a === '--rate') out.rate = parseFloat(argv[++i]);
    else if (a === '--cookie') out.cookie = argv[++i].toUpperCase();
    else if (!out.out) out.out = a;
  }
  if (!['RG01', 'RG02', 'RG03'].includes(out.cookie)) {
    throw new Error(`未知 cookie "${out.cookie}"，可选 RG01 / RG02 / RG03`);
  }
  if (!Number.isFinite(out.points) || out.points <= 0) {
    throw new Error('--points 必须是正整数');
  }
  if (!Number.isFinite(out.rate) || out.rate <= 0) {
    throw new Error('--rate 必须是正数（Sa/s）');
  }
  return out;
}

// ------------------------------------------------------------ signal helpers
/** 0.8 Vpp / 10 kHz 正弦，带一点点确定性噪声 */
function sine(n, i, freq, dt) {
  const t = i * dt;
  const v = 0.8 * Math.sin(2 * Math.PI * freq * t);
  const noise = 0.012 * Math.sin(2 * Math.PI * 37_000 * t * 1.7);
  return v + noise;
}

/** 0 → 1.8 V 方波，带 3 ns 上升/下降沿和过冲 */
function pulse(n, i, freq, dt) {
  const t = i * dt;
  const period = 1 / freq;
  const phase = t % period;
  const high = phase < period * 0.25;
  const edge = period * 0.02;
  let v;
  if (high) v = 1.8;
  else v = 0;
  // 边沿附近的线性过渡 + 过冲，让波形看起来像真的探到的信号
  if (phase < edge || (phase > period * 0.25 && phase < period * 0.25 + edge)) {
    const frac = phase < edge ? phase / edge : (phase - period * 0.25) / edge;
    v = 0.9 * frac + (high ? 0.9 : -0.9) * (1 - frac);
  }
  const overshoot = 0.12 * Math.exp(-((phase - period * 0.25) ** 2) / (2 * (period * 0.03) ** 2));
  return v + overshoot;
}

// ------------------------------------------------------------------- builder
function buildFile({ points, rate, cookie }) {
  const dt = 1 / rate;                 // x_increment，秒/点
  const nCh = 2;
  const dataBytes = points * 4;

  const buf = Buffer.alloc(FILE_HDR_SIZE + nCh * (CH_HDR_SIZE + dataBytes));

  // ---- 文件头 ----
  buf.write(cookie, 0, 'ascii');                       // 0x00 cookie
  buf.writeUInt32LE(buf.length, 4);                    // 0x04 声明的文件总长度
  buf.writeUInt32LE(1, 8);                             // 0x08 版本占位
  buf.writeUInt32LE(nCh, 0x0C);                        // 0x0C 通道数
  buf.writeUInt32LE(CH_HDR_SIZE, 0x10);                // 0x10 每通道头长度
  buf.writeUInt32LE(0, 0x14);
  buf.writeUInt32LE(points, 0x1C);                     // 0x1C 每通道点数
  buf.writeDoubleLE(dt, 0x30);                         // 0x30 x_increment（秒）

  // 头部里的 ASCII 元信息：解析器在前 256 字节内用正则捞型号/序列号/日期
  const meta = 'DHO814:DEMO0000001 2026-09-28 14:30:00 RIGOL Digital Oscilloscope';
  buf.write(meta, 0x50, 'ascii');

  // ---- 每个通道：CH 标记 + 140 字节通道头 + float32 数据 ----
  const signals = [
    { name: 'CH1', gen: (i) => sine(points, i, 10_000, dt) },
    { name: 'CH2', gen: (i) => pulse(points, i, 50_000, dt) },
  ];

  let off = FILE_HDR_SIZE;
  for (let c = 0; c < nCh; c++) {
    buf.write(signals[c].name, off, 'ascii');          // "CH1" / "CH2" 标记（后跟 \0）
    buf.writeUInt8(0, off + 3);
    buf.writeDoubleLE(1.0, off + 24);                  // 探头倍率
    buf.writeDoubleLE(1.0, off + 32);                  // 垂直偏移

    const dataStart = off + CH_HDR_SIZE;
    for (let i = 0; i < points; i++) {
      buf.writeFloatLE(signals[c].gen(i), dataStart + i * 4);
    }
    off = dataStart + dataBytes;
  }

  return buf;
}

// ---------------------------------------------------------------------- main
try {
  const args = parseArgs(process.argv.slice(2));
  const outPath = path.resolve(
    args.out || path.join(__dirname, '..', 'sample', 'DHO814_demo.bin')
  );
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const buf = buildFile(args);
  fs.writeFileSync(outPath, buf);

  const dt = 1 / args.rate;
  console.log(`已生成 ${args.cookie} 波形文件`);
  console.log(`  路径    : ${outPath}`);
  console.log(`  通道数  : 2`);
  console.log(`  每通道点: ${args.points.toLocaleString()}`);
  console.log(`  采样率  : ${args.rate.toLocaleString()} Sa/s (Δt = ${(dt * 1e9).toFixed(3)} ns)`);
  console.log(`  总时长  : ${(args.points * dt * 1e3).toFixed(3)} ms`);
  console.log(`  文件大小: ${(buf.length / 1024 / 1024).toFixed(2)} MB`);
} catch (err) {
  console.error(`错误: ${err.message}`);
  console.error('用法: node tools/make-sample-bin.js [输出路径] [--points N] [--rate F] [--cookie RG01|RG02|RG03]');
  process.exit(1);
}
