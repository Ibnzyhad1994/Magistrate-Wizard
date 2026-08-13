/**
 * Best-effort extraction of already-encoded raster images (JPEG) from a
 * PDF, used when pdf.js cannot rasterize a page (malformed page tree) but
 * the file still contains /DCTDecode XObjects — the common scanner
 * "image-only page" shape.
 *
 * Does not invent PNG wrappers around raw FlateDecode pixel buffers;
 * those need a real renderer (see rasterize-pdf.ts).
 */

export interface EmbeddedRasterImage {
  bytes: Uint8Array
  mimeType: "image/jpeg"
}

const findStreamRanges = (raw: string): { dictStart: number; start: number; end: number }[] => {
  const ranges: { dictStart: number; start: number; end: number }[] = []
  const streamKw = "stream"
  const endKw = "endstream"
  let searchFrom = 0
  const n = raw.length

  while (searchFrom < n) {
    const kwIdx = raw.indexOf(streamKw, searchFrom)
    if (kwIdx === -1) break
    const before = kwIdx > 0 ? raw[kwIdx - 1] : " "
    if (/[A-Za-z]/.test(before)) {
      searchFrom = kwIdx + streamKw.length
      continue
    }
    let dataStart = kwIdx + streamKw.length
    if (raw[dataStart] === "\r" && raw[dataStart + 1] === "\n") dataStart += 2
    else if (raw[dataStart] === "\n" || raw[dataStart] === "\r") dataStart += 1
    const endIdx = raw.indexOf(endKw, dataStart)
    if (endIdx === -1) break
    const dictStart = Math.max(0, kwIdx - 400)
    ranges.push({ dictStart, start: dataStart, end: endIdx })
    searchFrom = endIdx + endKw.length
  }
  return ranges
}

const isJpeg = (bytes: Uint8Array): boolean => {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
}

export const extractEmbeddedJpegImages = async (file: File): Promise<EmbeddedRasterImage[]> => {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  const raw = new TextDecoder("iso-8859-1").decode(bytes)
  const images: EmbeddedRasterImage[] = []

  for (const range of findStreamRanges(raw)) {
    const dict = raw.slice(range.dictStart, range.start)
    const isImage = dict.includes("/Subtype/Image") || dict.includes("/Subtype /Image")
    const isJpegFilter = dict.includes("/DCTDecode")
    if (!isImage && !isJpegFilter) continue
    if (!isJpegFilter) continue
    const slice = bytes.subarray(range.start, range.end)
    if (!isJpeg(slice)) continue
    images.push({ bytes: slice.slice(), mimeType: "image/jpeg" })
  }
  return images
}
