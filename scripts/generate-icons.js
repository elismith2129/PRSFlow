const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const mainSVG = `<svg width="512" height="512" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="metal-bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#1e2028"/>
      <stop offset="50%" stop-color="#0d0f14"/>
      <stop offset="100%" stop-color="#1a1c22"/>
    </linearGradient>
    <linearGradient id="chrome-prs" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="40%" stop-color="#c8f04e"/>
      <stop offset="60%" stop-color="#8ab030"/>
      <stop offset="100%" stop-color="#c8f04e"/>
    </linearGradient>
    <linearGradient id="chrome-flow" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="35%" stop-color="#e8eaf0"/>
      <stop offset="65%" stop-color="#9ca3af"/>
      <stop offset="100%" stop-color="#e8eaf0"/>
    </linearGradient>
  </defs>
  <rect width="200" height="200" rx="44" fill="url(#metal-bg)"/>
  <rect x="1" y="1" width="198" height="90" rx="43" fill="white" fill-opacity="0.04"/>
  <text x="39" y="101" font-family="Arial Black, sans-serif" font-weight="800" font-size="48" fill="#14B8A6" fill-opacity="0.45" textLength="130" lengthAdjust="spacingAndGlyphs">PRS</text>
  <text x="39" y="151" font-family="Arial Black, sans-serif" font-weight="800" font-size="48" fill="#14B8A6" fill-opacity="0.45" textLength="130" lengthAdjust="spacingAndGlyphs">FLOW</text>
  <text x="35" y="98" font-family="Arial Black, sans-serif" font-weight="800" font-size="48" fill="url(#chrome-prs)" textLength="130" lengthAdjust="spacingAndGlyphs">PRS</text>
  <text x="35" y="148" font-family="Arial Black, sans-serif" font-weight="800" font-size="48" fill="url(#chrome-flow)" textLength="130" lengthAdjust="spacingAndGlyphs">FLOW</text>
</svg>`;

const runnerSVG = `<svg width="512" height="512" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg-r" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#1e2028"/>
      <stop offset="50%" stop-color="#0d0f14"/>
      <stop offset="100%" stop-color="#1a1c22"/>
    </linearGradient>
    <linearGradient id="prs-r" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="40%" stop-color="#c8f04e"/>
      <stop offset="60%" stop-color="#8ab030"/>
      <stop offset="100%" stop-color="#c8f04e"/>
    </linearGradient>
    <linearGradient id="flow-r" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="35%" stop-color="#e8eaf0"/>
      <stop offset="65%" stop-color="#9ca3af"/>
      <stop offset="100%" stop-color="#e8eaf0"/>
    </linearGradient>
  </defs>
  <rect width="200" height="200" rx="44" fill="url(#bg-r)"/>
  <rect x="1" y="1" width="198" height="90" rx="43" fill="white" fill-opacity="0.04"/>
  <text x="28" y="73" font-family="Arial Black, sans-serif" font-weight="800" font-size="40" fill="#14B8A6" fill-opacity="0.45" textLength="152" lengthAdjust="spacingAndGlyphs">PRS</text>
  <text x="28" y="113" font-family="Arial Black, sans-serif" font-weight="800" font-size="40" fill="#14B8A6" fill-opacity="0.45" textLength="152" lengthAdjust="spacingAndGlyphs">FLOW</text>
  <text x="24" y="70" font-family="Arial Black, sans-serif" font-weight="800" font-size="40" fill="url(#prs-r)" textLength="152" lengthAdjust="spacingAndGlyphs">PRS</text>
  <text x="24" y="110" font-family="Arial Black, sans-serif" font-weight="800" font-size="40" fill="url(#flow-r)" textLength="152" lengthAdjust="spacingAndGlyphs">FLOW</text>
  <line x1="24" y1="122" x2="176" y2="122" stroke="#14B8A6" stroke-width="0.75" stroke-opacity="0.5"/>
  <text x="100" y="150" font-family="Arial Black, sans-serif" font-weight="800" font-size="22" fill="#14B8A6" text-anchor="middle" textLength="140" lengthAdjust="spacingAndGlyphs">RUNNER</text>
</svg>`;

const mainSizes = [
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
  fs.writeFileSync('public/icon.svg', mainSVG);
  fs.writeFileSync('public/runner-icon.svg', runnerSVG);

  for (const { size, file } of mainSizes) {
    await sharp(Buffer.from(mainSVG)).resize(size, size).png().toFile(file);
    console.log(`✓ ${file}`);
  }
  for (const { size, file } of runnerSizes) {
    await sharp(Buffer.from(runnerSVG)).resize(size, size).png().toFile(file);
    console.log(`✓ ${file}`);
  }
  console.log('All icons generated.');
}

generate().catch(console.error);
