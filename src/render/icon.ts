import { deflateSync } from 'node:zlib';

/**
 * Minimal RGBA PNG writer. The app ships one small generated icon set, which
 * is not worth a native image dependency in the build.
 */
interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed), 0);
  return Buffer.concat([length, typed, crc]);
}

class Canvas {
  private readonly pixels: Uint8ClampedArray;

  constructor(readonly size: number) {
    this.pixels = new Uint8ClampedArray(size * size * 4);
  }

  private blend(x: number, y: number, color: Rgba, coverage: number): void {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return;
    const alpha = (color.a / 255) * coverage;
    if (alpha <= 0) return;

    const index = (y * this.size + x) * 4;
    const dstA = this.pixels[index + 3]! / 255;
    const outA = alpha + dstA * (1 - alpha);
    if (outA <= 0) return;

    for (let channel = 0; channel < 3; channel++) {
      const src = [color.r, color.g, color.b][channel]!;
      const dst = this.pixels[index + channel]!;
      this.pixels[index + channel] = (src * alpha + dst * dstA * (1 - alpha)) / outA;
    }
    this.pixels[index + 3] = outA * 255;
  }

  /** Rounded rectangle with 4x supersampled edges, so icons are not jagged. */
  roundRect(x: number, y: number, w: number, h: number, radius: number, color: Rgba): void {
    const samples = 4;
    const step = 1 / samples;
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.size, Math.ceil(x + w));
    const y1 = Math.min(this.size, Math.ceil(y + h));

    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        let hits = 0;
        for (let sy = 0; sy < samples; sy++) {
          for (let sx = 0; sx < samples; sx++) {
            const cx = px + (sx + 0.5) * step;
            const cy = py + (sy + 0.5) * step;
            if (cx < x || cy < y || cx > x + w || cy > y + h) continue;

            const dx = Math.max(x + radius - cx, cx - (x + w - radius), 0);
            const dy = Math.max(y + radius - cy, cy - (y + h - radius), 0);
            if (dx * dx + dy * dy <= radius * radius) hits++;
          }
        }
        if (hits > 0) this.blend(px, py, color, hits / (samples * samples));
      }
    }
  }

  /** A circle, expressed as the degenerate rounded rect where radius == w/2. */
  circle(cx: number, cy: number, diameter: number, color: Rgba): void {
    const radius = diameter / 2;
    this.roundRect(cx - radius, cy - radius, diameter, diameter, radius, color);
  }

  toPng(): Buffer {
    const stride = this.size * 4;
    const rawData = Buffer.alloc((stride + 1) * this.size);
    for (let y = 0; y < this.size; y++) {
      rawData[y * (stride + 1)] = 0; // filter: none
      Buffer.from(this.pixels.buffer, y * stride, stride).copy(
        rawData,
        y * (stride + 1) + 1,
      );
    }

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.size, 0);
    ihdr.writeUInt32BE(this.size, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // colour type: RGBA
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;

    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(rawData, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  }
}

const BACKGROUND: Rgba = { r: 15, g: 17, b: 21, a: 255 };
const ACCENT: Rgba = { r: 255, g: 201, b: 77, a: 255 };
const POPCORN: Rgba = { r: 255, g: 246, b: 224, a: 255 };

/**
 * A tub of popcorn on the app's dark background — the app is called Kokice.
 * `fullBleed` squares off the background for maskable and iOS icons, which are
 * masked by the platform.
 *
 * The kernels are drawn before the tub so the tub's front edge overlaps them,
 * which is what reads as popcorn sitting *in* the tub rather than behind it.
 */
export function renderIcon(size: number, fullBleed = false): Buffer {
  const canvas = new Canvas(size);
  canvas.roundRect(0, 0, size, size, fullBleed ? 0 : size * 0.22, BACKGROUND);

  // Maskable icons must keep their art inside the central safe zone.
  const scale = fullBleed ? 0.62 : 0.78;
  const art = size * scale;
  const left = (size - art) / 2;
  const top = (size - art) / 2;
  const midX = size / 2;

  // Kernels: one large centre puff with smaller ones tucked around it, so the
  // silhouette stays lumpy rather than reading as a row of equal circles.
  const kernels: [number, number, number][] = [
    [midX, top + art * 0.3, art * 0.32],
    [midX - art * 0.23, top + art * 0.37, art * 0.27],
    [midX + art * 0.23, top + art * 0.37, art * 0.27],
    [midX - art * 0.11, top + art * 0.15, art * 0.22],
    [midX + art * 0.13, top + art * 0.17, art * 0.2],
  ];
  for (const [cx, cy, diameter] of kernels) {
    canvas.circle(cx, cy, diameter, POPCORN);
  }

  const tubW = art * 0.68;
  const tubH = art * 0.48;
  const tubX = midX - tubW / 2;
  const tubY = top + art * 0.5;
  canvas.roundRect(tubX, tubY, tubW, tubH, tubW * 0.08, ACCENT);

  // Vertical stripes, the one detail that makes a plain rectangle read as a
  // cinema popcorn tub.
  const stripes = 4;
  const stripeW = tubW / (stripes * 2 + 1);
  for (let i = 0; i < stripes; i++) {
    const sx = tubX + stripeW * (i * 2 + 1);
    canvas.roundRect(sx, tubY, stripeW, tubH, 0, BACKGROUND);
  }

  return canvas.toPng();
}

export const MANIFEST = {
  name: 'Kokice',
  short_name: 'Kokice',
  description:
    'Kokice — objedinjen repertoar bioskopa u Novom Sadu i Beogradu, osvežen svakog sata.',
  lang: 'sr-Latn-RS',
  dir: 'ltr',
  start_url: './index.html',
  scope: './',
  display: 'standalone',
  orientation: 'portrait',
  background_color: '#0f1115',
  theme_color: '#0f1115',
  categories: ['entertainment', 'lifestyle'],
  icons: [
    { src: 'assets/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'assets/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    {
      src: 'assets/icon-maskable-512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'maskable',
    },
  ],
};
