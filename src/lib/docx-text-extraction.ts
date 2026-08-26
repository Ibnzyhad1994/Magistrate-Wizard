/**
 * Browser-local .docx text/HTML extraction via mammoth.
 * Legacy .doc (OLE) is not supported — classifyIngestSource reports "doc".
 */

import * as MammothNS from "mammoth"

type MammothInput = { arrayBuffer: ArrayBuffer } | { buffer: Buffer }

type MammothApi = {
  extractRawText: (input: MammothInput) => Promise<{ value: string; messages: { message: string }[] }>
}

const mammoth = ((MammothNS as { default?: MammothApi }).default ?? MammothNS) as MammothApi

const mammothInputFromBuffer = (arrayBuffer: ArrayBuffer): MammothInput => {
  if (typeof window === "undefined") {
    return { buffer: Buffer.from(arrayBuffer) }
  }
  return { arrayBuffer }
}

export const extractDocxText = async (buffer: ArrayBuffer): Promise<string> => {
  const result = await mammoth.extractRawText(mammothInputFromBuffer(buffer))
  return result.value.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim()
}
