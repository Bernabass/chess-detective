// A tiny GIF recorder for the README demos: screenshots in, an animated GIF out.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Page } from '@playwright/test';
import gifenc from 'gifenc';
import { PNG } from 'pngjs';

export class GifRecorder {
  private readonly frames: { png: Buffer; delayMs: number }[] = [];

  constructor(private readonly page: Page) {}

  /** Captures the viewport and shows it for delayMs. */
  async frame(delayMs: number): Promise<void> {
    // Let animations (board moves, fades) finish before the frame is taken.
    await this.page.waitForTimeout(250);
    this.frames.push({ png: await this.page.screenshot({ type: 'png' }), delayMs });
  }

  /** Encodes the frames (each with its own 256-colour palette) and writes the GIF. */
  save(path: string): number {
    const gif = gifenc.GIFEncoder();
    for (const { png, delayMs } of this.frames) {
      const { width, height, data } = PNG.sync.read(png);
      const rgba = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      const palette = gifenc.quantize(rgba, 256);
      gif.writeFrame(gifenc.applyPalette(rgba, palette), width, height, {
        palette,
        delay: delayMs,
      });
    }
    gif.finish();
    const bytes = gif.bytes();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
    return bytes.byteLength;
  }
}
