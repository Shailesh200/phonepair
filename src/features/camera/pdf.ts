// Wrap one or more JPEG images into a minimal PDF (each image = one page, sized to the image).
// No PDF library: a catalog, a pages tree, and one page + DCT image + content stream per photo.

export async function jpegsToPdf(jpegs: { bytes: Uint8Array; w: number; h: number }[]): Promise<Blob> {
  if (!jpegs.length) throw new Error('No pages')
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  const offsets: number[] = []
  let len = 0
  const push = (b: Uint8Array | string) => {
    const u = typeof b === 'string' ? enc.encode(b) : b
    parts.push(u)
    len += u.length
  }
  // %PDF-1.4\n + binary comment, as raw bytes (a text encoder would turn these into UTF-8).
  push(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]))
  const n = jpegs.length
  // objects: 1 catalog, 2 pages, then per page: page, image, content
  const pageIds = jpegs.map((_, i) => 3 + i * 3)
  const obj = (id: number, body: () => void) => {
    offsets[id] = len
    push(`${id} 0 obj\n`)
    body()
    push('\nendobj\n')
  }
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'))
  obj(2, () => push(`<< /Type /Pages /Kids [${pageIds.map((p) => `${p} 0 R`).join(' ')}] /Count ${n} >>`))
  jpegs.forEach((j, i) => {
    if (!j.w || !j.h || !j.bytes?.length) throw new Error('Bad page')
    const pid = pageIds[i]
    const iid = pid + 1
    const cid = pid + 2
    const W = 595
    const H = Math.max(1, Math.round((595 * j.h) / j.w))
    obj(pid, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${iid} 0 R >> >> /Contents ${cid} 0 R >>`))
    obj(iid, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${j.w} /Height ${j.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${j.bytes.length} >>\nstream\n`)
      push(j.bytes)
      push('\nendstream')
    })
    const content = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`
    obj(cid, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`))
  })
  const total = 3 + n * 3
  const xref = len
  push(`xref\n0 ${total}\n0000000000 65535 f \n`)
  for (let i = 1; i < total; i++) push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`)
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`)
  return new Blob(parts as BlobPart[], { type: 'application/pdf' })
}

async function raster(file: Blob): Promise<{ source: CanvasImageSource; w: number; h: number; done: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file)
      return { source: bmp, w: bmp.width, h: bmp.height, done: () => bmp.close() }
    } catch { /* fall through to an Image element (older Safari, odd formats) */ }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image()
      im.onload = () => resolve(im)
      im.onerror = () => reject(new Error('Could not read that photo'))
      im.src = url
    })
    return { source: img, w: img.naturalWidth, h: img.naturalHeight, done: () => URL.revokeObjectURL(url) }
  } catch (e) {
    URL.revokeObjectURL(url)
    throw e
  }
}

export async function imageFileToJpeg(file: Blob, maxSide = 2000): Promise<{ bytes: Uint8Array; w: number; h: number; blob: Blob }> {
  const pic = await raster(file)
  try {
    if (!pic.w || !pic.h) throw new Error('Could not read that photo')
    const s = Math.min(1, maxSide / Math.max(pic.w, pic.h))
    const w = Math.max(1, Math.round(pic.w * s))
    const h = Math.max(1, Math.round(pic.h * s))
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const g = c.getContext('2d')
    if (!g) throw new Error('Could not read that photo')
    g.fillStyle = '#fff'
    g.fillRect(0, 0, w, h)
    g.filter = 'contrast(1.15) brightness(1.05)'
    g.drawImage(pic.source, 0, 0, w, h)
    const blob: Blob = await new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not read that photo'))), 'image/jpeg', 0.88))
    return { bytes: new Uint8Array(await blob.arrayBuffer()), w, h, blob }
  } finally {
    pic.done()
  }
}
