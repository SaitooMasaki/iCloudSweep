#!/usr/bin/env node
// generate-icons.js — Creates PNG icon files for iCloudSweep
// No npm packages required (uses only built-in Node.js zlib).
// Run: node generate-icons.js

'use strict';

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

// ─── Minimal PNG encoder ──────────────────────────────────────────────────────

function crc32(buf) {
  let crc = 0xffffffff;
  if (!crc32.table) {
    crc32.table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crc32.table[n] = c;
    }
  }
  for (const byte of buf) crc = (crc >>> 8) ^ crc32.table[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crcVal = Buffer.alloc(4);
  crcVal.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([len, typeBytes, data, crcVal]);
}

// Creates a PNG from an RGBA Uint8Array (width * height * 4 bytes)
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  // bytes 10,11,12: compression, filter, interlace = 0

  const raw = [];
  for (let y = 0; y < height; y++) {
    raw.push(0); // filter: None
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      raw.push(rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]);
    }
  }

  const compressed = zlib.deflateSync(Buffer.from(raw));
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ─── Icon drawing ─────────────────────────────────────────────────────────────

function inRoundedRect(x, y, w, h, r) {
  if (x < 0 || y < 0 || x >= w || y >= h) return false;
  const cx = x < r ? r : x > w - r - 1 ? w - r - 1 : x;
  const cy = y < r ? r : y > h - r - 1 ? h - r - 1 : y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

// Draw a simplified trash-can icon at normalised coordinates
function isTrash(nx, ny) {
  // nx, ny in [0, 1] relative to the icon content area
  const x = nx, y = ny;

  // Handle bar (top centre)
  if (y >= 0.00 && y < 0.12 && x >= 0.34 && x < 0.66) return true;

  // Lid (thin bar below handle)
  if (y >= 0.14 && y < 0.22 && x >= 0.08 && x < 0.92) return true;

  // Body walls
  if (y >= 0.26 && y < 0.94) {
    if (x >= 0.08 && x < 0.20) return true; // left wall
    if (x >= 0.80 && x < 0.92) return true; // right wall
    if (y >= 0.86)              return true; // bottom
  }

  // Three vertical lines inside body
  if (y >= 0.32 && y < 0.82) {
    if (Math.abs(x - 0.35) < 0.05) return true;
    if (Math.abs(x - 0.50) < 0.05) return true;
    if (Math.abs(x - 0.65) < 0.05) return true;
  }

  return false;
}

function createIconRGBA(size) {
  const rgba = new Uint8Array(size * size * 4);
  const cornerRadius = Math.round(size * 0.22);

  // Apple blue gradient: top #007AFF → bottom #0051D0
  const topBlue    = [0, 122, 255];
  const bottomBlue = [0, 81, 208];

  // Icon content area (inner padding ~18%)
  const pad = Math.round(size * 0.18);
  const contentW = size - pad * 2;
  const contentH = size - pad * 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;

      if (!inRoundedRect(x, y, size, size, cornerRadius)) {
        // Transparent outside rounded rect
        rgba[i] = rgba[i + 1] = rgba[i + 2] = rgba[i + 3] = 0;
        continue;
      }

      // Gradient background
      const t = y / (size - 1);
      const r = Math.round(topBlue[0] + (bottomBlue[0] - topBlue[0]) * t);
      const g = Math.round(topBlue[1] + (bottomBlue[1] - topBlue[1]) * t);
      const b = Math.round(topBlue[2] + (bottomBlue[2] - topBlue[2]) * t);
      rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = 255;

      // White trash icon
      const cx = x - pad;
      const cy = y - pad;
      if (cx >= 0 && cx < contentW && cy >= 0 && cy < contentH) {
        const nx = cx / contentW;
        const ny = cy / contentH;
        if (isTrash(nx, ny)) {
          rgba[i] = 255; rgba[i + 1] = 255; rgba[i + 2] = 255; rgba[i + 3] = 255;
        }
      }
    }
  }

  return rgba;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const iconsDir = path.join(__dirname, 'icons');
if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir);

for (const size of [16, 48, 128]) {
  const rgba = createIconRGBA(size);
  const png = encodePNG(size, size, rgba);
  const outPath = path.join(iconsDir, `icon${size}.png`);
  fs.writeFileSync(outPath, png);
  console.log(`Created ${outPath} (${size}×${size})`);
}

console.log('Done. Icons written to icons/');
