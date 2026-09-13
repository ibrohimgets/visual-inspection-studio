import {
  MAX_SPEC_FILE_BYTES,
  MAX_SPEC_PAGES,
  type SearchableSpecDocument,
  SpecExtractionError,
  validateSearchableSpecDocument,
} from "./spec-extraction.ts";

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
}

async function fingerprint(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytes.buffer as ArrayBuffer);
  return `sha256:${bytesToHex(new Uint8Array(digest))}`;
}

export function validatePdfFile(file: Pick<File, "name" | "type" | "size">): string | null {
  if (!file.name.toLowerCase().endsWith(".pdf") || (file.type && file.type !== "application/pdf")) {
    return "Choose a PDF document.";
  }
  if (file.size === 0) return "This PDF is empty.";
  if (file.size > MAX_SPEC_FILE_BYTES) return "This PDF exceeds the 10 MB limit.";
  return null;
}

export async function extractSearchablePdf(file: File, supportedClasses: string[]): Promise<SearchableSpecDocument> {
  const fileIssue = validatePdfFile(file);
  if (fileIssue) throw new SpecExtractionError("INVALID_PDF", fileIssue);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const documentId = await fingerprint(bytes);
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/runtime/pdf.worker.min.mjs";

  const loadingTask = pdfjs.getDocument({ data: bytes });
  let pdf: Awaited<typeof loadingTask.promise> | null = null;
  try {
    pdf = await loadingTask.promise;
    if (pdf.numPages > MAX_SPEC_PAGES) {
      throw new SpecExtractionError("INVALID_PAGE_COUNT", `This PDF has ${pdf.numPages} pages; the first version supports up to ${MAX_SPEC_PAGES}.`);
    }
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items.map(item => {
        if (!("str" in item)) return "";
        return `${item.str}${item.hasEOL ? "\n" : " "}`;
      }).join("").replace(/[ \t]+\n/g, "\n").replace(/[ \t]{2,}/g, " ").trim();
      pages.push({ page: pageNumber, text });
      page.cleanup();
    }
    return validateSearchableSpecDocument({ documentId, fileName: file.name, pages, supportedClasses });
  } catch (error) {
    if (error instanceof SpecExtractionError) throw error;
    throw new SpecExtractionError("PDF_READ_FAILED", "The PDF could not be read. Password-protected or scanned PDFs are not supported yet.");
  } finally {
    if (pdf) await pdf.cleanup();
    await loadingTask.destroy();
  }
}
