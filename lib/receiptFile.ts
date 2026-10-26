// ─────────────────────────────────────────────────────────────────────────────
// Receipt files — normalised in the browser BEFORE upload (2026-10-26).
//
// Lori: a receipt showed as a broken image and "tried different ways of
// reuploading and changing format to jpg". Uploads went to storage exactly as
// picked, so an iPhone HEIC (or a renamed one — the extension changes nothing
// inside) rendered nowhere outside Safari and pdf-lib skipped it in the WO
// package. Now:
//   • any image → JPEG, longest side ≤ 2000px (HEIC via heic2any, loaded only
//     when needed; everything else via createImageBitmap + canvas)
//   • a PDF stays a PDF (emailed delivery receipts) — the WO package merges its
//     pages; the receipt tile shows "PDF" and opens it in a new tab
// HEIC is detected by the file's own bytes, not its name or type, because a
// renamed HEIC says .jpg / image/jpeg.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_SIDE = 2000

export type NormalisedReceipt = { blob: Blob; ext: 'jpg' | 'pdf'; contentType: 'image/jpeg' | 'application/pdf' }

async function head(file: Blob, n = 16): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(0, n).arrayBuffer())
}

export async function isPdfFile(file: Blob): Promise<boolean> {
  const b = await head(file, 5)
  return b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 // %PDF
}

async function isHeic(file: Blob): Promise<boolean> {
  const b = await head(file, 12)
  // ISO-BMFF: bytes 4–7 'ftyp', brand at 8–11 (heic, heix, hevc, mif1, msf1…)
  if (!(b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70)) return false
  const brand = String.fromCharCode(b[8], b[9], b[10], b[11])
  return ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)
}

async function toBitmapSource(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await createImageBitmap(file)
  } catch {
    // Older Safari: fall back to an <img>.
    const url = URL.createObjectURL(file)
    try {
      const img = new Image()
      img.src = url
      await img.decode()
      return img
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
  }
}

export async function normaliseReceipt(file: File): Promise<NormalisedReceipt> {
  if (await isPdfFile(file)) return { blob: file, ext: 'pdf', contentType: 'application/pdf' }

  let src: Blob = file
  if (await isHeic(file)) {
    // Safari can decode HEIC itself; everything else needs the converter.
    try {
      await createImageBitmap(file)
    } catch {
      const heic2any = (await import('heic2any')).default as (o: { blob: Blob; toType: string; quality: number }) => Promise<Blob | Blob[]>
      const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 })
      src = Array.isArray(out) ? out[0] : out
    }
  }

  const img = await toBitmapSource(src)
  const w = 'naturalWidth' in img ? img.naturalWidth : img.width
  const h = 'naturalHeight' in img ? img.naturalHeight : img.height
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(w * scale)
  canvas.height = Math.round(h * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable')
  ctx.fillStyle = '#fff'                       // transparent PNGs → white, not black
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img as CanvasImageSource, 0, 0, canvas.width, canvas.height)
  if ('close' in img) img.close()
  const blob: Blob = await new Promise((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error('Could not convert the photo'))), 'image/jpeg', 0.85))
  return { blob, ext: 'jpg', contentType: 'image/jpeg' }
}

export const isPdfPath = (p: string | null | undefined) => !!p && p.toLowerCase().endsWith('.pdf')
