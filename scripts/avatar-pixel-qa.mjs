/**
 * Code-native avatar raster QA, without a browser or third-party dependencies.
 * Models only the renderer's axis-aligned Canvas2D rectangles and source-over
 * alpha compositing. PNGs are actual drawAvatar/drawItem output through this
 * adapter. It does not validate CSS sizing, browser antialiasing, or hit areas.
 *
 * node scripts/avatar-pixel-qa.mjs --out /tmp/haru-pixel-qa [--full]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const colorCache = new Map();
function color(value) {
  if (colorCache.has(value)) return colorCache.get(value);
  let hex = String(value).replace(/^#/, '');
  if (/^[0-9a-f]{3,4}$/i.test(hex)) hex = [...hex].map(x => x + x).join('');
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex)) throw new Error(`Unsupported color: ${value}`);
  const rgba = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
  rgba.push(hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : 255);
  colorCache.set(value, rgba);
  return rgba;
}

export class PixelCanvas {
  constructor(width = 96, height = width) {
    this._width = width; this._height = height;
    this.context = new PixelContext(this); this.reset();
  }
  get width() { return this._width; }
  set width(value) { this._width = value; this.reset(); }
  get height() { return this._height; }
  set height(value) { this._height = value; this.reset(); }
  reset() {
    this.pixels = new Uint8Array(this.width * this.height * 4);
    this.clipped = []; this.bounds = null; this.calls = 0;
    this.context?.reset();
  }
  getContext(type) { if (type !== '2d') throw new Error(`Unsupported context: ${type}`); return this.context; }
}

class PixelContext {
  constructor(canvas) { this.canvas = canvas; this.reset(); }
  reset() { this.fillStyle = '#000000'; this.globalAlpha = 1; this.imageSmoothingEnabled = true; this.matrix = [1, 0, 0, 1, 0, 0]; this.stack = []; }
  save() { this.stack.push({ fillStyle: this.fillStyle, globalAlpha: this.globalAlpha, imageSmoothingEnabled: this.imageSmoothingEnabled, matrix: [...this.matrix] }); }
  restore() { Object.assign(this, this.stack.pop() || {}); }
  setTransform(a, b, c, d, e, f) {
    if (![a, b, c, d, e, f].every(Number.isFinite) || b !== 0 || c !== 0) throw new Error('Raster QA only supports finite axis-aligned transforms.');
    this.matrix = [a, b, c, d, e, f];
  }
  translate(x, y) { const m = this.matrix; m[4] += m[0] * x; m[5] += m[3] * y; }
  scale(x, y) { this.matrix[0] *= x; this.matrix[3] *= y; }
  fillRect(x, y, width, height) { this.paint(x, y, width, height, color(this.fillStyle)); }
  clearRect(x, y, width, height) { this.paint(x, y, width, height, null); }
  paint(x, y, width, height, rgba) {
    if (![x, y, width, height].every(Number.isFinite)) throw new Error('Non-finite rectangle');
    const [a, , , d, e, f] = this.matrix, canvas = this.canvas;
    const xA = x * a + e, xB = (x + width) * a + e, yA = y * d + f, yB = (y + height) * d + f;
    const left = Math.ceil(Math.min(xA, xB) - .5), right = Math.ceil(Math.max(xA, xB) - .5);
    const top = Math.ceil(Math.min(yA, yB) - .5), bottom = Math.ceil(Math.max(yA, yB) - .5);
    if (left === right || top === bottom) return;
    if (rgba && rgba[3] && this.globalAlpha) {
      canvas.calls++;
      if (left < 0 || top < 0 || right > canvas.width || bottom > canvas.height) {
        if (canvas.clipped.length < 8) canvas.clipped.push({ left, top, right, bottom, color: this.fillStyle });
      }
      const prior = canvas.bounds;
      canvas.bounds = prior ? [Math.min(prior[0], left), Math.min(prior[1], top), Math.max(prior[2], right), Math.max(prior[3], bottom)] : [left, top, right, bottom];
    }
    for (let yy = Math.max(0, top); yy < Math.min(canvas.height, bottom); yy++) {
      for (let xx = Math.max(0, left); xx < Math.min(canvas.width, right); xx++) {
        const i = (yy * canvas.width + xx) * 4;
        if (!rgba) canvas.pixels.fill(0, i, i + 4);
        else blend(canvas.pixels, i, rgba, this.globalAlpha);
      }
    }
  }
}

function blend(target, i, rgba, globalAlpha = 1) {
  const alpha = rgba[3] / 255 * globalAlpha;
  if (!alpha) return;
  if (alpha === 1) { target.set(rgba, i); return; }
  const prior = target[i + 3] / 255, combined = alpha + prior * (1 - alpha);
  for (let k = 0; k < 3; k++) target[i + k] = Math.round((rgba[k] * alpha + target[i + k] * prior * (1 - alpha)) / combined);
  target[i + 3] = Math.round(combined * 255);
}

const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function chunk(type, data) {
  const name = Buffer.from(type), body = Buffer.concat([name, data]); let crc = 0xffffffff;
  for (const byte of body) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length, 0); body.copy(result, 4); result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
  return result;
}
export function png(canvas) {
  const header = Buffer.alloc(13); header.writeUInt32BE(canvas.width, 0); header.writeUInt32BE(canvas.height, 4); header[8] = 8; header[9] = 6;
  const stride = canvas.width * 4, rows = Buffer.alloc((stride + 1) * canvas.height);
  for (let y = 0; y < canvas.height; y++) rows.set(canvas.pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

// Tiny fixed-width labels keep this script dependency-free. Sprites themselves
// always come from the production module, never this label alphabet.
const glyphs = {
  A:'010/101/111/101/101',B:'110/101/110/101/110',C:'011/100/100/100/011',D:'110/101/101/101/110',E:'111/100/110/100/111',F:'111/100/110/100/100',G:'011/100/101/101/011',H:'101/101/111/101/101',I:'111/010/010/010/111',J:'001/001/001/101/010',K:'101/101/110/101/101',L:'100/100/100/100/111',M:'101/111/111/101/101',N:'101/111/111/111/101',O:'010/101/101/101/010',P:'110/101/110/100/100',Q:'010/101/101/111/011',R:'110/101/110/101/101',S:'011/100/010/001/110',T:'111/010/010/010/010',U:'101/101/101/101/111',V:'101/101/101/101/010',W:'101/101/111/111/101',X:'101/101/010/101/101',Y:'101/101/010/010/010',Z:'111/001/010/100/111',
  0:'111/101/101/101/111',1:'010/110/010/010/111',2:'110/001/010/100/111',3:'110/001/010/001/110',4:'101/101/111/001/001',5:'111/100/110/001/110',6:'011/100/110/101/010',7:'111/001/010/010/010',8:'010/101/010/101/010',9:'010/101/011/001/110','-':'000/000/111/000/000','/':'001/001/010/100/100'
};
function label(canvas, text, x, y, scale = 2) {
  const context = canvas.getContext('2d'); context.fillStyle = '#655865';
  [...text.toUpperCase()].forEach((char, index) => (glyphs[char] || '000/000/000/000/000').split('/').forEach((row, yy) => [...row].forEach((on, xx) => { if (on === '1') context.fillRect(x + (index * 4 + xx) * scale, y + yy * scale, scale, scale); })));
}
function paste(target, source, x, y, size = source.width) {
  for (let yy = 0; yy < size; yy++) for (let xx = 0; xx < size; xx++) {
    const sy = Math.min(source.height - 1, Math.floor((yy + .5) * source.height / size));
    const sx = Math.min(source.width - 1, Math.floor((xx + .5) * source.width / size));
    const i = (sy * source.width + sx) * 4;
    blend(target.pixels, ((y + yy) * target.width + x + xx) * 4, source.pixels.subarray(i, i + 4));
  }
}
function sheet(samples, columns = 6, size = 192, cellWidth = size + 24, cellHeight = size + 44) {
  const result = new PixelCanvas(columns * cellWidth, Math.ceil(samples.length / columns) * cellHeight);
  result.context.fillStyle = '#f7f2ec'; result.context.fillRect(0, 0, result.width, result.height);
  samples.forEach((sample, index) => {
    const col = index % columns, row = Math.floor(index / columns), actual = sample.size || size;
    paste(result, sample.canvas, col * cellWidth + Math.floor((cellWidth - actual) / 2), row * cellHeight + 10, actual);
    const scale = sample.label.length * 8 <= cellWidth - 12 ? 2 : 1;
    label(result, sample.label, col * cellWidth + Math.floor((cellWidth - sample.label.length * 4 * scale) / 2), row * cellHeight + size + 20, scale);
  });
  return result;
}
function digest(canvas) { return createHash('sha256').update(canvas.pixels).digest('hex'); }
function diagnostics(canvas) {
  let visible = 0; for (let i = 3; i < canvas.pixels.length; i += 4) if (canvas.pixels[i]) visible++;
  return { width: canvas.width, height: canvas.height, visiblePixels: visible, bounds: canvas.bounds, clipped: canvas.clipped, rectangleCalls: canvas.calls, hash: digest(canvas) };
}

export async function runQA({ source = new URL('../public/game/avatar.js', import.meta.url), out = '/tmp/haru-pixel-qa', full = false, prefix = '' } = {}) {
  await mkdir(out, { recursive: true });
  const { drawAvatar, drawItem, AVATAR_OPTIONS, AVATAR_SIZE } = await import(typeof source === 'string' ? pathToFileURL(resolve(source)).href : source.href);
  const render = options => { const canvas = new PixelCanvas(); drawAvatar(canvas, options); return canvas; };
  const save = (name, canvas) => writeFile(resolve(out, `${prefix}${name}.png`), png(canvas));
  const report = { renderer: String(source), logicalSize: AVATAR_SIZE, scope: 'Production rectangle calls rasterized without a browser. Nearest-neighbor 32/40px samples are illustrative; CSS layout and browser sampling are not tested.', friends: [], full: null };
  const friends = AVATAR_OPTIONS.character.map(character => ({ label: character, canvas: render({ character, background: 'transparent' }) }));
  const happy = AVATAR_OPTIONS.character.map(character => ({ label: `${character} happy`, canvas: render({ character, background: 'transparent', pose: 'happy' }) }));
  report.friends = [...friends, ...happy].map(sample => ({ label: sample.label, ...diagnostics(sample.canvas) }));
  await save('friends', sheet([...friends, ...happy]));
  await save('small-samples', sheet([32,40].flatMap(size => friends.map(sample => ({ ...sample, size, label: `${sample.label} ${size}` }))), 6, 40, 104, 84));
  for (const sample of friends) await save(`friend-${sample.label}`, sample.canvas);
  for (const slot of ['outfit', 'hat', 'accessory']) {
    const samples = AVATAR_OPTIONS.character.flatMap(character => AVATAR_OPTIONS[slot].map(value => {
      const canvas = new PixelCanvas(); drawItem(canvas, { slot, value, equipped: { character, background: 'transparent' } });
      return { label: `${character}/${value}`, canvas };
    }));
    await save(slot, sheet(samples, AVATAR_OPTIONS[slot].length, 96, 120, 130));
  }
  await save('background', sheet(AVATAR_OPTIONS.background.map(background => ({ label: background, canvas: render({ background }) })), 5, 144, 168, 182));
  if (full) {
    const failures = [], duplicates = [], hashes = new Map(); let count = 0;
    for (const character of AVATAR_OPTIONS.character) for (const outfit of AVATAR_OPTIONS.outfit) for (const hat of AVATAR_OPTIONS.hat) for (const accessory of AVATAR_OPTIONS.accessory) for (const pose of AVATAR_OPTIONS.pose) {
      const options = { character, outfit, hat, accessory, pose, background: 'transparent' };
      const canvas = render(options); count++;
      if (canvas.clipped.length || !canvas.bounds) failures.push({ options, clipped: canvas.clipped, bounds: canvas.bounds });
      const hash = digest(canvas), key = [character, outfit, hat, accessory, pose].join('/');
      if (hashes.has(hash)) duplicates.push({ first: hashes.get(hash), second: key }); else hashes.set(hash, key);
    }
    report.full = { combinations: count, uniqueRenders: hashes.size, clippedOrEmpty: failures, identicalCombinationPairs: duplicates };
  }
  await writeFile(resolve(out, `${prefix}report.json`), JSON.stringify(report, null, 2) + '\n');
  return { out, logicalSize: AVATAR_SIZE, friends: report.friends.length, full: report.full && { combinations: report.full.combinations, uniqueRenders: report.full.uniqueRenders, clippedOrEmpty: report.full.clippedOrEmpty.length, identicalCombinationPairs: report.full.identicalCombinationPairs.length } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), value = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
  const result = await runQA({ source: value('--source'), out: value('--out'), prefix: value('--prefix'), full: args.includes('--full') });
  console.log(JSON.stringify(result, null, 2));
  // Preserve the report and sheets for diagnosis before failing the CLI gate.
  if (result.full && (result.full.clippedOrEmpty || result.full.identicalCombinationPairs)) process.exitCode = 1;
}
