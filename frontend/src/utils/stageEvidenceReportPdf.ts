import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";

// ============================================================
// ACQUITWIN AI — STAGE EVIDENCE REPORT PDF
// Uses the same visual language as predictionReportPdf.ts while
// keeping stage evidence separate from ML prediction reporting.
// ============================================================

export interface StageEvidenceReportData {
  projectId: number;
  projectName: string;
  events: unknown;
  readiness: unknown;
  bottlenecks: unknown;
}

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN_LEFT = 42;
const MARGIN_RIGHT = 42;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
const HEADER_BOTTOM = 650;
const FOOTER_TOP = 52;

const COLORS = {
  saffron: rgb(1, 0.6, 0.2),
  green: rgb(19 / 255, 136 / 255, 8 / 255),
  navy: rgb(11 / 255, 42 / 255, 107 / 255),
  ink: rgb(31 / 255, 41 / 255, 55 / 255),
  muted: rgb(95 / 255, 105 / 255, 120 / 255),
  line: rgb(210 / 255, 216 / 255, 224 / 255),
  softBlue: rgb(243 / 255, 247 / 255, 252 / 255),
  softOrange: rgb(1, 248 / 255, 235 / 255),
  softGreen: rgb(240 / 255, 250 / 255, 245 / 255),
  white: rgb(1, 1, 1),
};

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
}

interface ReportContext {
  pdf: PDFDocument;
  fonts: Fonts;
  pages: PDFPage[];
  currentPage: PDFPage;
  y: number;
  reportId: string;
  emblem: PDFImage | null;
}

function makePdfTextSafe(value: string): string {
  return value
    .replace(/₹/g, "INR ")
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/•/g, "-")
    .replace(/→/g, "->")
    .replace(/←/g, "<-")
    .replace(/↑/g, "Increase")
    .replace(/↓/g, "Decrease")
    .replace(/≥/g, ">=")
    .replace(/≤/g, "<=")
    .replace(/±/g, "+/-")
    .replace(/×/g, "x")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizePdfValue<T>(value: T): T {
  if (typeof value === "string") {
    return makePdfTextSafe(value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizePdfValue(item)) as T;
  }

  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = sanitizePdfValue(item);
    }
    return result as T;
  }

  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function firstValue(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in record && record[key] !== null && record[key] !== undefined) {
      return record[key];
    }
  }
  return undefined;
}

function textValue(value: unknown, fallback = "Not recorded"): string {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text ? text : fallback;
}

function numberValue(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function formatStatus(value: unknown): string {
  const raw = textValue(value, "Not recorded");
  if (raw === "Not recorded") return raw;
  return raw.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDateTime(value: unknown): string {
  const raw = textValue(value);
  return raw === "Not recorded" ? raw : raw.replace("T", " ").slice(0, 19);
}

function todayDisplay(): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date());
}

function reportTimestampId(): string {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(
    date.getHours(),
  )}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function sanitizeFilename(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function wrapText(
  text: string,
  font: PDFFont,
  fontSize: number,
  maxWidth: number,
): string[] {
  const normalized = makePdfTextSafe(text).replace(/\s+/g, " ").trim();
  if (!normalized) return [""];

  const words = normalized.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      currentLine = candidate;
      continue;
    }

    if (currentLine) lines.push(currentLine);

    if (font.widthOfTextAtSize(word, fontSize) <= maxWidth) {
      currentLine = word;
      continue;
    }

    let fragment = "";
    for (const character of word) {
      const next = fragment + character;
      if (font.widthOfTextAtSize(next, fontSize) > maxWidth) {
        if (fragment) lines.push(fragment);
        fragment = character;
      } else {
        fragment = next;
      }
    }
    currentLine = fragment;
  }

  if (currentLine) lines.push(currentLine);
  return lines;
}

function drawTricolourBand(page: PDFPage): void {
  page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 8, width: PAGE_WIDTH, height: 3, color: COLORS.saffron });
  page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 13, width: PAGE_WIDTH, height: 3, color: COLORS.green });
}

async function loadHeaderEmblem(pdf: PDFDocument): Promise<PDFImage | null> {
  const sources = [
    "/emblem_of_india.png",
    "https://upload.wikimedia.org/wikipedia/commons/e/ee/Emblem_of_India_%28Government_Gazette%29.png",
  ];

  for (const source of sources) {
    try {
      const response = await fetch(source);
      if (!response.ok) continue;
      const bytes = await response.arrayBuffer();
      return await pdf.embedPng(bytes);
    } catch {
      // Try next source.
    }
  }

  return null;
}

function drawCenteredText(
  page: PDFPage,
  text: string,
  font: PDFFont,
  size: number,
  centerX: number,
  y: number,
  color = COLORS.ink,
): void {
  const safeText = makePdfTextSafe(text);
  const width = font.widthOfTextAtSize(safeText, size);
  page.drawText(safeText, { x: centerX - width / 2, y, size, font, color });
}

function drawHeader(page: PDFPage, fonts: Fonts, emblem: PDFImage | null): void {
  drawTricolourBand(page);

  const emblemX = MARGIN_LEFT;
  const emblemY = PAGE_HEIGHT - 120;
  const emblemWidth = 44;
  const emblemHeight = 58;

  if (emblem) {
    page.drawImage(emblem, {
      x: emblemX,
      y: emblemY,
      width: emblemWidth,
      height: emblemHeight,
    });
  } else {
    page.drawRectangle({
      x: emblemX,
      y: emblemY + 3,
      width: emblemWidth,
      height: emblemHeight - 6,
      borderColor: COLORS.line,
      borderWidth: 0.7,
      color: COLORS.white,
    });
    drawCenteredText(page, "EMBLEM", fonts.bold, 6.2, emblemX + emblemWidth / 2, emblemY + 29, COLORS.navy);
    drawCenteredText(page, "REFERENCE", fonts.regular, 4.8, emblemX + emblemWidth / 2, emblemY + 19, COLORS.muted);
  }

  const centerLeft = emblemX + emblemWidth + 12;
  const badgeWidth = 118;
  const badgeX = PAGE_WIDTH - MARGIN_RIGHT - badgeWidth;
  const centerRight = badgeX - 10;
  const centerX = centerLeft + (centerRight - centerLeft) / 2;

  drawCenteredText(page, "GOVERNMENT OF INDIA", fonts.bold, 8.4, centerX, PAGE_HEIGHT - 49, COLORS.navy);
  drawCenteredText(page, "MINISTRY OF RURAL DEVELOPMENT", fonts.bold, 10.2, centerX, PAGE_HEIGHT - 63, COLORS.navy);
  drawCenteredText(page, "LAND ACQUISITION & RURAL INFRASTRUCTURE", fonts.bold, 7.1, centerX, PAGE_HEIGHT - 79, COLORS.ink);
  drawCenteredText(page, "DEVELOPMENT PROJECTS", fonts.bold, 7.1, centerX, PAGE_HEIGHT - 90, COLORS.ink);
  drawCenteredText(page, "Project Monitoring and Assessment Series", fonts.regular, 6.7, centerX, PAGE_HEIGHT - 104, COLORS.muted);

  const badgeHeight = 42;
  const badgeY = PAGE_HEIGHT - 92;
  page.drawRectangle({
    x: badgeX,
    y: badgeY,
    width: badgeWidth,
    height: badgeHeight,
    borderColor: COLORS.navy,
    borderWidth: 0.8,
    color: COLORS.softBlue,
  });
  drawCenteredText(page, "ACQUITWIN AI", fonts.bold, 7.2, badgeX + badgeWidth / 2, badgeY + 27, COLORS.navy);
  drawCenteredText(page, "STUDENT / RESEARCH", fonts.bold, 5.8, badgeX + badgeWidth / 2, badgeY + 16, COLORS.ink);
  drawCenteredText(page, "PROTOTYPE - NOT OFFICIAL", fonts.bold, 5.3, badgeX + badgeWidth / 2, badgeY + 7, COLORS.muted);

  page.drawLine({
    start: { x: MARGIN_LEFT, y: PAGE_HEIGHT - 129 },
    end: { x: PAGE_WIDTH - MARGIN_RIGHT, y: PAGE_HEIGHT - 129 },
    thickness: 0.8,
    color: COLORS.line,
  });

  page.drawRectangle({ x: MARGIN_LEFT, y: PAGE_HEIGHT - 136, width: 82, height: 2, color: COLORS.saffron });
  page.drawRectangle({ x: MARGIN_LEFT + 82, y: PAGE_HEIGHT - 136, width: CONTENT_WIDTH - 164, height: 2, color: COLORS.line });
  page.drawRectangle({ x: PAGE_WIDTH - MARGIN_RIGHT - 82, y: PAGE_HEIGHT - 136, width: 82, height: 2, color: COLORS.green });

  page.drawText("STAGE EVIDENCE REPORT", {
    x: MARGIN_LEFT,
    y: PAGE_HEIGHT - 158,
    size: 15.5,
    font: fonts.bold,
    color: COLORS.navy,
  });

  page.drawText("Land Acquisition Stage Record & Bottleneck Assessment", {
    x: MARGIN_LEFT,
    y: PAGE_HEIGHT - 174,
    size: 8.7,
    font: fonts.regular,
    color: COLORS.muted,
  });

  const prototypeNotice =
    "SIH STUDENT / RESEARCH PROTOTYPE - NOT ISSUED BY THE MINISTRY OF RURAL DEVELOPMENT";
  const noticeWidth = fonts.bold.widthOfTextAtSize(prototypeNotice, 5.4);
  page.drawText(prototypeNotice, {
    x: PAGE_WIDTH - MARGIN_RIGHT - noticeWidth,
    y: PAGE_HEIGHT - 174,
    size: 5.4,
    font: fonts.bold,
    color: COLORS.muted,
  });
}

function drawFooter(
  page: PDFPage,
  fonts: Fonts,
  reportId: string,
  pageNumber: number,
  totalPages: number,
): void {
  page.drawLine({
    start: { x: MARGIN_LEFT, y: FOOTER_TOP },
    end: { x: PAGE_WIDTH - MARGIN_RIGHT, y: FOOTER_TOP },
    thickness: 0.7,
    color: COLORS.line,
  });

  page.drawText(`Report ID: ${makePdfTextSafe(reportId)}`, {
    x: MARGIN_LEFT,
    y: 36,
    size: 6.8,
    font: fonts.regular,
    color: COLORS.muted,
  });

  const pageText = `Page ${pageNumber} of ${totalPages}`;
  const pageTextWidth = fonts.bold.widthOfTextAtSize(pageText, 6.8);
  page.drawText(pageText, {
    x: PAGE_WIDTH / 2 - pageTextWidth / 2,
    y: 36,
    size: 6.8,
    font: fonts.bold,
    color: COLORS.navy,
  });

  const prototypeText = "AcquiTwin AI prototype";
  const prototypeWidth = fonts.regular.widthOfTextAtSize(prototypeText, 6.8);
  page.drawText(prototypeText, {
    x: PAGE_WIDTH - MARGIN_RIGHT - prototypeWidth,
    y: 36,
    size: 6.8,
    font: fonts.regular,
    color: COLORS.muted,
  });

  const disclaimer =
    "For SIH demonstration and research use. Not issued by or on behalf of the Government of India.";
  const disclaimerWidth = fonts.regular.widthOfTextAtSize(disclaimer, 5.7);
  page.drawText(disclaimer, {
    x: PAGE_WIDTH / 2 - disclaimerWidth / 2,
    y: 22,
    size: 5.7,
    font: fonts.regular,
    color: COLORS.muted,
  });

  page.drawRectangle({ x: 0, y: 7, width: PAGE_WIDTH, height: 2, color: COLORS.saffron });
  page.drawRectangle({ x: 0, y: 3, width: PAGE_WIDTH, height: 2, color: COLORS.green });
}

function createReportPage(context: ReportContext): PDFPage {
  const page = context.pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  drawHeader(page, context.fonts, context.emblem);
  context.pages.push(page);
  context.currentPage = page;
  context.y = HEADER_BOTTOM;
  return page;
}

function ensureSpace(context: ReportContext, requiredHeight: number): void {
  if (context.y - requiredHeight < FOOTER_TOP + 18) {
    createReportPage(context);
  }
}

function drawWrappedParagraph(
  context: ReportContext,
  text: string,
  options?: {
    size?: number;
    bold?: boolean;
    color?: ReturnType<typeof rgb>;
    indent?: number;
    spacingAfter?: number;
    lineHeight?: number;
  },
): void {
  const size = options?.size ?? 9;
  const font = options?.bold ? context.fonts.bold : context.fonts.regular;
  const color = options?.color ?? COLORS.ink;
  const indent = options?.indent ?? 0;
  const lineHeight = options?.lineHeight ?? size * 1.35;
  const spacingAfter = options?.spacingAfter ?? 7;
  const maxWidth = CONTENT_WIDTH - indent;
  const lines = wrapText(text, font, size, maxWidth);

  for (const line of lines) {
    ensureSpace(context, lineHeight + 2);
    context.currentPage.drawText(line, {
      x: MARGIN_LEFT + indent,
      y: context.y,
      size,
      font,
      color,
    });
    context.y -= lineHeight;
  }

  context.y -= spacingAfter;
}

function drawSectionTitle(context: ReportContext, title: string): void {
  ensureSpace(context, 35);
  context.currentPage.drawRectangle({
    x: MARGIN_LEFT,
    y: context.y - 4,
    width: 4,
    height: 18,
    color: COLORS.saffron,
  });
  context.currentPage.drawText(makePdfTextSafe(title), {
    x: MARGIN_LEFT + 11,
    y: context.y,
    size: 12,
    font: context.fonts.bold,
    color: COLORS.navy,
  });
  context.y -= 27;
}

function drawKeyValueRow(context: ReportContext, label: string, value: string): void {
  const labelWidth = 142;
  const safeValue = makePdfTextSafe(value);
  const valueLines = wrapText(safeValue, context.fonts.regular, 7.8, CONTENT_WIDTH - labelWidth - 18).slice(0, 3);
  const rowHeight = Math.max(24, 14 + valueLines.length * 9);
  ensureSpace(context, rowHeight);

  context.currentPage.drawRectangle({
    x: MARGIN_LEFT,
    y: context.y - rowHeight + 6,
    width: CONTENT_WIDTH,
    height: rowHeight,
    color: COLORS.softBlue,
    borderColor: COLORS.line,
    borderWidth: 0.5,
  });

  context.currentPage.drawText(makePdfTextSafe(label), {
    x: MARGIN_LEFT + 9,
    y: context.y - 8,
    size: 7.7,
    font: context.fonts.bold,
    color: COLORS.navy,
  });

  valueLines.forEach((line, index) => {
    context.currentPage.drawText(line, {
      x: MARGIN_LEFT + labelWidth,
      y: context.y - 8 - index * 9,
      size: 7.8,
      font: context.fonts.regular,
      color: COLORS.ink,
    });
  });

  context.y -= rowHeight;
}

function drawMetricBox(
  context: ReportContext,
  x: number,
  width: number,
  label: string,
  value: string,
): void {
  const height = 57;
  context.currentPage.drawRectangle({
    x,
    y: context.y - height,
    width,
    height,
    color: COLORS.softBlue,
    borderColor: COLORS.line,
    borderWidth: 0.7,
  });

  context.currentPage.drawText(makePdfTextSafe(label), {
    x: x + 10,
    y: context.y - 17,
    size: 7,
    font: context.fonts.bold,
    color: COLORS.muted,
  });

  const valueLines = wrapText(value, context.fonts.bold, 11.5, width - 20).slice(0, 2);
  valueLines.forEach((line, index) => {
    context.currentPage.drawText(line, {
      x: x + 10,
      y: context.y - 37 - index * 12,
      size: 11.5,
      font: context.fonts.bold,
      color: COLORS.navy,
    });
  });
}

function drawBullet(context: ReportContext, text: string): void {
  const size = 8.5;
  const lineHeight = 11.5;
  const indent = 14;
  const lines = wrapText(text, context.fonts.regular, size, CONTENT_WIDTH - indent);

  lines.forEach((line, index) => {
    ensureSpace(context, lineHeight + 2);
    if (index === 0) {
      context.currentPage.drawCircle({
        x: MARGIN_LEFT + 3,
        y: context.y + 3,
        size: 1.8,
        color: COLORS.navy,
      });
    }
    context.currentPage.drawText(line, {
      x: MARGIN_LEFT + indent,
      y: context.y,
      size,
      font: context.fonts.regular,
      color: COLORS.ink,
    });
    context.y -= lineHeight;
  });

  context.y -= 3;
}

function drawNoticeBox(context: ReportContext, title: string, body: string): void {
  const bodyLines = wrapText(body, context.fonts.regular, 7.4, CONTENT_WIDTH - 24);
  const boxHeight = 34 + bodyLines.length * 8.6;
  ensureSpace(context, boxHeight + 14);

  context.currentPage.drawRectangle({
    x: MARGIN_LEFT,
    y: context.y - boxHeight,
    width: CONTENT_WIDTH,
    height: boxHeight,
    color: COLORS.softOrange,
    borderColor: COLORS.navy,
    borderWidth: 0.7,
  });
  context.currentPage.drawRectangle({
    x: MARGIN_LEFT,
    y: context.y - boxHeight,
    width: 4,
    height: boxHeight,
    color: COLORS.saffron,
  });
  context.currentPage.drawText(makePdfTextSafe(title), {
    x: MARGIN_LEFT + 12,
    y: context.y - 17,
    size: 8,
    font: context.fonts.bold,
    color: COLORS.navy,
  });
  bodyLines.forEach((line, index) => {
    context.currentPage.drawText(line, {
      x: MARGIN_LEFT + 12,
      y: context.y - 32 - index * 8.6,
      size: 7.4,
      font: context.fonts.regular,
      color: COLORS.ink,
    });
  });
  context.y -= boxHeight + 16;
}

function drawEmptyState(context: ReportContext, text: string): void {
  const lines = wrapText(text, context.fonts.regular, 8.2, CONTENT_WIDTH - 24);
  const height = 28 + lines.length * 10;
  ensureSpace(context, height + 8);

  context.currentPage.drawRectangle({
    x: MARGIN_LEFT,
    y: context.y - height,
    width: CONTENT_WIDTH,
    height,
    color: COLORS.softGreen,
    borderColor: COLORS.line,
    borderWidth: 0.7,
  });

  lines.forEach((line, index) => {
    context.currentPage.drawText(line, {
      x: MARGIN_LEFT + 12,
      y: context.y - 21 - index * 10,
      size: 8.2,
      font: context.fonts.regular,
      color: COLORS.ink,
    });
  });
  context.y -= height + 12;
}

function collectEventRecords(eventsResponse: Record<string, unknown>): unknown[] {
  return asArray(firstValue(eventsResponse, ["events", "records", "stage_events"]));
}

function collectQualityIssues(readinessResponse: Record<string, unknown>): unknown[] {
  return asArray(firstValue(readinessResponse, ["quality_issues", "issues", "data_quality_issues"]));
}

function collectBottleneckStages(bottleneckResponse: Record<string, unknown>): unknown[] {
  return asArray(firstValue(bottleneckResponse, ["stages", "stage_findings", "findings"]));
}

function drawProjectMetadata(
  context: ReportContext,
  data: StageEvidenceReportData,
  readiness: Record<string, unknown>,
  bottlenecks: Record<string, unknown>,
): void {
  drawSectionTitle(context, "Project & Report Metadata");
  drawKeyValueRow(context, "Project Name", data.projectName);
  drawKeyValueRow(context, "Project Database ID", String(data.projectId));
  drawKeyValueRow(context, "Report Date", todayDisplay());
  drawKeyValueRow(context, "Generated At", formatDateTime(new Date().toISOString()));
  drawKeyValueRow(context, "Readiness Status", formatStatus(firstValue(readiness, ["readiness_status", "status"])));
  drawKeyValueRow(context, "Bottleneck Analysis Status", formatStatus(firstValue(bottlenecks, ["analysis_status", "status"])));
  drawKeyValueRow(context, "Analysis Date", formatDateTime(firstValue(bottlenecks, ["analysis_date", "generated_at"])));
  drawKeyValueRow(context, "Report ID", context.reportId);
  context.y -= 12;
}

function drawEvidenceSummary(
  context: ReportContext,
  events: Record<string, unknown>,
  readiness: Record<string, unknown>,
  bottlenecks: Record<string, unknown>,
): void {
  drawSectionTitle(context, "Stage Evidence Summary");
  ensureSpace(context, 75);

  const eventRecords = collectEventRecords(events);
  const totalEvents = numberValue(firstValue(events, ["total_events", "total_records"]), eventRecords.length);
  const recordedStages = numberValue(firstValue(readiness, ["recorded_stages", "stages_recorded"]), 0);
  const totalFindings = numberValue(firstValue(bottlenecks, ["total_findings", "findings_count"]), 0);
  const readinessStatus = formatStatus(firstValue(readiness, ["readiness_status", "status"]));

  const gap = 8;
  const boxWidth = (CONTENT_WIDTH - gap * 3) / 4;
  const metrics = [
    { label: "STAGE EVENTS", value: String(totalEvents) },
    { label: "RECORDED STAGES", value: String(recordedStages) },
    { label: "BOTTLENECK FINDINGS", value: String(totalFindings) },
    { label: "READINESS", value: readinessStatus },
  ];

  metrics.forEach((metric, index) => {
    drawMetricBox(
      context,
      MARGIN_LEFT + index * (boxWidth + gap),
      boxWidth,
      metric.label,
      metric.value,
    );
  });
  context.y -= 77;
}

function drawRecordedEvents(context: ReportContext, eventsResponse: Record<string, unknown>): void {
  drawSectionTitle(context, "Recorded Stage Events");
  const records = collectEventRecords(eventsResponse);

  if (records.length === 0) {
    drawEmptyState(
      context,
      "No stage events are recorded for this project. This means the available stage-history evidence is insufficient for a record-based stage assessment; it does not prove that no delay exists.",
    );
  } else {
    records.forEach((item, index) => {
      const event = asRecord(item);
      const title = textValue(firstValue(event, ["stage_name", "name", "stage"]), `Stage Event ${index + 1}`);
      ensureSpace(context, 72);
      context.currentPage.drawRectangle({
        x: MARGIN_LEFT,
        y: context.y - 58,
        width: CONTENT_WIDTH,
        height: 58,
        color: index % 2 === 0 ? COLORS.softBlue : COLORS.white,
        borderColor: COLORS.line,
        borderWidth: 0.6,
      });
      context.currentPage.drawText(makePdfTextSafe(title), {
        x: MARGIN_LEFT + 10,
        y: context.y - 16,
        size: 8.7,
        font: context.fonts.bold,
        color: COLORS.navy,
      });

      const status = formatStatus(firstValue(event, ["stage_status", "status"]));
      const progress = textValue(firstValue(event, ["progress_percentage", "progress"]));
      const start = textValue(firstValue(event, ["actual_start_date", "start_date"]));
      const plannedEnd = textValue(firstValue(event, ["planned_end_date", "planned_completion_date"]));
      const completed = textValue(firstValue(event, ["actual_completion_date", "completion_date"]));

      const details = `Status: ${status}   |   Progress: ${progress}${progress !== "Not recorded" ? "%" : ""}   |   Actual start: ${start}`;
      const dates = `Planned end: ${plannedEnd}   |   Actual completion: ${completed}`;
      context.currentPage.drawText(makePdfTextSafe(details), {
        x: MARGIN_LEFT + 10,
        y: context.y - 32,
        size: 7.2,
        font: context.fonts.regular,
        color: COLORS.ink,
      });
      context.currentPage.drawText(makePdfTextSafe(dates), {
        x: MARGIN_LEFT + 10,
        y: context.y - 45,
        size: 7.2,
        font: context.fonts.regular,
        color: COLORS.muted,
      });
      context.y -= 68;

      const notes = firstValue(event, ["notes", "note", "remarks"]);
      if (notes !== undefined && textValue(notes) !== "Not recorded") {
        drawWrappedParagraph(context, `Recorded note: ${textValue(notes)}`, {
          size: 7.6,
          color: COLORS.muted,
          spacingAfter: 6,
        });
      }
    });
  }

  const sourceNote = firstValue(eventsResponse, ["note", "message"]);
  if (sourceNote) {
    drawWrappedParagraph(context, `Source note: ${textValue(sourceNote)}`, {
      size: 7.4,
      color: COLORS.muted,
      spacingAfter: 8,
    });
  }
}

function drawReadiness(context: ReportContext, readiness: Record<string, unknown>): void {
  drawSectionTitle(context, "Stage Data Readiness");
  drawKeyValueRow(context, "Readiness Status", formatStatus(firstValue(readiness, ["readiness_status", "status"])));
  drawKeyValueRow(context, "Total Records", textValue(firstValue(readiness, ["total_records", "record_count"]), "0"));
  drawKeyValueRow(context, "Recorded Stages", textValue(firstValue(readiness, ["recorded_stages", "stage_count"]), "0"));

  const coverage = asRecord(firstValue(readiness, ["date_coverage", "coverage"]));
  if (Object.keys(coverage).length > 0) {
    drawKeyValueRow(context, "Actual Start Date Coverage", textValue(firstValue(coverage, ["actual_start_date", "actual_start"]), "0"));
    drawKeyValueRow(context, "Planned End Date Coverage", textValue(firstValue(coverage, ["planned_end_date", "planned_end"]), "0"));
    drawKeyValueRow(context, "Actual Completion Date Coverage", textValue(firstValue(coverage, ["actual_completion_date", "actual_completion"]), "0"));
  }

  const issues = collectQualityIssues(readiness);
  if (issues.length === 0) {
    drawWrappedParagraph(context, "No explicit data-quality issue entries were returned by the readiness API.", {
      size: 7.7,
      color: COLORS.muted,
    });
  } else {
    drawWrappedParagraph(context, "Recorded data-quality issues:", { bold: true, size: 8.2, spacingAfter: 5 });
    issues.forEach((issue) => drawBullet(context, textValue(issue)));
  }

  const sourceNote = firstValue(readiness, ["note", "message"]);
  if (sourceNote) {
    drawWrappedParagraph(context, `Source note: ${textValue(sourceNote)}`, {
      size: 7.4,
      color: COLORS.muted,
      spacingAfter: 8,
    });
  }
}

function drawBottleneckAnalysis(context: ReportContext, bottlenecks: Record<string, unknown>): void {
  drawSectionTitle(context, "Rules-based Bottleneck Analysis");
  drawKeyValueRow(context, "Analysis Status", formatStatus(firstValue(bottlenecks, ["analysis_status", "status"])));
  drawKeyValueRow(context, "Total Stage Records", textValue(firstValue(bottlenecks, ["total_stage_records", "total_records"]), "0"));
  drawKeyValueRow(context, "Stages Analysed", textValue(firstValue(bottlenecks, ["stages_analyzed", "stages_analysed"]), "0"));
  drawKeyValueRow(context, "Stages With Findings", textValue(firstValue(bottlenecks, ["stages_with_findings"]), "0"));
  drawKeyValueRow(context, "Total Findings", textValue(firstValue(bottlenecks, ["total_findings", "findings_count"]), "0"));

  const stages = collectBottleneckStages(bottlenecks);
  if (stages.length === 0) {
    drawEmptyState(
      context,
      "No stage-level bottleneck findings are available from the current recorded stage history. If stage records are missing, the appropriate interpretation is insufficient evidence rather than no bottleneck.",
    );
  } else {
    drawWrappedParagraph(context, "Stage-level findings returned by the rules-based analysis:", {
      bold: true,
      size: 8.2,
      spacingAfter: 5,
    });

    stages.forEach((item, index) => {
      if (typeof item === "string" || typeof item === "number") {
        drawBullet(context, textValue(item));
        return;
      }

      const stage = asRecord(item);
      const stageName = textValue(firstValue(stage, ["stage_name", "name", "stage"]), `Stage ${index + 1}`);
      const status = firstValue(stage, ["status", "finding_status", "severity"]);
      const findings = asArray(firstValue(stage, ["findings", "issues", "bottlenecks"]));
      const summary = firstValue(stage, ["summary", "message", "note"]);

      drawBullet(
        context,
        `${stageName}${status !== undefined ? ` - ${formatStatus(status)}` : ""}${summary !== undefined ? `: ${textValue(summary)}` : ""}`,
      );
      findings.forEach((finding) => drawBullet(context, `  ${textValue(finding)}`));
    });
  }

  const sourceNote = firstValue(bottlenecks, ["note", "message"]);
  if (sourceNote) {
    drawWrappedParagraph(context, `Source note: ${textValue(sourceNote)}`, {
      size: 7.4,
      color: COLORS.muted,
      spacingAfter: 8,
    });
  }
}

function drawLimitations(context: ReportContext): void {
  drawSectionTitle(context, "Limitations & Provenance");
  drawBullet(context, "The stage-events, readiness and bottleneck results are fetched through separate API requests and are not a transactionally consistent snapshot.");
  drawBullet(context, "Stage records may be manually entered and are not independently verified by AcquiTwin AI.");
  drawBullet(context, "This report contains no project-delay ML prediction or verified operational forecast unless separately supplied in another AcquiTwin report.");
  drawBullet(context, "Missing stage records mean insufficient evidence, not proof that no delays or bottlenecks exist.");
  drawBullet(context, "Project-sensitive information should be handled only by authorised users and should not be distributed without appropriate permission.");
}

function drawPrototypeDisclaimer(context: ReportContext): void {
  drawNoticeBox(
    context,
    "PROTOTYPE & EVIDENCE DISCLAIMER",
    "This AcquiTwin AI Stage Evidence Report summarises recorded stage events, data-readiness checks and rules-based bottleneck findings returned by the prototype. It is intended for SIH demonstration and research use and is not an official Government of India or Ministry of Rural Development document. Stage evidence should be verified against authorised project records before operational, legal, compensation or administrative decisions are taken.",
  );
}

function triggerBrowserDownload(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function downloadStageEvidenceReportPdf(
  rawData: StageEvidenceReportData,
): Promise<void> {
  const data = sanitizePdfValue(rawData);
  const events = asRecord(data.events);
  const readiness = asRecord(data.readiness);
  const bottlenecks = asRecord(data.bottlenecks);

  const pdf = await PDFDocument.create();
  pdf.setTitle(`AcquiTwin AI Stage Evidence Report - Project ${data.projectId}`);
  pdf.setSubject("Land acquisition stage record, readiness and bottleneck evidence assessment");
  pdf.setAuthor("AcquiTwin AI - Student / Research Prototype");
  pdf.setCreator("AcquiTwin AI");

  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const emblem = await loadHeaderEmblem(pdf);

  const firstPage = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const reportId = `ACQUITWIN/STAGE/${data.projectId}/${reportTimestampId()}`;
  const context: ReportContext = {
    pdf,
    fonts: { regular, bold },
    pages: [firstPage],
    currentPage: firstPage,
    y: HEADER_BOTTOM,
    reportId,
    emblem,
  };

  drawHeader(firstPage, context.fonts, context.emblem);
  context.y -= 8;
  drawWrappedParagraph(
    context,
    "Prepared from the latest recorded stage-event, readiness and bottleneck API responses available at export time.",
    { size: 8, color: COLORS.muted, spacingAfter: 14 },
  );

  drawProjectMetadata(context, data, readiness, bottlenecks);
  drawPrototypeDisclaimer(context);
  drawEvidenceSummary(context, events, readiness, bottlenecks);
  drawRecordedEvents(context, events);
  drawReadiness(context, readiness);
  drawBottleneckAnalysis(context, bottlenecks);
  drawLimitations(context);

  const totalPages = context.pages.length;
  context.pages.forEach((page, index) => {
    drawFooter(page, context.fonts, reportId, index + 1, totalPages);
  });

  const bytes = await pdf.save();
  const safeId = sanitizeFilename(String(data.projectId));
  triggerBrowserDownload(bytes, `AcquiTwin_Stage_Evidence_Report_Project_${safeId}.pdf`);
}
