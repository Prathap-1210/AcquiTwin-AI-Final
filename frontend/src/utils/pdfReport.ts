export interface PdfSection {
  heading: string;
  lines: string[];
}

// jsPDF's built-in font is not fully Unicode capable. Convert unsupported
// typography to printable ASCII so reports do not contain broken glyphs.
function printable(value: string): string {
  return value
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2022/g, "-")
    .replace(/[^\x20-\x7e]/g, "?");
}

// Build human-readable report lines rather than placing raw JSON into the PDF.
export function objectLines(value: unknown): string[] {
  const lines: string[] = [];
  function visit(item: unknown, indent: string, depth: number): void {
    if (depth > 10) {
      lines.push(`${indent}Nested data omitted beyond depth 10.`);
      return;
    }
    if (Array.isArray(item)) {
      if (item.length === 0) lines.push(`${indent}No entries recorded.`);
      item.forEach((entry, index) => {
        lines.push(`${indent}Entry ${index + 1}:`);
        visit(entry, `${indent}  `, depth + 1);
      });
      return;
    }
    if (item !== null && typeof item === "object") {
      const fields = Object.entries(item as Record<string, unknown>);
      if (fields.length === 0) lines.push(`${indent}No information returned.`);
      for (const [key, entry] of fields) {
        const label = key.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
        if (entry !== null && typeof entry === "object") {
          lines.push(`${indent}${label}:`);
          visit(entry, `${indent}  `, depth + 1);
        } else {
          lines.push(`${indent}${label}: ${entry === null ? "Not recorded" : String(entry)}`);
        }
      }
      return;
    }
    lines.push(`${indent}${item === null || item === undefined ? "Not recorded" : String(item)}`);
  }
  visit(value, "", 0);
  return lines;
}

export async function downloadPdfReport(
  filename: string,
  title: string,
  subtitle: string,
  sections: PdfSection[],
): Promise<void> {
  // Lazy-load the PDF library so normal dashboard navigation stays responsive.
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const left = 17;
  const right = 17;
  const bottom = 19;
  const pageHeight = pdf.internal.pageSize.getHeight();
  const pageWidth = pdf.internal.pageSize.getWidth();
  const textWidth = pageWidth - left - right;
  let y = 20;

  function addPageIfNeeded(height: number): void {
    if (y + height > pageHeight - bottom) {
      pdf.addPage();
      y = 19;
    }
  }

  function write(text: string, fontSize = 10, bold = false, spacing = 5): void {
    const safe = printable(text).replace(/\t/g, "    ");
    pdf.setFont("helvetica", bold ? "bold" : "normal");
    pdf.setFontSize(fontSize);
    const wrapped = pdf.splitTextToSize(safe || " ", textWidth) as string[];
    const lineHeight = fontSize * 0.43;
    for (const line of wrapped) {
      addPageIfNeeded(lineHeight + 1);
      pdf.text(line, left, y);
      y += lineHeight;
    }
    y += spacing - lineHeight;
  }

  pdf.setTextColor(23, 45, 78);
  write(title, 17, true, 8);
  pdf.setTextColor(60, 78, 103);
  write(subtitle, 10, false, 8);
  pdf.setTextColor(55, 65, 81);
  write(`Generated (UTC): ${new Date().toISOString()}`, 8, false, 9);
  pdf.setDrawColor(198, 211, 228);
  pdf.line(left, y, pageWidth - right, y);
  y += 9;

  for (const section of sections) {
    addPageIfNeeded(14);
    pdf.setTextColor(18, 64, 116);
    write(section.heading, 12, true, 8);
    pdf.setTextColor(35, 48, 66);
    for (const line of section.lines) {
      write(line, 9, false, 4.1);
    }
    y += 5;
  }

  const pageCount = pdf.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    pdf.setPage(page);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(105, 119, 139);
    pdf.text(`Land Acquisition AI - prototype | Page ${page} of ${pageCount}`, left, pageHeight - 10);
  }
  pdf.save(filename);
}
