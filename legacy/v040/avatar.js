/**
 * 하루다섯 — original, code-native animal friends and wardrobe pixel art.
 * No assets, network requests, timers, or global rendering state.
 * Set image-rendering: pixelated on the canvas in the application stylesheet.
 */

export const AVATAR_OPTIONS = Object.freeze({
  character: Object.freeze(['rabbit', 'cat', 'bear', 'fox', 'puppy', 'penguin']),
  outfit: Object.freeze(['mint', 'lilac', 'peach', 'sky', 'lemon', 'rose', 'cocoa', 'sailor', 'raincoat', 'overalls', 'wizard', 'strawberry', 'navy']),
  hat: Object.freeze(['none', 'beret', 'flower', 'star', 'crown', 'straw', 'beanie', 'sprout', 'mushroom', 'ribbon', 'headphones']),
  accessory: Object.freeze(['none', 'scarf', 'bag', 'bell', 'glasses', 'book', 'balloon', 'wand', 'camera', 'flowerbasket', 'lantern', 'wings']),
  pose: Object.freeze(['idle', 'happy']),
  background: Object.freeze(['transparent', 'garden', 'lavender', 'beach', 'forest', 'sunset', 'snow', 'cloud', 'cafe', 'night']),
});

export const AVATAR_SIZE = 96;

const COLORS = Object.freeze({
  outline: '#6b5269',
  shade: '#e5c7bd',
  cream: '#fff1db',
  highlight: '#fff9e9',
  ink: '#3e344a',
  nose: '#ba7487',
  blush: '#eea3b0',
  innerEar: '#eeadc3',
  innerEarShade: '#c879a0',
  gold: '#efc66c',
  goldLight: '#fff0b7',
  goldShade: '#a77d48',
});

const OUTFITS = Object.freeze({
  mint: { main: '#83c8ad', light: '#b9e4c8', shade: '#5c9e87', edge: '#4b7f6e' },
  lilac: { main: '#b99ad6', light: '#dfc8ed', shade: '#9274b0', edge: '#775f92' },
  peach: { main: '#ecaa95', light: '#f9d3b9', shade: '#cb8a7a', edge: '#b27668' },
  sky: { main: '#8dbbd5', light: '#c4e2eb', shade: '#6395b3', edge: '#52788f' },
  lemon: { main: '#efd277', light: '#fff0ab', shade: '#c8a84e', edge: '#a58b4d' },
  rose: { main: '#dc99b3', light: '#f8cddd', shade: '#b77396', edge: '#99677f' },
  cocoa: { main: '#bda187', light: '#e6cfac', shade: '#987d69', edge: '#796653' },
  sailor: { main: '#f4eddc', light: '#fff8e9', shade: '#d3d6cf', edge: '#768b9b' },
  raincoat: { main: '#f2cf65', light: '#fff2b0', shade: '#d8a742', edge: '#b4883c' },
  overalls: { main: '#789dbb', light: '#b6d5de', shade: '#547e9e', edge: '#45677f' },
  wizard: { main: '#9581b9', light: '#c2b3de', shade: '#746394', edge: '#594b78' },
  strawberry: { main: '#e79baa', light: '#ffced2', shade: '#c2768d', edge: '#a06175' },
  navy: { main: '#506c8e', light: '#8aa6bc', shade: '#354e6b', edge: '#2d4057' },
});

const FUR = Object.freeze({
  rabbit: COLORS,
  cat: { ...COLORS, outline: '#645779', shade: '#aea0ce', cream: '#d6c8ec', highlight: '#eee4fa', nose: '#b87d9a' },
  bear: { ...COLORS, outline: '#6e493d', shade: '#c78c57', cream: '#eebc77', highlight: '#ffda95', nose: '#66403a', innerEar: '#b87860', blush: '#e99990' },
  fox: { ...COLORS, outline: '#80474c', shade: '#d87a49', cream: '#f5a55d', highlight: '#ffd394', nose: '#533c44', innerEar: '#73444e' },
  puppy: { ...COLORS, outline: '#715345', shade: '#e3c3a2', cream: '#fff1d6', highlight: '#fff9e7', nose: '#684a45', innerEar: '#b88263' },
  penguin: { ...COLORS, outline: '#344966', shade: '#50648e', cream: '#7088b1', highlight: '#a0b6d3', nose: '#ffd072', blush: '#eea3b0' },
});

const BG = Object.freeze({
  garden: {
    sky: '#eaf2df', floor: '#e0ebd0', cloud: '#f7f8e8',
    islandEdge: '#c4d5a6', island: '#d4e2b9', grass: '#a9c294',
    petals: '#fff7db', flower: '#ddb989', shadow: '#8da77750',
  },
  lavender: {
    sky: '#eee7f7', floor: '#e2d9ef', cloud: '#faf4fb',
    islandEdge: '#c6b6df', island: '#d6c8e8', grass: '#afa0c9',
    petals: '#fff8e9', flower: '#d5ad89', shadow: '#9781b145',
  },
  beach: { sky: '#d8eff0', floor: '#f0dfb4', island: '#f6e8c8', islandEdge: '#e1cda0', shadow: '#aa9d7550' },
  forest: { sky: '#d5e6d5', floor: '#bdd2af', island: '#d5dfb9', islandEdge: '#a5bf96', shadow: '#67826950' },
  sunset: { sky: '#f8d3ca', floor: '#ceb8cb', island: '#e1cbd2', islandEdge: '#baa3b7', shadow: '#927a9750' },
  snow: { sky: '#e2edf4', floor: '#f4f7f5', island: '#ffffff', islandEdge: '#c6dce3', shadow: '#8ca9ba45' },
  cloud: { sky: '#e2eafa', floor: '#f7eff9', island: '#fff9fb', islandEdge: '#d9cbe9', shadow: '#b0a1c040' },
  cafe: { sky: '#f2e7d3', floor: '#d8b98f', island: '#e8d4ad', islandEdge: '#bb9b76', shadow: '#9a7a5c45' },
  night: {
    sky: '#293849', floor: '#314251', cloud: '#344759',
    islandEdge: '#344e55', island: '#45635f', grass: '#688478',
    petals: '#d9d3ab', flower: '#d3b17a', shadow: '#17293377',
  },
});

function valid(group, value, fallback) {
  return AVATAR_OPTIONS[group].includes(value) ? value : fallback;
}

/** All primitives paint whole logical pixels, including polygon edges. */
function painter(context) {
  const rect = (x, y, width, height, color) => {
    context.fillStyle = color;
    context.fillRect(Math.round(x), Math.round(y), Math.round(width), Math.round(height));
  };
  const ellipse = (cx, cy, rx, ry, color) => {
    context.fillStyle = color;
    for (let y = Math.ceil(cy - ry); y < cy + ry; y += 1) {
      const fraction = (y + 0.5 - cy) / ry;
      const halfWidth = rx * Math.sqrt(Math.max(0, 1 - fraction * fraction));
      const left = Math.ceil(cx - halfWidth - 0.5);
      const right = Math.floor(cx + halfWidth - 0.5);
      if (right >= left) context.fillRect(left, y, right - left + 1, 1);
    }
  };
  const polygon = (points, color) => {
    const low = Math.floor(Math.min(...points.map(point => point[1])));
    const high = Math.ceil(Math.max(...points.map(point => point[1])));
    context.fillStyle = color;
    for (let y = low; y < high; y += 1) {
      const scanY = y + 0.5;
      const intersections = [];
      for (let index = 0; index < points.length; index += 1) {
        const a = points[index];
        const b = points[(index + 1) % points.length];
        if ((a[1] <= scanY && b[1] > scanY) || (b[1] <= scanY && a[1] > scanY)) {
          intersections.push(a[0] + (scanY - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
        }
      }
      intersections.sort((a, b) => a - b);
      for (let index = 0; index + 1 < intersections.length; index += 2) {
        const left = Math.ceil(intersections[index] - 0.5);
        const right = Math.ceil(intersections[index + 1] - 0.5);
        if (right > left) context.fillRect(left, y, right - left, 1);
      }
    }
  };
  const sparkle = (x, y, color, size = 2) => {
    rect(x - size, y, size * 2 + 1, 1, color);
    rect(x, y - size, 1, size * 2 + 1, color);
    if (size > 2) rect(x - 1, y - 1, 3, 3, color);
  };
  const flower = (x, y, petal, center, stem) => {
    if (stem) rect(x, y + 2, 1, 4, stem);
    rect(x - 2, y - 1, 5, 3, petal);
    rect(x - 1, y - 2, 3, 5, petal);
    rect(x, y, 1, 1, center);
  };
  return { rect, ellipse, polygon, sparkle, flower };
}

function drawBackground(p, name) {
  if (name === 'transparent') return;
  const colors = BG[name];
  p.rect(0, 0, 96, 96, colors.sky);
  p.rect(0, 77, 96, 19, colors.floor);
  if (['beach', 'forest', 'sunset', 'snow', 'cloud', 'cafe'].includes(name)) {
    drawScene(p, name, colors);
    return;
  }
  if (name === 'night') {
    p.ellipse(78, 16, 7, 7, '#f2deb1');
    p.ellipse(81, 13, 7, 7, colors.sky);
    p.sparkle(13, 16, '#cbd8c8');
    p.sparkle(82, 41, '#bbced0', 1);
    p.sparkle(19, 42, '#e3d6b8', 1);
    p.rect(67, 6, 1, 1, '#adbfbd');
    p.rect(12, 58, 1, 1, '#adbfbd');
    p.rect(90, 27, 1, 1, '#adbfbd');
  } else {
    p.ellipse(11, 24, 8, 3, colors.cloud);
    p.ellipse(16, 22, 5, 4, colors.cloud);
    p.rect(6, 24, 21, 3, colors.cloud);
    p.ellipse(85, 40, 9, 3, colors.cloud);
    p.ellipse(80, 38, 5, 4, colors.cloud);
    p.rect(73, 40, 20, 3, colors.cloud);
    if (name === 'lavender') {
      p.sparkle(17, 48, '#bca9d2', 1);
      p.sparkle(79, 17, '#bea9d7');
    }
  }
  p.ellipse(48, 84, 36, 9, colors.islandEdge);
  p.ellipse(48, 82, 36, 8, colors.island);
  p.rect(14, 79, 2, 3, colors.grass);
  p.rect(18, 77, 1, 4, colors.grass);
  p.rect(77, 80, 1, 4, colors.grass);
  p.rect(80, 78, 2, 4, colors.grass);
  p.rect(27, 88, 3, 1, colors.grass);
  p.rect(68, 88, 2, 1, colors.grass);
  p.flower(21, 79, colors.petals, colors.flower, colors.grass);
  p.flower(77, 85, colors.petals, colors.flower, colors.grass);
  if (name === 'garden') p.flower(14, 86, '#f4d4d0', '#d3a383', colors.grass);
  if (name === 'lavender') {
    for (const [x, y] of [[12, 69], [18, 75], [79, 68], [84, 78]]) {
      p.rect(x, y + 3, 1, 8, '#8ca581');
      p.rect(x - 1, y, 3, 7, '#aa8dc8');
      p.rect(x, y - 2, 1, 6, '#cfb7e4');
      p.rect(x - 2, y + 9, 2, 1, '#9aae8b');
    }
  }
}

/** Distinct little places, painted with the same integer-pixel primitives. */
function drawScene(p, name, c) {
  if (name === 'beach') {
    p.ellipse(78, 17, 7, 7, '#fff0b1');
    p.rect(0, 48, 96, 26, '#91cbd0');
    p.rect(0, 53, 96, 2, '#bce4df');
    p.rect(1, 61, 23, 2, '#dbf2e8');
    p.rect(74, 58, 21, 2, '#dbf2e8');
    p.rect(0, 70, 96, 8, '#f3e6c3');
    p.rect(2, 70, 23, 2, '#fbf4d8');
    p.rect(70, 72, 26, 2, '#fbf4d8');
    p.polygon([[11, 67], [13, 29], [16, 27], [15, 67]], '#b29a6d');
    p.polygon([[14, 30], [3, 35], [2, 32], [8, 26], [14, 26], [8, 19], [12, 17], [17, 24], [22, 19], [29, 19], [24, 24], [20, 27], [28, 30], [29, 34], [20, 31]], '#88b99d');
    p.rect(13, 39, 3, 1, '#917e60');
    p.rect(12, 50, 3, 1, '#917e60');
    p.ellipse(48, 83, 34, 7, c.island);
    p.polygon([[80, 80], [82, 83], [87, 84], [83, 87], [83, 91], [80, 88], [76, 90], [77, 86], [73, 83], [78, 83]], '#dca995');
    p.rect(79, 84, 2, 2, '#f1c7a9');
    p.ellipse(16, 84, 4, 2, '#fdf5df');
    p.rect(13, 84, 6, 1, '#dbc7a2');
  } else if (name === 'forest') {
    p.rect(7, 0, 6, 78, '#9aab89');
    p.rect(82, 0, 7, 79, '#9aab89');
    p.rect(8, 19, 2, 33, '#b4b89a');
    p.rect(84, 30, 2, 35, '#b4b89a');
    p.ellipse(6, 7, 26, 17, '#a8c5a1');
    p.ellipse(86, 6, 26, 19, '#a6c49e');
    p.ellipse(5, 26, 13, 19, '#b3cda8');
    p.ellipse(95, 30, 15, 18, '#aec9a3');
    p.ellipse(15, 74, 18, 9, '#a5bf97');
    p.ellipse(86, 74, 23, 11, '#a0bc95');
    p.ellipse(48, 84, 36, 8, c.islandEdge);
    p.ellipse(48, 82, 35, 7, c.island);
    for (const [x, y] of [[15, 79], [81, 83]]) {
      p.rect(x - 1, y - 2, 3, 7, '#eee0b9');
      p.ellipse(x, y - 3, 6, 4, '#bb8b79');
      p.rect(x - 5, y - 2, 10, 2, '#d8aa94');
      p.rect(x - 2, y - 5, 2, 1, '#f4dfb5');
      p.rect(x + 2, y - 3, 1, 1, '#f4dfb5');
    }
    p.flower(24, 86, '#f2ebc1', '#c4a35d', '#8da37b');
    p.sparkle(20, 48, '#f6edb9', 1);
    p.sparkle(77, 39, '#f6edb9', 1);
  } else if (name === 'sunset') {
    p.rect(0, 21, 96, 22, '#f5c0b7');
    p.rect(0, 43, 96, 23, '#e8b6be');
    p.ellipse(75, 40, 12, 12, '#ffe0a2');
    p.rect(61, 44, 29, 2, '#f4c0a4');
    p.rect(68, 49, 18, 2, '#f4c0a4');
    p.ellipse(4, 74, 36, 17, '#b5a2bf');
    p.ellipse(99, 76, 35, 20, '#c1a7c2');
    p.ellipse(48, 83, 35, 8, c.islandEdge);
    p.ellipse(48, 81, 35, 7, c.island);
    p.rect(9, 27, 14, 2, '#ffe0d0');
    p.rect(15, 24, 12, 3, '#ffe0d0');
    p.rect(74, 9, 17, 2, '#ffe0d0');
    p.sparkle(16, 14, '#fff0d7', 1);
    p.rect(19, 77, 1, 8, '#a98a9e');
    p.rect(16, 76, 3, 2, '#c2a2ab');
    p.rect(76, 78, 1, 8, '#a98a9e');
    p.rect(77, 80, 4, 1, '#c2a2ab');
  } else if (name === 'snow') {
    for (const [x, y, size] of [[13, 37, 13], [83, 43, 11]]) {
      p.rect(x - 1, y + 17, 3, 18, '#c1b29a');
      p.polygon([[x, y], [x + size - 3, y + 15], [x + 5, y + 15], [x + size, y + 26], [x - size, y + 26], [x - 5, y + 15], [x - size + 3, y + 15]], '#a9c5c5');
      p.polygon([[x, y], [x + 7, y + 11], [x - 7, y + 11]], '#f4f9f5');
      p.polygon([[x, y + 12], [x + 10, y + 21], [x - 10, y + 21]], '#edf5f0');
    }
    for (const [x, y] of [[7, 14], [24, 39], [77, 16], [89, 31], [10, 64], [83, 62]]) p.sparkle(x, y, '#ffffff', 1);
    p.ellipse(48, 84, 37, 9, c.islandEdge);
    p.ellipse(48, 82, 37, 8, c.island);
    p.ellipse(16, 81, 7, 3, '#ffffff');
    p.ellipse(82, 85, 5, 2, '#dbeaf0');
    p.rect(22, 87, 3, 1, '#c5dbe2');
    p.rect(69, 87, 3, 1, '#c5dbe2');
  } else if (name === 'cloud') {
    const bands = ['#ecc3cc', '#f0d5ac', '#deebb4', '#c0dedc', '#d4c8e9'];
    bands.forEach((color, index) => p.ellipse(48, 48, 42 - index * 3, 38 - index * 3, color));
    p.ellipse(48, 48, 27, 23, c.sky);
    p.rect(0, 48, 96, 29, c.sky);
    for (const [x, y, rx] of [[5, 64, 13], [18, 61, 12], [85, 53, 13], [94, 56, 11], [14, 82, 21], [37, 83, 23], [64, 83, 26], [87, 82, 18]]) {
      p.ellipse(x, y + 2, rx, 8, '#d9d6ec');
      p.ellipse(x, y, rx, 8, '#fff8fc');
    }
    p.sparkle(10, 23, '#d8b771');
    p.sparkle(86, 14, '#d8b771', 1);
    p.sparkle(79, 39, '#c2a7d5', 1);
  } else if (name === 'cafe') {
    p.rect(0, 65, 96, 12, '#e2d0b6');
    p.rect(0, 74, 96, 3, '#b59a77');
    for (const y of [84, 92]) p.rect(0, y, 96, 1, '#c7a881');
    for (const x of [13, 41, 69]) p.rect(x, 77, 1, 8, '#c7a881');
    for (const x of [3, 29, 58, 85]) p.rect(x, 85, 1, 7, '#c7a881');
    p.rect(5, 13, 25, 37, '#c9ae87');
    p.rect(7, 15, 21, 32, '#bcd7d3');
    p.rect(8, 16, 19, 14, '#d5e8de');
    p.rect(16, 15, 2, 32, '#fff2d9');
    p.rect(7, 29, 21, 2, '#fff2d9');
    p.rect(3, 48, 29, 3, '#a99576');
    p.rect(76, 21, 14, 17, '#c8aa85');
    p.rect(78, 23, 10, 13, '#fff1d8');
    p.ellipse(83, 30, 3, 3, '#cca387');
    p.rect(82, 26, 2, 2, '#8eaa89');
    p.rect(80, 52, 2, 22, '#8fa27b');
    p.polygon([[80, 60], [72, 57], [70, 50], [78, 52], [82, 58]], '#a7ba8d');
    p.polygon([[82, 62], [91, 56], [92, 49], [86, 50], [81, 57]], '#9aac81');
    p.polygon([[81, 54], [77, 47], [80, 42], [84, 49], [83, 57]], '#b3c099');
    p.polygon([[74, 68], [88, 68], [86, 80], [76, 80]], '#c99b7e');
    p.rect(74, 68, 14, 3, '#dbb291');
    p.ellipse(48, 84, 27, 6, '#c7b9a0');
    p.ellipse(48, 83, 25, 5, '#e6d5b7');
  }
}

function drawWings(p) {
  const outline = '#9b89b7';
  const shade = '#c6b2df';
  const light = '#f0e2f6';
  p.polygon([[31, 66], [24, 62], [18, 53], [18, 48], [22, 48], [29, 52], [36, 61], [35, 73]], outline);
  p.polygon([[30, 66], [24, 60], [20, 52], [20, 50], [25, 52], [33, 61], [33, 70]], light);
  p.polygon([[31, 63], [23, 57], [20, 58], [20, 63], [25, 70], [33, 74], [35, 70]], shade);
  p.polygon([[65, 66], [72, 62], [78, 53], [78, 48], [74, 48], [67, 52], [60, 61], [61, 73]], outline);
  p.polygon([[66, 66], [72, 60], [76, 52], [76, 50], [71, 52], [63, 61], [63, 70]], light);
  p.polygon([[65, 63], [73, 57], [76, 58], [76, 63], [71, 70], [63, 74], [61, 70]], shade);
  p.rect(23, 60, 2, 4, '#e7d9f0');
  p.rect(71, 60, 2, 4, '#e7d9f0');
}

/**
 * Animal silhouettes are designed on a true 48 × 48 sprite grid inside the
 * existing 96 × 96 wardrobe space. Each row is [left, right), in sprite pixels.
 * A one-sprite-pixel outline follows orthogonal neighbors; no smooth curves
 * or filtered downsampling are used for the animals themselves.
 */
function spriteForm(p, top, rows, c) {
  for (let row = 0; row < rows.length; row += 1) {
    const [left, right] = rows[row];
    const above = rows[row - 1];
    const below = rows[row + 1];
    for (let x = left; x < right; x += 1) {
      const edge = x === left || x === right - 1 || !above || !below ||
        x < above[0] || x >= above[1] || x < below[0] || x >= below[1];
      const shade = x >= right - 3 || row >= rows.length - 3;
      p.rect(x * 2, (top + row) * 2, 2, 2, edge ? c.outline : shade ? c.shade : c.cream);
    }
  }
}

function drawEars(p, happy) {
  // The two tips differ slightly, so the bunny has a readable silhouette even
  // when the face is only a few display pixels tall.
  spriteForm(p, 3, [[16,20],[15,21],[15,21],[15,21],[15,21],[15,21],[15,21],[15,21],[16,22],[16,22],[16,22],[17,23],[17,23],[18,23]], COLORS);
  p.rect(34, 12, 4, 16, COLORS.innerEar);
  p.rect(36, 26, 4, 8, COLORS.innerEarShade);
  p.rect(34, 12, 2, 10, '#ffd1da');
  const right = happy
    ? [[29,33],[28,34],[27,34],[27,33],[27,33],[27,33],[26,32],[26,32],[26,32],[26,32],[25,31],[25,31],[25,31],[25,30]]
    : [[29,32],[28,33],[28,34],[28,34],[28,34],[27,33],[27,33],[27,33],[27,33],[26,32],[26,32],[26,32],[25,31],[25,31]];
  spriteForm(p, 2, right, COLORS);
  p.rect(58, 10, 4, 12, COLORS.innerEar);
  p.rect(56, 20, 4, 10, COLORS.innerEar);
  p.rect(54, 28, 4, 6, COLORS.innerEarShade);
  p.rect(58, 12, 2, 8, '#ffd1da');
}

function drawTail(p, species) {
  const c = FUR[species];
  if (species === 'cat') {
    p.polygon([[60,76],[72,76],[72,72],[76,72],[76,60],[78,60],[78,56],[84,56],[84,58],[88,58],[88,70],[86,70],[86,76],[82,76],[82,80],[76,80],[76,84],[60,84]], c.outline);
    p.polygon([[62,78],[74,78],[74,74],[78,74],[78,62],[80,62],[80,58],[84,58],[84,60],[86,60],[86,70],[84,70],[84,74],[80,74],[80,78],[74,78],[74,82],[62,82]], c.cream);
    p.rect(80, 64, 6, 4, c.shade);
    p.rect(76, 74, 6, 4, c.shade);
    p.rect(64, 80, 8, 2, c.highlight);
  } else if (species === 'fox') {
    p.polygon([[16,46],[20,46],[20,54],[22,54],[22,58],[26,58],[26,62],[32,62],[32,66],[38,66],[38,80],[32,80],[32,84],[22,84],[22,82],[16,82],[16,78],[12,78],[12,72],[10,72],[10,58],[12,58],[12,52],[16,52]], c.outline);
    p.polygon([[16,54],[18,54],[18,58],[20,58],[20,62],[24,62],[24,66],[30,66],[30,68],[36,68],[36,78],[30,78],[30,82],[22,82],[22,80],[18,80],[18,76],[14,76],[14,70],[12,70],[12,60],[14,60],[14,56],[16,56]], c.cream);
    p.polygon([[16,52],[18,52],[18,58],[20,58],[20,62],[24,62],[24,66],[20,66],[20,70],[16,70],[16,66],[14,66],[14,60],[16,60]], '#fff1db');
    p.rect(20, 76, 10, 4, c.shade);
    p.rect(18, 72, 4, 2, c.highlight);
  } else if (species === 'puppy') {
    p.polygon([[62,74],[70,74],[70,70],[74,70],[74,62],[78,58],[82,58],[84,62],[84,68],[80,68],[80,74],[76,74],[76,80],[62,82]], c.outline);
    p.polygon([[64,76],[72,76],[72,72],[76,72],[76,64],[78,62],[80,62],[82,64],[82,66],[78,66],[78,72],[74,76],[74,78],[64,80]], c.innerEar);
    p.rect(76, 62, 4, 4, c.cream);
  } else if (species === 'bear') {
    spriteForm(p, 34, [[31,34],[30,35],[30,35],[30,35],[31,34]], c);
  }
}

function drawAnimalEars(p, species, happy) {
  if (species === 'rabbit') return drawEars(p, happy);
  const c = FUR[species];
  if (species === 'cat' || species === 'fox') {
    const top = species === 'fox' ? 5 : 7;
    const rows = species === 'fox'
      ? [[13,15],[13,16],[12,17],[12,18],[12,19],[12,20],[12,21],[12,21],[12,22],[12,22]]
      : [[13,15],[12,16],[12,17],[12,18],[12,19],[12,20],[12,21],[12,21]];
    spriteForm(p, top, rows, c);
    spriteForm(p, top, rows.map(([left,right]) => [48 - right,48 - left]), c);
    const y = top * 2;
    p.polygon([[28,y+6],[30,y+6],[30,y+10],[32,y+10],[32,y+14],[36,y+14],[36,y+18],[28,y+18]], c.innerEar);
    p.polygon([[68,y+6],[66,y+6],[66,y+10],[64,y+10],[64,y+14],[60,y+14],[60,y+18],[68,y+18]], c.innerEar);
    if (species === 'fox') {
      p.rect(26, y+2, 4, 6, c.outline);
      p.rect(66, y+2, 4, 6, c.outline);
      p.rect(28, y+8, 4, 2, c.innerEar);
      p.rect(64, y+8, 4, 2, c.innerEar);
    }
  } else if (species === 'bear') {
    const ear = [[12,17],[11,18],[10,19],[10,19],[10,19],[10,19],[11,18],[12,17]];
    spriteForm(p, 8, ear, c);
    spriteForm(p, 8, ear.map(([left,right]) => [48-right,48-left]), c);
    p.rect(24, 22, 10, 8, c.innerEar);
    p.rect(62, 22, 10, 8, c.innerEar);
    p.rect(26, 22, 6, 2, '#df9b72');
    p.rect(64, 22, 6, 2, '#df9b72');
  } else if (species === 'puppy') {
    const ear = [[12,17],[11,18],[10,18],[9,18],[9,18],[9,18],[9,18],[9,18],[9,18],[9,17],[9,17],[10,17],[10,16],[11,15]];
    const earColors = { ...c, cream: c.innerEar, shade: '#956348' };
    spriteForm(p, 13, ear, earColors);
    spriteForm(p, 13, ear.map(([left,right]) => [48-right,48-left]), earColors);
    p.rect(22, 34, 4, 14, '#d39d77');
    p.rect(70, 34, 4, 14, '#d39d77');
  } else if (species === 'penguin') {
    p.polygon([[40,26],[40,20],[44,20],[44,22],[48,22],[48,16],[52,16],[52,20],[56,20],[56,26]], c.outline);
    p.rect(42, 22, 4, 4, c.highlight);
    p.rect(50, 18, 2, 8, c.cream);
  }
}

function drawAnimalHead(p, species, happy) {
  const c = FUR[species];
  const rows = species === 'fox'
    ? [[17,31],[15,33],[14,34],[13,35],[12,36],[12,36],[12,36],[12,36],[11,37],[11,37],[12,36],[12,36],[13,35],[14,34],[15,33],[16,32],[18,30],[20,28],[21,27],[22,26]]
    : species === 'bear'
      ? [[17,31],[14,34],[13,35],[12,36],[12,36],[11,37],[11,37],[11,37],[11,37],[11,37],[11,37],[11,37],[12,36],[12,36],[13,35],[14,34],[16,32],[18,30],[20,28],[21,27]]
      : species === 'penguin'
        ? [[19,29],[17,31],[15,33],[14,34],[13,35],[13,35],[12,36],[12,36],[12,36],[12,36],[12,36],[12,36],[13,35],[13,35],[14,34],[15,33],[16,32],[18,30],[20,28],[21,27]]
        : [[17,31],[14,34],[13,35],[12,36],[12,36],[11,37],[11,37],[11,37],[11,37],[11,37],[11,37],[11,37],[12,36],[12,36],[13,35],[14,34],[16,32],[18,30],[20,28],[21,27]];
  spriteForm(p, 12, rows, c);
  // Small flat highlights replace the former round gradients.
  p.rect(32, 30, 16, 2, c.highlight);
  p.rect(28, 32, 8, 2, c.highlight);
  p.rect(26, 36, 2, 8, c.highlight);
  if (species === 'cat') {
    p.rect(40, 28, 4, 8, c.shade);
    p.rect(46, 26, 4, 10, c.shade);
    p.rect(54, 28, 4, 8, c.shade);
    p.rect(26, 42, 6, 4, c.shade);
    p.rect(64, 42, 6, 4, c.shade);
    p.rect(40, 48, 16, 10, '#fff0e3');
    p.rect(44, 46, 8, 14, '#fff0e3');
    p.rect(20, 48, 8, 2, c.outline);
    p.rect(22, 54, 6, 2, c.outline);
    p.rect(68, 48, 8, 2, c.outline);
    p.rect(68, 54, 6, 2, c.outline);
  } else if (species === 'bear') {
    p.rect(40, 44, 16, 16, '#ffdfaa');
    p.rect(36, 48, 24, 8, '#ffdfaa');
    p.rect(40, 46, 10, 2, '#fff0c4');
    p.rect(28, 38, 4, 6, '#ffcf8d');
  } else if (species === 'fox') {
    p.polygon([[26,44],[30,44],[30,48],[34,48],[34,50],[40,50],[40,52],[44,52],[44,54],[52,54],[52,52],[56,52],[56,50],[62,50],[62,48],[66,48],[66,44],[70,44],[70,48],[68,48],[68,52],[66,52],[66,54],[62,54],[62,56],[60,56],[60,58],[56,58],[56,60],[52,60],[52,62],[44,62],[44,60],[40,60],[40,58],[36,58],[36,56],[32,56],[32,54],[30,54],[30,52],[28,52],[28,48],[26,48]], '#fff1db');
    p.rect(44, 46, 8, 10, '#fff1db');
    p.rect(46, 42, 4, 6, c.highlight);
    p.rect(34, 36, 6, 2, c.shade);
    p.rect(56, 36, 6, 2, c.shade);
  } else if (species === 'puppy') {
    p.polygon([[54,28],[62,28],[62,30],[66,30],[66,34],[68,34],[68,42],[66,42],[66,46],[62,46],[62,48],[54,48],[54,46],[50,46],[50,32],[54,32]], '#cf9a73');
    p.rect(54, 30, 8, 4, '#e6b58b');
    p.rect(38, 48, 20, 10, '#fff9e7');
    p.rect(42, 46, 12, 14, '#fff9e7');
  } else if (species === 'penguin') {
    p.polygon([[34,32],[40,32],[40,34],[44,34],[44,38],[52,38],[52,34],[56,34],[56,32],[62,32],[62,36],[66,36],[66,42],[68,42],[68,50],[66,50],[66,54],[62,54],[62,58],[56,58],[56,60],[40,60],[40,58],[34,58],[34,54],[30,54],[30,50],[28,50],[28,42],[30,42],[30,36],[34,36]], '#fff3dd');
    p.rect(34, 34, 4, 2, '#fffbed');
    p.rect(56, 34, 4, 2, '#fffbed');
  }
  p.rect(28, 48, 8, 4, c.blush);
  p.rect(60, 48, 8, 4, c.blush);
  p.rect(28, 48, 2, 2, '#ffc9cc');
  p.rect(60, 48, 2, 2, '#ffc9cc');
  if (happy) {
    for (const x of [36,54]) {
      p.rect(x, 42, 2, 4, c.ink);
      p.rect(x + 2, 40, 4, 2, c.ink);
      p.rect(x + 6, 42, 2, 4, c.ink);
    }
  } else {
    p.rect(38, 40, 4, 8, c.ink);
    p.rect(56, 40, 4, 8, c.ink);
    p.rect(38, 40, 2, 2, '#fff9ed');
    p.rect(56, 40, 2, 2, '#fff9ed');
  }
  if (species === 'penguin') {
    p.rect(44, 48, 8, 2, '#b27849');
    p.rect(42, 50, 12, 4, '#b27849');
    p.rect(46, 54, 4, 2, '#b27849');
    p.rect(44, 50, 8, 2, c.nose);
    p.rect(46, 52, 4, 2, '#efb35d');
    if (happy) p.rect(46, 52, 4, 2, '#966044');
  } else {
    const broad = species === 'bear' || species === 'puppy';
    p.rect(broad ? 44 : 46, 48, broad ? 8 : 4, 4, c.nose);
    p.rect(46, 48, 2, 2, broad ? '#b98571' : '#f8b6c0');
    p.rect(46, 52, 4, 2, c.ink);
    if (happy || species === 'puppy') {
      p.rect(44, 52, 8, 4, c.ink);
      p.rect(46, 54, 4, 4, '#e69aa8');
    } else {
      p.rect(42, 54, 4, 2, c.ink);
      p.rect(50, 54, 4, 2, c.ink);
    }
  }
}

function drawFeetAndBody(p, species) {
  const c = FUR[species];
  const foot = species === 'penguin' ? { ...c, outline: '#936044', cream: '#f6ca72', shade: '#dda14f' } : c;
  const left = [[17,23],[16,24],[15,24],[15,24],[16,23]];
  spriteForm(p, 38, left, foot);
  spriteForm(p, 38, left.map(([l,r]) => [48-r,48-l]), foot);
  p.rect(34, 80, 8, 2, species === 'penguin' ? '#ffe5a2' : c.highlight);
  p.rect(54, 80, 8, 2, species === 'penguin' ? '#ffe5a2' : c.highlight);
  spriteForm(p, 28, [[19,29],[18,30],[17,31],[16,32],[16,32],[16,32],[16,32],[16,32],[16,32],[17,31],[18,30],[19,29]], c);
}

function drawArms(p, outfit, happy, species) {
  const c = FUR[species];
  if (happy) {
    p.polygon([[18,44],[24,44],[24,48],[26,48],[26,52],[30,52],[30,56],[34,56],[34,60],[38,60],[38,66],[32,66],[32,62],[28,62],[28,58],[24,58],[24,54],[20,54],[20,50],[18,50]], c.outline);
    p.polygon([[78,44],[72,44],[72,48],[70,48],[70,52],[66,52],[66,56],[62,56],[62,60],[58,60],[58,66],[64,66],[64,62],[68,62],[68,58],[72,58],[72,54],[76,54],[76,50],[78,50]], c.outline);
    p.rect(20, 46, 4, 4, c.cream);
    p.rect(72, 46, 4, 4, c.cream);
    p.rect(22, 50, 4, 4, outfit.main);
    p.rect(70, 50, 4, 4, outfit.light);
    p.rect(26, 54, 6, 4, outfit.main);
    p.rect(30, 58, 8, 4, outfit.main);
    p.rect(64, 54, 6, 4, outfit.light);
    p.rect(58, 58, 8, 4, outfit.light);
    // Raised paws remain outside the broad cheeks at every species' head width.
    spriteForm(p, 19, [[8,11],[7,12],[7,12],[7,12],[8,11]], c);
    spriteForm(p, 19, [[37,40],[36,41],[36,41],[36,41],[37,40]], c);
    p.rect(16, 40, 4, 2, c.highlight);
    p.rect(76, 40, 4, 2, c.highlight);
  } else {
    spriteForm(p, 30, [[16,19],[15,19],[14,19],[13,18],[13,18],[13,18],[14,18],[15,17]], c);
    spriteForm(p, 30, [[29,32],[29,33],[29,34],[30,35],[30,35],[30,35],[30,34],[31,33]], c);
    p.rect(30, 64, 6, 4, outfit.main);
    p.rect(60, 64, 6, 4, outfit.shade);
    p.rect(28, 70, 6, 4, c.cream);
    p.rect(62, 70, 6, 4, c.cream);
  }
}

function drawOutfit(p, name) {
  const c = OUTFITS[name];
  // A stepped two-pixel hem ties the existing wardrobe to the new sprites.
  p.polygon([[38,58],[58,58],[58,60],[62,60],[62,64],[64,64],[64,76],[62,76],[62,80],[34,80],[34,76],[32,76],[32,64],[34,64],[34,60],[38,60]], c.edge);
  p.polygon([[38,60],[58,60],[58,62],[60,62],[60,66],[62,66],[62,74],[60,74],[60,78],[36,78],[36,74],[34,74],[34,66],[36,66],[36,62],[38,62]], c.main);
  p.rect(58, 66, 4, 8, c.shade);
  p.rect(38, 76, 20, 2, c.shade);
  p.rect(36, 64, 2, 10, c.light);
  p.polygon([[42, 59], [48, 61], [55, 59], [53, 65], [49, 66], [44, 64]], COLORS.highlight);
  p.rect(46, 64, 5, 2, COLORS.shade);
  p.rect(47, 65, 3, 2, COLORS.highlight);
  if (name === 'navy') {
    p.rect(38, 68, 20, 2, c.light);
    p.rect(38, 73, 20, 2, c.light);
    p.rect(47, 66, 3, 10, c.main);
  } else {
    p.rect(43, 69, 10, 6, c.shade);
    p.rect(44, 69, 8, 4, c.main);
    p.rect(44, 69, 8, 1, c.light);
  }
  p.rect(48, 68, 2, 2, COLORS.goldLight);
  p.rect(48, 72, 2, 2, COLORS.goldLight);
  if (name === 'lilac') {
    p.rect(41, 65, 15, 10, c.main);
    p.rect(47, 63, 2, 14, c.light);
    for (const y of [66, 70, 74]) p.rect(48, y, 2, 1, '#fff2ce');
    p.rect(39, 70, 5, 4, c.shade);
    p.rect(52, 70, 5, 4, c.shade);
    p.rect(39, 70, 5, 1, c.light);
    p.rect(52, 70, 5, 1, c.light);
  } else if (name === 'peach') {
    p.rect(40, 63, 3, 13, '#fff2d6');
    p.rect(54, 63, 3, 13, '#fff2d6');
    p.polygon([[42, 67], [54, 67], [57, 77], [39, 77]], '#fff1d8');
    p.rect(43, 70, 10, 5, '#e7c5a8');
    p.rect(44, 70, 8, 3, '#fff9e5');
    p.flower(48, 72, '#efb4a4', '#c99876');
  } else if (name === 'sky') {
    p.rect(39, 64, 20, 12, c.main);
    for (const y of [65, 70, 75]) p.rect(38, y, 22, 2, '#e8f0e3');
    p.rect(44, 62, 10, 2, c.light);
    p.rect(38, 75, 22, 2, c.shade);
    p.rect(54, 66, 3, 3, '#e7bd71');
  } else if (name === 'lemon') {
    p.polygon([[37, 62], [42, 60], [54, 60], [60, 62], [56, 66], [41, 66]], '#fff1aa');
    p.rect(40, 66, 17, 9, c.main);
    p.rect(43, 64, 1, 5, '#fbf2d1');
    p.rect(53, 64, 1, 5, '#fbf2d1');
    p.rect(43, 71, 11, 5, c.shade);
    p.rect(44, 71, 9, 3, c.light);
    p.ellipse(48, 69, 3, 2, '#fff4c9');
    p.rect(49, 66, 3, 4, '#fff4c9');
    p.rect(52, 67, 2, 1, '#d29e55');
    p.rect(50, 67, 1, 1, '#9e8452');
  } else if (name === 'rose') {
    p.polygon([[38, 65], [59, 65], [64, 77], [62, 81], [35, 81], [33, 77]], c.edge);
    p.polygon([[39, 65], [57, 65], [62, 77], [60, 79], [36, 79], [35, 77]], c.main);
    p.rect(39, 65, 18, 2, '#fbe3e1');
    p.rect(40, 67, 16, 2, c.shade);
    p.polygon([[44, 66], [41, 64], [41, 69], [47, 68], [53, 69], [53, 64], [49, 66]], '#fff0db');
    p.rect(46, 66, 3, 3, '#dfbaa7');
    for (const x of [37, 42, 47, 52, 57]) p.rect(x, 77, 3, 3, '#f6d9dd');
    p.rect(39, 71, 2, 4, c.light);
    p.rect(55, 72, 2, 3, c.shade);
  } else if (name === 'cocoa') {
    p.rect(38, 64, 21, 12, c.main);
    for (const x of [39, 44, 49, 54]) p.rect(x, 65, 2, 11, '#d8ba94');
    for (const y of [66, 71]) p.rect(38, y, 21, 2, '#dfc7a4');
    p.polygon([[41, 62], [48, 66], [54, 62], [51, 69], [46, 71]], '#735f50');
    p.polygon([[43, 62], [48, 66], [53, 62], [49, 69]], '#fff1d8');
    p.rect(48, 69, 2, 8, '#9b7d61');
    p.rect(48, 70, 1, 1, '#f4ddad');
    p.rect(48, 74, 1, 1, '#f4ddad');
    p.rect(40, 73, 5, 1, '#8e7159');
    p.rect(53, 73, 5, 1, '#8e7159');
  } else if (name === 'sailor') {
    p.rect(39, 64, 19, 12, c.main);
    p.polygon([[36, 60], [43, 63], [48, 65], [54, 63], [61, 60], [59, 68], [50, 71], [46, 71], [37, 68]], '#597c97');
    p.polygon([[38, 62], [43, 65], [48, 67], [54, 65], [59, 62], [58, 66], [49, 69], [46, 68], [39, 66]], '#e8ecdf');
    p.polygon([[44, 67], [48, 69], [52, 67], [51, 73], [48, 71], [45, 73]], '#d49a9c');
    p.rect(38, 75, 22, 2, '#597c97');
    p.rect(39, 73, 20, 1, '#a8c2ce');
  } else if (name === 'raincoat') {
    p.polygon([[38, 62], [44, 63], [48, 66], [53, 63], [59, 61], [63, 78], [35, 78]], c.main);
    p.polygon([[39, 61], [45, 63], [47, 68], [40, 65]], '#fff0a5');
    p.polygon([[57, 61], [51, 63], [49, 68], [56, 65]], '#fff0a5');
    p.rect(48, 65, 1, 13, '#be913e');
    for (const y of [69, 74]) {
      p.rect(46, y, 5, 1, '#ab8343');
      p.rect(47, y, 3, 1, '#fff1b5');
    }
    p.rect(38, 71, 6, 4, '#dcaf4c');
    p.rect(53, 71, 6, 4, '#dcaf4c');
    p.rect(38, 71, 6, 1, '#ffeba3');
    p.rect(53, 71, 6, 1, '#ffeba3');
  } else if (name === 'overalls') {
    p.rect(37, 61, 23, 6, '#eee5d1');
    p.rect(40, 60, 3, 12, '#6c93ad');
    p.rect(54, 60, 3, 12, '#6c93ad');
    p.rect(40, 66, 17, 11, c.main);
    p.rect(40, 66, 17, 1, c.light);
    p.rect(41, 66, 2, 2, '#f0cf7f');
    p.rect(54, 66, 2, 2, '#f0cf7f');
    p.rect(44, 69, 10, 6, c.shade);
    p.rect(45, 69, 8, 4, c.main);
    p.rect(45, 69, 8, 1, c.light);
    p.rect(47, 76, 2, 3, c.edge);
    p.rect(36, 76, 9, 1, c.light);
    p.rect(51, 76, 9, 1, c.light);
  } else if (name === 'wizard') {
    p.polygon([[35, 61], [41, 62], [48, 66], [57, 62], [62, 60], [68, 78], [61, 82], [49, 80], [36, 82], [28, 78]], c.edge);
    p.polygon([[36, 63], [41, 64], [48, 68], [57, 64], [60, 63], [65, 77], [60, 80], [48, 78], [36, 80], [31, 77]], c.main);
    p.polygon([[48, 67], [55, 77], [42, 77]], '#655a88');
    p.rect(46, 64, 4, 3, '#efcf83');
    p.rect(47, 64, 2, 2, '#fff1b7');
    p.sparkle(37, 73, '#ebd498', 1);
    p.sparkle(59, 72, '#ebd498', 1);
    p.ellipse(48, 73, 3, 3, '#f0d69a');
    p.ellipse(49, 72, 3, 3, '#655a88');
    p.rect(33, 77, 4, 1, c.light);
    p.rect(60, 77, 3, 1, c.light);
  } else if (name === 'strawberry') {
    p.polygon([[37, 64], [59, 64], [64, 77], [59, 80], [37, 80], [33, 76]], c.edge);
    p.polygon([[38, 64], [58, 64], [62, 76], [58, 78], [38, 78], [35, 75]], c.main);
    p.polygon([[37, 62], [43, 63], [48, 61], [53, 63], [59, 62], [56, 67], [52, 65], [48, 69], [44, 65], [40, 67]], '#83a880');
    p.rect(46, 63, 4, 2, '#bdd59b');
    for (const [x, y] of [[39, 69], [47, 71], [55, 69], [42, 75], [55, 75]]) p.rect(x, y, 1, 2, '#fff1ba');
    p.rect(36, 75, 2, 1, c.light);
  }
}

function drawHat(p, name) {
  if (['straw', 'beanie', 'sprout', 'mushroom', 'ribbon', 'headphones'].includes(name)) return drawExtraHat(p, name);
  if (name === 'beret') {
    p.polygon([[28, 27], [31, 22], [39, 19], [51, 18], [59, 20], [63, 24], [63, 29], [57, 32], [34, 33], [28, 30]], '#836c95');
    p.polygon([[30, 27], [34, 23], [41, 21], [51, 20], [58, 22], [61, 25], [59, 28], [35, 31], [30, 29]], '#b69ccc');
    p.rect(40, 22, 11, 2, '#d8c4e4');
    p.rect(34, 30, 25, 3, '#9d83b5');
    p.rect(48, 15, 3, 5, '#836c95');
    p.rect(49, 15, 3, 2, '#b69ccc');
  } else if (name === 'star') {
    p.polygon([[28, 29], [32, 26], [40, 24], [56, 24], [65, 28], [68, 32], [64, 34], [59, 30], [38, 28], [29, 33]], '#8a87b1');
    p.polygon([[30, 29], [39, 26], [57, 26], [65, 30], [64, 32], [57, 28], [39, 28], [30, 31]], '#b7afd6');
    p.polygon([[62, 17], [65, 23], [72, 24], [67, 29], [68, 36], [62, 32], [56, 36], [57, 29], [52, 24], [59, 23]], COLORS.goldShade);
    p.polygon([[62, 20], [64, 25], [69, 25], [65, 29], [66, 33], [62, 30], [58, 33], [59, 28], [55, 25], [60, 25]], COLORS.gold);
    p.rect(61, 23, 2, 5, COLORS.goldLight);
    p.rect(59, 26, 5, 1, COLORS.goldLight);
  } else if (name === 'flower') {
    p.polygon([[28, 32], [30, 28], [38, 25], [49, 24], [60, 26], [66, 30], [66, 34], [60, 30], [48, 28], [37, 29]], '#7da181');
    p.polygon([[30, 27], [25, 24], [27, 31], [32, 33]], '#9fbb8f');
    p.polygon([[64, 28], [70, 24], [69, 31], [65, 34]], '#9fbb8f');
    p.ellipse(35, 27, 6, 5, '#d59cbd');
    p.rect(31, 21, 7, 12, '#f1c5da');
    p.rect(29, 24, 12, 6, '#f1c5da');
    p.rect(33, 25, 4, 4, COLORS.gold);
    p.flower(47, 25, '#fff3d9', COLORS.goldShade);
    p.ellipse(59, 28, 6, 5, '#b599cf');
    p.rect(56, 23, 6, 11, '#d8c5ec');
    p.rect(53, 26, 12, 5, '#d8c5ec');
    p.rect(57, 27, 4, 3, COLORS.goldLight);
  } else if (name === 'crown') {
    p.polygon([[33, 32], [30, 17], [40, 23], [47, 13], [55, 23], [65, 17], [62, 33]], COLORS.goldShade);
    p.polygon([[35, 29], [33, 21], [41, 26], [47, 17], [54, 26], [62, 21], [60, 30]], COLORS.gold);
    p.rect(35, 29, 25, 5, COLORS.goldShade);
    p.rect(35, 29, 25, 2, COLORS.goldLight);
    p.rect(37, 31, 21, 2, COLORS.gold);
    p.polygon([[48, 23], [51, 26], [48, 30], [45, 26]], '#bb6c87');
    p.rect(47, 24, 2, 2, '#efb0bd');
    p.rect(36, 25, 2, 2, '#82b9a0');
    p.rect(57, 25, 2, 2, '#a598cc');
    p.rect(46, 14, 2, 2, COLORS.goldLight);
  }
}

function drawExtraHat(p, name) {
  if (name === 'straw') {
    p.ellipse(48, 30, 30, 6, '#b9975b');
    p.ellipse(48, 29, 28, 5, '#e8ce8e');
    p.polygon([[31, 29], [33, 20], [39, 15], [56, 15], [62, 20], [64, 29]], '#b9975b');
    p.polygon([[33, 27], [35, 21], [40, 17], [55, 17], [60, 21], [62, 27]], '#e8ce8e');
    p.rect(39, 19, 17, 2, '#f5e3ac');
    p.rect(34, 25, 29, 4, '#c68f94');
    p.rect(35, 25, 27, 1, '#e4b2ad');
    p.rect(22, 30, 52, 1, '#f4dfa7');
    p.polygon([[57, 26], [65, 24], [66, 30], [60, 29], [66, 36], [61, 37]], '#bc828d');
    p.rect(59, 27, 2, 3, '#e3b2af');
  } else if (name === 'beanie') {
    p.ellipse(48, 25, 21, 13, '#b9828e');
    p.ellipse(47, 24, 19, 11, '#dfabb6');
    p.rect(29, 27, 38, 8, '#bd8d9a');
    p.rect(30, 28, 36, 5, '#e6b9c3');
    p.rect(32, 28, 32, 1, '#f6d7d6');
    for (const x of [33, 38, 43, 48, 53, 58, 63]) p.rect(x, 30, 1, 3, '#cf9aa8');
    for (const x of [38, 43, 48, 53, 58]) p.rect(x, 19, 1, 7, '#eac2c8');
    p.ellipse(48, 11, 6, 5, '#ddd0b9');
    p.ellipse(47, 10, 5, 4, '#fff3da');
    p.rect(44, 8, 3, 2, '#fffcef');
    p.rect(56, 29, 6, 4, '#f8e9d2');
    p.rect(58, 30, 2, 1, '#b08c78');
  } else if (name === 'sprout') {
    p.polygon([[28, 31], [32, 26], [44, 23], [57, 24], [66, 29], [67, 32], [59, 28], [44, 27], [33, 29]], '#95b38c');
    p.rect(47, 14, 2, 12, '#799870');
    p.polygon([[47, 19], [40, 18], [35, 12], [36, 9], [41, 10], [47, 15]], '#87b38b');
    p.polygon([[49, 17], [51, 9], [59, 6], [63, 8], [60, 14], [55, 17]], '#8eba91');
    p.polygon([[38, 12], [43, 14], [46, 17], [41, 15]], '#bed39d');
    p.polygon([[51, 15], [56, 10], [60, 9], [57, 12]], '#c4d9a4');
    p.ellipse(49, 25, 5, 3, '#d8be91');
    p.rect(46, 24, 5, 1, '#f0d8a4');
  } else if (name === 'mushroom') {
    p.ellipse(48, 29, 27, 7, '#9c7567');
    p.ellipse(48, 29, 25, 5, '#f1d3b2');
    p.polygon([[21, 28], [24, 20], [34, 13], [43, 10], [54, 10], [65, 15], [72, 22], [75, 28], [70, 31], [26, 31]], '#ad7778');
    p.polygon([[24, 27], [27, 21], [35, 15], [44, 12], [53, 12], [63, 16], [70, 23], [72, 28], [68, 29], [28, 29]], '#d99b9c');
    p.ellipse(39, 18, 5, 3, '#fff0d6');
    p.ellipse(60, 22, 4, 4, '#fff0d6');
    p.ellipse(28, 26, 3, 2, '#f1d9bb');
    p.ellipse(48, 27, 3, 2, '#fff0d6');
    p.rect(45, 13, 8, 1, '#edb8b1');
    p.rect(36, 32, 24, 2, '#dfb994');
  } else if (name === 'ribbon') {
    p.polygon([[30, 32], [34, 27], [43, 24], [58, 25], [65, 29], [65, 32], [56, 28], [43, 27], [34, 30]], '#c393a3');
    p.polygon([[59, 23], [49, 14], [45, 16], [45, 25], [50, 29], [59, 27]], '#b17d96');
    p.polygon([[61, 23], [72, 16], [76, 19], [75, 29], [70, 32], [60, 27]], '#b17d96');
    p.polygon([[57, 24], [49, 18], [48, 19], [48, 25], [51, 27], [58, 26]], '#e9b3c6');
    p.polygon([[63, 24], [71, 20], [73, 21], [72, 28], [69, 29], [63, 26]], '#dda0bb');
    p.polygon([[56, 27], [59, 27], [58, 37], [54, 34], [52, 35]], '#ce92ad');
    p.polygon([[61, 27], [64, 27], [69, 35], [65, 34], [63, 37]], '#ce92ad');
    p.rect(57, 22, 7, 7, '#b58098');
    p.rect(58, 23, 5, 5, '#f0bdcd');
    p.rect(59, 23, 2, 2, '#ffdde0');
  } else if (name === 'headphones') {
    p.polygon([[23, 39], [23, 29], [30, 22], [40, 19], [56, 19], [66, 22], [73, 29], [73, 40], [68, 40], [68, 31], [62, 26], [54, 24], [42, 24], [34, 26], [28, 31], [28, 39]], '#6e8c8f');
    p.polygon([[25, 38], [25, 30], [32, 24], [41, 21], [55, 21], [65, 24], [71, 30], [71, 38], [69, 38], [69, 31], [63, 25], [54, 23], [42, 23], [33, 26], [27, 31], [27, 38]], '#bad1c6');
    p.rect(21, 36, 9, 15, '#648185');
    p.rect(22, 36, 6, 13, '#a8c9c1');
    p.rect(22, 38, 2, 8, '#d3e3d3');
    p.rect(67, 36, 9, 15, '#648185');
    p.rect(69, 36, 6, 13, '#a8c9c1');
    p.rect(70, 38, 2, 8, '#d3e3d3');
    p.rect(72, 51, 2, 7, '#648185');
    p.rect(66, 56, 7, 2, '#648185');
    p.rect(63, 55, 5, 4, '#8ea5a1');
  }
}

function drawBackAccessory(p, name) {
  if (name === 'balloon') {
    p.polygon([[78, 34], [79, 46], [72, 57], [68, 72], [67, 72], [71, 56], [78, 46], [77, 34]], '#c5a79f');
    p.ellipse(78, 23, 10, 13, '#b788a8');
    p.ellipse(77, 22, 9, 11, '#e3b2cc');
    p.ellipse(74, 19, 3, 5, '#f8d5df');
    p.polygon([[77, 34], [75, 38], [80, 38]], '#d39ebc');
    p.rect(77, 35, 2, 1, '#a78798');
  } else if (name === 'lantern') {
    p.ellipse(74, 69, 15, 18, '#f2d99730');
    p.ellipse(74, 69, 11, 13, '#f3dfa62b');
  }
}

function drawFrontAccessory(p, name) {
  if (['bell', 'glasses', 'book', 'balloon', 'wand', 'camera', 'flowerbasket', 'lantern'].includes(name)) return drawExtraAccessory(p, name);
  if (name === 'scarf') {
    p.polygon([[32, 59], [40, 62], [57, 62], [64, 58], [65, 64], [59, 68], [39, 68], [31, 65]], '#af788a');
    p.polygon([[33, 60], [41, 63], [57, 63], [63, 60], [63, 63], [57, 66], [40, 66], [33, 64]], '#e2a8b5');
    p.rect(38, 63, 20, 1, '#f5cbd0');
    p.polygon([[56, 65], [63, 64], [65, 77], [58, 79], [56, 76]], '#af788a');
    p.polygon([[57, 66], [62, 66], [63, 76], [59, 77]], '#d996a9');
    p.rect(59, 69, 3, 2, '#f1bfc8');
    p.rect(58, 78, 2, 2, '#af788a');
    p.rect(62, 77, 2, 2, '#af788a');
  } else if (name === 'bag') {
    p.polygon([[36, 62], [39, 61], [62, 73], [60, 77]], '#967454');
    p.polygon([[38, 62], [40, 63], [61, 74], [60, 75]], '#d8bb83');
    p.polygon([[56, 68], [67, 68], [70, 72], [70, 81], [67, 84], [56, 84], [53, 81], [53, 72]], '#967454');
    p.rect(55, 72, 13, 9, '#d7b67f');
    p.rect(57, 81, 10, 1, '#b29469');
    p.polygon([[56, 69], [66, 69], [68, 72], [66, 77], [57, 77], [55, 74]], '#edce95');
    p.rect(60, 74, 3, 4, '#967454');
    p.rect(61, 74, 1, 2, COLORS.goldLight);
  }
}

function drawExtraAccessory(p, name) {
  if (name === 'bell') {
    p.polygon([[33, 60], [41, 63], [56, 63], [64, 60], [63, 65], [56, 67], [40, 67], [33, 64]], '#b47f90');
    p.rect(39, 63, 18, 2, '#dfacb5');
    p.rect(46, 64, 5, 4, '#ac874e');
    p.rect(47, 65, 3, 2, '#f0d99a');
    p.ellipse(48, 71, 6, 6, '#ae8951');
    p.ellipse(48, 70, 5, 5, '#efce7c');
    p.ellipse(46, 68, 2, 2, '#fff0b1');
    p.rect(44, 72, 8, 1, '#b78c4d');
    p.rect(47, 71, 2, 4, '#9b7d48');
  } else if (name === 'glasses') {
    for (const x of [31, 52]) {
      p.rect(x + 3, 38, 9, 1, '#88776c');
      p.rect(x + 1, 39, 2, 2, '#88776c');
      p.rect(x, 41, 1, 6, '#88776c');
      p.rect(x + 1, 47, 2, 2, '#88776c');
      p.rect(x + 3, 49, 9, 1, '#88776c');
      p.rect(x + 12, 47, 2, 2, '#88776c');
      p.rect(x + 14, 41, 1, 6, '#88776c');
      p.rect(x + 12, 39, 2, 2, '#88776c');
      p.rect(x + 3, 39, 2, 1, '#efdfc1');
    }
    p.rect(45, 42, 7, 1, '#88776c');
    p.rect(26, 41, 5, 1, '#88776c');
    p.rect(67, 41, 4, 1, '#88776c');
  } else if (name === 'book') {
    p.polygon([[42, 68], [53, 67], [58, 70], [65, 67], [76, 68], [76, 81], [65, 80], [59, 83], [53, 80], [42, 82]], '#668e83');
    p.polygon([[44, 69], [53, 68], [58, 71], [58, 80], [52, 78], [44, 80]], '#fff1d6');
    p.polygon([[60, 71], [66, 68], [74, 69], [74, 79], [66, 78], [60, 81]], '#ebddbd');
    p.rect(58, 71, 2, 11, '#baa988');
    p.rect(46, 72, 8, 1, '#c6bba0');
    p.rect(46, 75, 7, 1, '#c6bba0');
    p.rect(64, 72, 7, 1, '#b5ac94');
    p.rect(64, 75, 7, 1, '#b5ac94');
    p.rect(68, 69, 2, 6, '#cc99a6');
    p.rect(44, 81, 11, 1, '#96b4a2');
  } else if (name === 'balloon') {
    p.rect(66, 68, 2, 6, '#c5a79f');
    p.rect(65, 73, 2, 6, '#c5a79f');
    p.polygon([[65, 72], [70, 74], [70, 78], [66, 76], [62, 78], [62, 74]], '#dfaabd');
    p.rect(65, 73, 2, 3, '#f4cad3');
  } else if (name === 'wand') {
    p.polygon([[65, 78], [63, 77], [73, 55], [76, 56]], '#877294');
    p.polygon([[65, 76], [65, 74], [73, 56], [74, 56]], '#c5acd7');
    p.polygon([[75, 43], [78, 50], [86, 51], [80, 56], [81, 64], [75, 60], [68, 64], [70, 56], [64, 51], [72, 50]], '#c29b57');
    p.polygon([[75, 47], [77, 52], [82, 52], [78, 56], [79, 60], [75, 58], [71, 60], [72, 55], [68, 52], [73, 52]], '#efd180');
    p.rect(74, 50, 2, 6, '#fff0b2');
    p.rect(72, 53, 5, 1, '#fff0b2');
    p.sparkle(87, 42, '#d5b373', 1);
    p.sparkle(84, 67, '#b69dc8', 1);
    p.polygon([[69, 64], [76, 65], [75, 69], [71, 67], [73, 74], [70, 75]], '#dba3ba');
  } else if (name === 'camera') {
    p.polygon([[38, 61], [41, 61], [47, 71], [45, 73]], '#937f6d');
    p.polygon([[57, 61], [60, 61], [58, 73], [55, 72]], '#937f6d');
    p.rect(48, 65, 8, 3, '#617d80');
    p.rect(43, 67, 23, 14, '#5c777a');
    p.rect(44, 68, 21, 11, '#9cb9b3');
    p.rect(44, 72, 21, 6, '#86a5a2');
    p.ellipse(55, 74, 6, 6, '#536c72');
    p.ellipse(55, 74, 4, 4, '#c9d9cc');
    p.ellipse(55, 74, 3, 3, '#6a919d');
    p.rect(54, 72, 2, 2, '#d2e6da');
    p.rect(45, 69, 4, 3, '#fff0bc');
    p.rect(61, 69, 2, 1, '#dbe1ca');
    p.rect(60, 65, 3, 2, '#b19277');
  } else if (name === 'flowerbasket') {
    p.ellipse(68, 72, 10, 9, '#ae8b63');
    p.ellipse(68, 73, 8, 8, '#dfc798');
    p.rect(61, 68, 14, 6, '#c5ae7c');
    p.rect(60, 73, 17, 9, '#ac8559');
    p.polygon([[59, 73], [78, 73], [75, 84], [62, 84]], '#c6a16a');
    p.rect(60, 74, 17, 2, '#efd29b');
    p.rect(62, 79, 14, 1, '#ebca8f');
    p.rect(63, 82, 11, 1, '#b38c5d');
    for (const x of [64, 68, 72]) p.rect(x, 76, 1, 6, '#a8865d');
    p.rect(64, 66, 1, 7, '#8aa076');
    p.rect(70, 64, 1, 9, '#8aa076');
    p.polygon([[69, 68], [73, 65], [75, 65], [73, 69]], '#a7ba85');
    p.flower(62, 67, '#f4c6d1', '#d1a66d');
    p.flower(69, 64, '#fff0c2', '#d0aa70');
    p.flower(75, 69, '#c6b3e0', '#fff0bb');
    p.rect(62, 74, 13, 1, '#f1d49d');
  } else if (name === 'lantern') {
    p.rect(69, 55, 9, 2, '#8c7c61');
    p.rect(67, 57, 2, 7, '#8c7c61');
    p.rect(77, 57, 2, 7, '#8c7c61');
    p.polygon([[66, 65], [69, 61], [77, 61], [80, 65]], '#8c7c61');
    p.rect(66, 65, 14, 16, '#8c7c61');
    p.rect(68, 67, 10, 11, '#ffe5a0');
    p.rect(69, 68, 8, 9, '#fff1be');
    p.rect(72, 72, 3, 6, '#e7c681');
    p.polygon([[73, 67], [71, 71], [72, 74], [75, 72]], '#efb764');
    p.rect(72, 70, 2, 3, '#fff7d7');
    p.rect(72, 65, 1, 15, '#bca26e');
    p.rect(66, 80, 14, 3, '#a88b5b');
    p.rect(66, 80, 14, 1, '#d7ba79');
    p.rect(68, 63, 10, 1, '#c7ae76');
  }
}

/**
 * Draw one complete avatar. `scale` is an integer output resolution multiplier;
 * the animals use a 48×48 sprite grid within the 96×96 wardrobe coordinates.
 * Unknown equipment values fall back to the default item for that slot.
 * Returns normalized options, useful for optional preview diagnostics.
 */
export function drawAvatar(canvas, {
  character = 'rabbit',
  outfit = 'mint',
  hat = 'none',
  accessory = 'none',
  pose = 'idle',
  background = 'garden',
  scale = 1,
} = {}) {
  if (!canvas || typeof canvas.getContext !== 'function') {
    throw new TypeError('drawAvatar requires a canvas element.');
  }
  const chosen = {
    character: valid('character', character, 'rabbit'),
    outfit: valid('outfit', outfit, 'mint'),
    hat: valid('hat', hat, 'none'),
    accessory: valid('accessory', accessory, 'none'),
    pose: valid('pose', pose, 'idle'),
    background: valid('background', background, 'garden'),
    scale: Math.max(1, Math.min(6, Math.floor(Number(scale) || 1))),
  };
  const resolution = AVATAR_SIZE * chosen.scale;
  canvas.width = resolution;
  canvas.height = resolution;
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) throw new Error('A 2D canvas context is unavailable.');
  context.imageSmoothingEnabled = false;
  context.setTransform(chosen.scale, 0, 0, chosen.scale, 0, 0);
  context.clearRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
  const p = painter(context);
  const happy = chosen.pose === 'happy';
  drawBackground(p, chosen.background);
  const shadowColor = chosen.background === 'transparent' ? '#8b94852f' : BG[chosen.background].shadow;
  p.ellipse(48, 84, happy ? 15 : 18, 3, shadowColor);
  context.save();
  if (happy) context.translate(0, -2);
  if (chosen.accessory === 'wings') drawWings(p);
  drawTail(p, chosen.character);
  drawBackAccessory(p, chosen.accessory);
  drawAnimalEars(p, chosen.character, happy);
  drawFeetAndBody(p, chosen.character);
  drawArms(p, OUTFITS[chosen.outfit], happy, chosen.character);
  drawOutfit(p, chosen.outfit);
  drawAnimalHead(p, chosen.character, happy);
  drawHat(p, chosen.hat);
  drawFrontAccessory(p, chosen.accessory);
  if (happy) {
    p.sparkle(17, 37, chosen.background === 'night' ? '#ecd6a7' : '#d5b16d');
    p.sparkle(78, 38, chosen.background === 'night' ? '#dbc6f0' : '#b79bcf', 1);
  }
  context.restore();
  return chosen;
}

/**
 * Shop thumbnail: shows the actual item on the selected animal friend.
 * Usage: drawItem(canvas, { slot: 'hat', value: 'crown' }).
 * An optional `equipped` object previews the item with the player's current set.
 */
export function drawItem(canvas, item = {}) {
  const equipped = item.equipped && typeof item.equipped === 'object' ? item.equipped : {};
  const options = {
    character: 'rabbit',
    outfit: 'mint',
    hat: 'none',
    accessory: 'none',
    background: 'transparent',
    ...equipped,
    pose: 'idle',
    scale: item.scale || 1,
  };
  if (['character', 'outfit', 'hat', 'accessory', 'background'].includes(item.slot)) {
    options[item.slot] = item.value;
  }
  return drawAvatar(canvas, options);
}
