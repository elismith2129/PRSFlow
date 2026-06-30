const sharp = require('sharp');
const fs = require('fs');

const iconSVG = `<svg width="512" height="512" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="teal-fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#5DCAA5"/>
      <stop offset="100%" stop-color="#0e5446"/>
    </linearGradient>
    <linearGradient id="lime-fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#e3f99c"/>
      <stop offset="100%" stop-color="#8ab030"/>
    </linearGradient>
    <radialGradient id="bg-glow" cx="50%" cy="50%" r="65%">
      <stop offset="0%" stop-color="#1a1d24"/>
      <stop offset="100%" stop-color="#0a0b0e"/>
    </radialGradient>
    <filter id="ds" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000000" flood-opacity="0.4"/>
    </filter>
  </defs>
  <rect width="200" height="200" rx="44" fill="url(#bg-glow)"/>
  <path d="M 14 100 Q 70 -10, 113 100 T 186 100" stroke="url(#teal-fade)" stroke-width="9" fill="none" stroke-linecap="round" opacity="0.6" filter="url(#ds)"/>
  <path d="M 14 100 Q 70 30, 113 100 T 186 100" stroke="url(#lime-fade)" stroke-width="9" fill="none" stroke-linecap="round" opacity="0.9" filter="url(#ds)"/>
  <path d="M 14 100 Q 70 70, 113 100 T 186 100" stroke="#e8eaf0" stroke-width="9" fill="none" stroke-linecap="round" filter="url(#ds)"/>
</svg>`;

const runnerSVG = `<svg width="512" height="512" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="runner-bg-glow" cx="50%" cy="50%" r="65%">
      <stop offset="0%" stop-color="#1a1d24"/>
      <stop offset="100%" stop-color="#0a0b0e"/>
    </radialGradient>
    <linearGradient id="orange-fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#fbb86c"/>
      <stop offset="100%" stop-color="#c2540a"/>
    </linearGradient>
    <linearGradient id="lime-fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#e3f99c"/>
      <stop offset="100%" stop-color="#8ab030"/>
    </linearGradient>
    <filter id="ds" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000000" flood-opacity="0.4"/>
    </filter>
  </defs>
  <rect width="200" height="200" rx="44" fill="url(#runner-bg-glow)"/>
  <path d="M 14 100 Q 70 -10, 113 100 T 186 100" stroke="url(#orange-fade)" stroke-width="9" fill="none" stroke-linecap="round" opacity="0.6" filter="url(#ds)"/>
  <path d="M 14 100 Q 70 30, 113 100 T 186 100" stroke="url(#lime-fade)" stroke-width="9" fill="none" stroke-linecap="round" opacity="0.9" filter="url(#ds)"/>
  <path d="M 14 100 Q 70 70, 113 100 T 186 100" stroke="#e8eaf0" stroke-width="9" fill="none" stroke-linecap="round" filter="url(#ds)"/>
</svg>`;

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
