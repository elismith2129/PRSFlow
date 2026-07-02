'use client'
import { useEffect, useState } from 'react'
import { signedPhotoUrl } from '@/lib/photos'

// Renders an image stored in the PRIVATE checklist-photos bucket. Takes the
// stored storage path (or a legacy full public URL), mints a short-lived signed
// URL, and renders it. Renders nothing until the URL resolves (or if it fails).
// Pass `link` to wrap the image in an <a> that opens the signed URL in a new tab
// (replaces the old `<a href={publicUrl}><img/></a>` pattern).
interface SignedImageProps {
  path: string | null | undefined
  alt?: string
  style?: React.CSSProperties
  onError?: () => void
  link?: boolean
  linkStyle?: React.CSSProperties
}

export function SignedImage({ path, alt = '', style, onError, link = false, linkStyle }: SignedImageProps) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    if (!path) {
      setUrl(null)
      return
    }
    signedPhotoUrl(path).then(u => {
      if (active) setUrl(u)
    })
    return () => {
      active = false
    }
  }, [path])

  if (!url) return null

  const img = <img src={url} alt={alt} style={style} onError={onError} />
  if (link) {
    return (
      <a href={url} target="_blank" rel="noreferrer" style={linkStyle}>
        {img}
      </a>
    )
  }
  return img
}
