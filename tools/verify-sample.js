/**
 * verify-sample.js — 用 index.html 里原封不动的解析器去校验生成的 .bin，
 * 确认「生成器」和「查看器」对同一个格式的理解一致。
 */
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('const RIGOL_FORMATS');
const end = html.indexOf('// LTTB (Largest Triangle Three Buckets) DOWNSAMPLING');
if (start < 0 || end < 0) throw new Error('无法在 index.html 中定位解析器代码段');

const parserSrc = html.slice(start, html.lastIndexOf('// ====', end));
const parseRigolBin = new Function(`${parserSrc}; return parseRigolBin;`)();

const binPath = process.argv[2] ||
  path.join(__dirname, '..', 'sample', 'DHO814_demo.bin');
const buf = fs.readFileSync(binPath);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

const wf = parseRigolBin(ab);

console.log(`文件        : ${path.basename(binPath)}`);
console.log(`格式        : ${wf.format.name} (${wf.format.desc})`);
console.log(`型号/序列号 : ${wf.model} / ${wf.serial}`);
console.log(`日期        : ${wf.date} ${wf.time}`);
console.log(`通道数      : ${wf.channels.length}`);
console.log(`每通道点数  : ${wf.nSamples.toLocaleString()}`);
console.log(`采样率      : ${(wf.sampleRate / 1e6).toFixed(1)} MSa/s`);
console.log(`总时长      : ${(wf.duration * 1e3).toFixed(3)} ms`);
for (const ch of wf.channels) {
  const nan = ch.samples.reduce((n, v) => n + (Number.isNaN(v) ? 1 : 0), 0);
  console.log(
    `  ${ch.name}: min=${ch.min.toFixed(4)}V max=${ch.max.toFixed(4)}V ` +
    `mean=${ch.mean.toFixed(4)}V σ=${ch.std.toFixed(4)}V NaN=${nan}`
  );
}

// 断言
const fail = [];
if (wf.channels.length !== 2) fail.push('通道数应为 2');
if (wf.nSamples !== 200000) fail.push(`点数应为 200000，实际 ${wf.nSamples}`);
if (Math.abs(wf.sampleRate - 1e9) > 1) fail.push('采样率应为 1 GS/s');
if (!wf.model) fail.push('未能解析出型号');
if (wf.channels.some(c => c.samples.some(v => Number.isNaN(v)))) fail.push('数据中含 NaN');
if (wf.channels[0].max < 0.7 || wf.channels[0].max > 0.9) fail.push('CH1 幅度不在预期范围');

if (fail.length) {
  console.error('\n❌ 校验失败:\n  - ' + fail.join('\n  - '));
  process.exit(1);
}
console.log('\n✅ 校验通过：生成的文件能被 index.html 的解析器正确读取');
