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

// HOME-SCREEN VARIANT — square and fully opaque, NO rounded corners, no alpha.
// Used for apple-touch-icon AND the manifest 192/512 icons. The OS rounds icons
// itself; baking rounded corners + transparent pixels in makes iOS reject the
// icon outright and fall back to a letter tile ("P"). Android tolerated the
// rounded PNGs, iOS did not — and iOS 17.4+ pulls the Add-to-Home-Screen icon
// from the MANIFEST icons, not just apple-touch-icon, so ALL of them must be
// clean. Discovered on iPhone 2026-08-22. Only the tiny favicons and icon.svg
// keep the rounded look (browser-tab use, never masked by an OS).
const makeSquareSVG = (fill) => `<svg width="512" height="512" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
  <rect width="200" height="200" fill="#1b1a17"/>
  <path d="${RIBBON}" fill="${fill}"/>
</svg>`;

// MASKABLE VARIANT — Android adaptive icons crop to a central "safe zone"
// (~80% circle), so the ribbon is scaled down and centered or a circular
// launcher mask would clip its tips.
const makeMaskableSVG = (fill) => `<svg width="512" height="512" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
  <rect width="200" height="200" fill="#1b1a17"/>
  <g transform="translate(100 100) scale(0.68) translate(-100 -100)">
    <path d="${RIBBON}" fill="${fill}"/>
  </g>
</svg>`;

const iconSVG = makeSVG('#43dfae');
const runnerSVG = makeSVG('#ffa94d');
const squareSVG = makeSquareSVG('#43dfae');
const runnerSquareSVG = makeSquareSVG('#ffa94d');
const maskableSVG = makeMaskableSVG('#43dfae');
const runnerMaskableSVG = makeMaskableSVG('#ffa94d');

const opaque = (svg, size, file) =>
  sharp(Buffer.from(svg)).resize(size, size).flatten({ background: '#1b1a17' }).png().toFile(file);

async function generate() {
  // Rounded look survives only where no OS mask applies: tab favicons + icon.svg.
  fs.writeFileSync('public/icon.svg', iconSVG);
  for (const size of [16, 32]) {
    await sharp(Buffer.from(iconSVG)).resize(size, size).png().toFile(`public/favicon-${size}x${size}.png`);
    console.log(`✓ public/favicon-${size}x${size}.png`);
  }
  // Home-screen set: square, opaque, no alpha channel.
  await opaque(squareSVG, 180, 'public/apple-touch-icon.png');
  await opaque(squareSVG, 192, 'public/icon-192.png');
  await opaque(squareSVG, 512, 'public/icon-512.png');
  await opaque(maskableSVG, 512, 'public/icon-512-maskable.png');
  console.log('✓ main home-screen set (square/opaque + maskable)');

  fs.writeFileSync('public/runner-icon.svg', runnerSVG);
  await opaque(runnerSquareSVG, 180, 'public/runner-apple-touch-icon.png');
  await opaque(runnerSquareSVG, 192, 'public/runner-icon-192.png');
  await opaque(runnerSquareSVG, 512, 'public/runner-icon-512.png');
  await opaque(runnerMaskableSVG, 512, 'public/runner-icon-512-maskable.png');
  console.log('✓ runner home-screen set (square/opaque + maskable)');
  console.log('All icons generated.');
}

generate().catch(console.error);
