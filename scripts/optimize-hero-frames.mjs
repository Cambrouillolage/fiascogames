#!/usr/bin/env node
/**
 * Optimize the GAV hero frame sequence for scroll-scrubbing.
 *
 * Reads assets/hero-frames/hero-frame-###.jpg (the source frames, already
 * extracted from the box-rotation video — see extract-hero-frames.sh) and
 * writes two lightweight WebP sets sized for scrubbing on a <canvas>:
 *
 *   assets/hero-frames/mobile/hero-frame-###.webp   (~900px wide  — phones)
 *   assets/hero-frames/desktop/hero-frame-###.webp  (~1920px wide — desktop)
 *
 * Also writes a tiny two-file poster fallback (mobile + desktop, JPEG) used
 * by the <picture> element that renders when JS / canvas isn't available
 * (no-JS, prefers-reduced-motion) — see poster-mobile.jpg / poster-desktop.jpg.
 *
 * Usage: node scripts/optimize-hero-frames.mjs
 * Requires: npm install sharp (dev-only tool, not shipped to the site)
 */
import sharp from 'sharp';
import { readdir, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'assets/hero-frames');
const MOBILE_DIR = path.join(SRC_DIR, 'mobile');
const DESKTOP_DIR = path.join(SRC_DIR, 'desktop');

const MOBILE_WIDTH = 1080;  // extra headroom above what DPR-capped phones need, less visible WebP banding
const DESKTOP_WIDTH = 1920; // matches the new source render (1920x1080), no upscaling
const MOBILE_QUALITY = 86;
const DESKTOP_QUALITY = 84;
const ENCODE_EFFORT = 6;
const CONCURRENCY = 8;
const POSTER_FRAME = 'hero-frame-011.jpg'; // matches FRAME_START in gav/index.html

async function run(){
  await mkdir(MOBILE_DIR, { recursive: true });
  await mkdir(DESKTOP_DIR, { recursive: true });

  const files = (await readdir(SRC_DIR))
    .filter((f) => /^hero-frame-\d+\.jpg$/i.test(f))
    .sort();

  if (!files.length){
    console.error(`No hero-frame-*.jpg files found in ${SRC_DIR}`);
    process.exit(1);
  }

  console.log(`Optimizing ${files.length} frames -> mobile (${MOBILE_WIDTH}px) + desktop (${DESKTOP_WIDTH}px) WebP...`);

  let done = 0;
  const queue = files.slice();
  async function worker(){
    let file;
    while ((file = queue.shift())){
      const src = path.join(SRC_DIR, file);
      const outName = file.replace(/\.jpg$/i, '.webp');

      await sharp(src)
        .resize({ width: MOBILE_WIDTH })
        .webp({ quality: MOBILE_QUALITY, effort: ENCODE_EFFORT })
        .toFile(path.join(MOBILE_DIR, outName));

      await sharp(src)
        .resize({ width: DESKTOP_WIDTH, withoutEnlargement: true })
        .webp({ quality: DESKTOP_QUALITY, effort: ENCODE_EFFORT })
        .toFile(path.join(DESKTOP_DIR, outName));

      done += 1;
      if (done % 20 === 0 || done === files.length){
        process.stdout.write(`  ${done}/${files.length}\r\n`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // Poster fallback: one frame, JPEG, for the no-JS / reduced-motion <picture>.
  const posterSrc = path.join(SRC_DIR, POSTER_FRAME);
  await sharp(posterSrc).resize({ width: MOBILE_WIDTH }).jpeg({ quality: 72, mozjpeg: true })
    .toFile(path.join(SRC_DIR, 'poster-mobile.jpg'));
  await sharp(posterSrc).resize({ width: DESKTOP_WIDTH }).jpeg({ quality: 74, mozjpeg: true })
    .toFile(path.join(SRC_DIR, 'poster-desktop.jpg'));
  await sharp(posterSrc).resize({ width: MOBILE_WIDTH }).webp({ quality: 68 })
    .toFile(path.join(SRC_DIR, 'poster-mobile.webp'));
  await sharp(posterSrc).resize({ width: DESKTOP_WIDTH }).webp({ quality: 72 })
    .toFile(path.join(SRC_DIR, 'poster-desktop.webp'));

  console.log('Done.');
}

run().catch((err) => { console.error(err); process.exit(1); });
