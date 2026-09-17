/**
 * Browser-local .docx text/HTML extraction via mammoth.
 * Legacy .doc (OLE) is not supported — classifyIngestSource reports "doc".
 */

type MammothInput = { arrayBuffer: ArrayBuffer } | { buffer: Buffer };

type MammothApi = {
  extractRawText: (
    input: MammothInput,
  ) => Promise<{ value: string; messages: { message: string }[] }>;
};

let mammothPromise: Promise<MammothApi> | null = null;

/**
 * mammoth is only needed when a .docx is ingested, so it is fetched on
 * first use rather than shipped in the main bundle. Node's build exposes
 * the API on the namespace, Vite's on `default`.
 */
const loadMammoth = (): Promise<MammothApi> => {
  if (!mammothPromise) {
    mammothPromise = import("mammoth").then(
      (ns) => ((ns as { default?: MammothApi }).default ?? ns) as MammothApi,
    );
  }
  return mammothPromise;
};

const mammothInputFromBuffer = (arrayBuffer: ArrayBuffer): MammothInput => {
  if (typeof window === "undefined") {
    return { buffer: Buffer.from(arrayBuffer) };
  }
  return { arrayBuffer };
};

export const extractDocxText = async (buffer: ArrayBuffer): Promise<string> => {
  const mammoth = await loadMammoth();
  const result = await mammoth.extractRawText(mammothInputFromBuffer(buffer));
  return result.value
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};
