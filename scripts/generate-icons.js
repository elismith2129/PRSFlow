// PRSFlo app-icon generator — run with `node scripts/generate-icons.js` after editing.
// sharp is a devDependency (build-time only; never imported by the app).
//
// THE RIBBON (2026-08-22, Eli — option G1 of docs/design-refs/brand-mark-options.html):
// one solid twisted-ribbon wave, ONE flat colour, on the charcoal ground `#1b1a17`
// (the design system's dark register). No gradients, no glow, no drop shadows — the
// old radial-glow/teal-lime icon is retired. Matches components/PRSFloIcon.tsx exactly
// (same path, same colour); the rounded square lives only here, never in the app.
//
// Main app: sea green `#43dfae` (--c-st-booked) — the sanctioned brand colour.
// Runner:   warm amber `#ffa94d` (--c-st-warm) — keeps the runner set's historical
//           orange identity, now drawn from the system palette.
const sharp = require('sharp');
const fs = require('fs');

const RIBBON = 'M 14 100 Q 70 -10 113 100 Q 156 210 186 100 Q 156 130 113 100 Q 70 70 14 100 Z';

const makeSVG = (fill) => `<svg width="512" height="512" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
  <rect width="200" height="200" rx="44" fill="#1b1a17"/>
  <path d="${RIBBON}" fill="${fill}"/>
</svg>`;

const iconSVG = makeSVG('#43dfae');
const runnerSVG = makeSVG('#ffa94d');

const sizes = [
  { size: 16,  file: 'public/favicon-16x16.png' },
  { size: 32,  file: 'public/favicon-32x32.png' },
  { size: 180, file: 'public/apple-touch-icon.png' },
  { size: 192, file: 'public/icon-192.png' },
  { size: 512, file: 'public/icon-512.png' },
];

const runnerSizes = [
  { size: 180, file: 'public/runner-apple-touch-icon.png' },
  { size: 192, file: 'public/runner-icon-192.png' },
  { size: 512, file: 'public/runner-icon-512.png' },
];

async function generate() {
  fs.writeFileSync('public/icon.svg', iconSVG);
  for (const { size, file } of sizes) {
    await sharp(Buffer.from(iconSVG)).resize(size, size).png().toFile(file);
    console.log(`✓ ${file}`);
  }
  fs.writeFileSync('public/runner-icon.svg', runnerSVG);
  for (const { size, file } of runnerSizes) {
    await sharp(Buffer.from(runnerSVG)).resize(size, size).png().toFile(file);
    console.log(`✓ ${file}`);
  }
  console.log('All icons generated.');
}

generate().catch(console.error);
