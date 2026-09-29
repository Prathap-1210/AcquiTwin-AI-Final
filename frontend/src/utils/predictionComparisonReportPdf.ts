import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";

// ============================================================
// ACQUITWIN AI — PREDICTION COMPARISON REPORT PDF
// Uses the same report family as predictionReportPdf.ts and
// stageEvidenceReportPdf.ts while remaining a non-official
// student / research prototype report.
// ============================================================

export type ComparisonChangeType =
  | "Numerical"
  | "Categorical"
  | "Added"
  | "Removed";

export interface PredictionComparisonInputChange {
  feature: string;
  previous: unknown;
  latest: unknown;
  category: ComparisonChangeType;
  difference: number | null;
}

export interface PredictionComparisonRecord {
  predictionId: number;
  timestamp: string | null;
  modelVersion: string | null;
  riskScore: number | null;
  riskLevel: string | null;
  delayProbability: number | null;
  predictedDelayDays: number | null;
}

export interface PredictionComparisonReportData {
  projectName: string;
  earlier: PredictionComparisonRecord;
  later: PredictionComparisonRecord;
  outputDifferences: {
    riskScore: number;
    probability: number;
    delayDays: number;
  } | null;
  inputChanges: PredictionComparisonInputChange[];
  snapshotsAvailable: boolean;
  sameModel: boolean;
  validOutputs: boolean;
  recordsRetrieved: number;
  apiReportedTotal: number;
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
  if (typeof value === "string") return makePdfTextSafe(value) as T;
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

function textOrUnavailable(value: unknown): string {
  if (value === null || value === undefined) return "Not recorded";
  const text = String(value).trim();
  return text || "Not recorded";
}

function printable(value: unknown): string {
  if (value === undefined) return "Not present";
  if (value === null) return "Not recorded";
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "Invalid number";
  }
  if (typeof value === "string") return value || "(empty string)";
  try {
    return JSON.stringify(value) ?? "Unavailable";
  } catch {
    return "Unavailable";
  }
}

function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return "Not recorded";
  }
  return Number(value).toLocaleString("en-IN", { maximumFractionDigits: digits });
}

function formatProbability(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return "Not recorded";
  }
  const numeric = Number(value);
  const percentage = numeric >= 0 && numeric <= 1 ? numeric * 100 : numeric;
  return `${percentage.toFixed(2)}%`;
}

function signed(value: number, digits = 2): string {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${Number(value).toLocaleString("en-IN", {
    maximumFractionDigits: digits,
  })}`;
}

function formatTimestamp(value: string | null | undefined): string {
  return value ? value.replace("T", " ").slice(0, 19) : "Not recorded";
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

function humanizeFeature(feature: string): string {
  return feature
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
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
  page.drawRectangle({
    x: 0,
    y: PAGE_HEIGHT - 8,
    width: PAGE_WIDTH,
    height: 3,
    color: COLORS.saffron,
  });
  page.drawRectangle({
    x: 0,
    y: PAGE_HEIGHT - 13,
    width: PAGE_WIDTH,
    height: 3,
    color: COLORS.green,
  });
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
      // Try the next source.
    }
  }
  return null;
}

function drawHeader(page: PDFPage, fonts: Fonts, emblem: PDFImage | null): void {
  drawTricolourBand(page);

  const leftX = MARGIN_LEFT;
  const topY = PAGE_HEIGHT - 44;

  if (emblem) {
    page.drawImage(emblem, {
      x: leftX,
      y: PAGE_HEIGHT - 118,
      width: 42,
      height: 56,
    });
  }

  const textStartX = leftX + 54;
  page.drawText("GOVERNMENT OF INDIA", {
    x: textStartX,
    y: topY,
    size: 8.5,
    font: fonts.bold,
    color: COLORS.navy,
  });
  page.drawText("MINISTRY OF RURAL DEVELOPMENT", {
    x: textStartX,
    y: topY - 13,
    size: 10.5,
    font: fonts.bold,
    color: COLORS.navy,
  });
  page.drawText(
    "LAND ACQUISITION & RURAL INFRASTRUCTURE DEVELOPMENT PROJECTS",
    {
      x: textStartX,
      y: topY - 28,
      size: 8.4,
      font: fonts.bold,
      color: COLORS.ink,
    },
  );
  page.drawText("Project Monitoring and Assessment Series", {
    x: textStartX,
    y: topY - 41,
    size: 7.4,
    font: fonts.regular,
    color: COLORS.muted,
  });

  const badgeWidth = 165;
  const badgeHeight = 35;
  const badgeX = PAGE_WIDTH - MARGIN_RIGHT - badgeWidth;
  const badgeY = PAGE_HEIGHT - 82;

  page.drawRectangle({
    x: badgeX,
    y: badgeY,
    width: badgeWidth,
    height: badgeHeight,
    borderColor: COLORS.navy,
    borderWidth: 1,
    color: COLORS.white,
  });
  page.drawText("ACQUITWIN AI", {
    x: badgeX + 10,
    y: badgeY + 21,
    size: 8.2,
    font: fonts.bold,
    color: COLORS.navy,
  });
  page.drawText("STUDENT / RESEARCH PROTOTYPE - NOT OFFICIAL", {
    x: badgeX + 10,
    y: badgeY + 10,
    size: 5.5,
    font: fonts.bold,
    color: COLORS.muted,
  });

  page.drawRectangle({
    x: MARGIN_LEFT,
    y: PAGE_HEIGHT - 132,
    width: CONTENT_WIDTH,
    height: 1.5,
    color: COLORS.saffron,
  });
  page.drawRectangle({
    x: MARGIN_LEFT,
    y: PAGE_HEIGHT - 136,
    width: CONTENT_WIDTH,
    height: 1.2,
    color: COLORS.green,
  });

  page.drawText("PREDICTION COMPARISON REPORT", {
    x: MARGIN_LEFT,
    y: PAGE_HEIGHT - 158,
    size: 16,
    font: fonts.bold,
    color: COLORS.navy,
  });
  page.drawText("Saved Prediction Change & Input Comparison Assessment", {
    x: MARGIN_LEFT,
    y: PAGE_HEIGHT - 175,
    size: 9,
    font: fonts.regular,
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

  page.drawText(`Report ID: ${reportId}`, {
    x: MARGIN_LEFT,
    y: 36,
    size: 6.6,
    font: fonts.regular,
    color: COLORS.muted,
  });

  const pageText = `Page ${pageNumber} of ${totalPages}`;
  const pageWidth = fonts.bold.widthOfTextAtSize(pageText, 6.8);
  page.drawText(pageText, {
    x: PAGE_WIDTH / 2 - pageWidth / 2,
    y: 36,
    size: 6.8,
    font: fonts.bold,
    color: COLORS.navy,
  });

  const prototypeText = "AcquiTwin AI prototype";
  const prototypeWidth = fonts.regular.widthOfTextAtSize(prototypeText, 6.6);
  page.drawText(prototypeText, {
    x: PAGE_WIDTH - MARGIN_RIGHT - prototypeWidth,
    y: 36,
    size: 6.6,
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

function drawWrappedParagraph(
  context: ReportContext,
  text: string,
  options?: {
    size?: number;
    bold?: boolean;
    color?: ReturnType<typeof rgb>;
    spacingAfter?: number;
    indent?: number;
  },
): void {
  const size = options?.size ?? 8.5;
  const font = options?.bold ? context.fonts.bold : context.fonts.regular;
  const color = options?.color ?? COLORS.ink;
  const spacingAfter = options?.spacingAfter ?? 7;
  const indent = options?.indent ?? 0;
  const lineHeight = size * 1.35;
  const lines = wrapText(text, font, size, CONTENT_WIDTH - indent);

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

function drawKeyValueRow(
  context: ReportContext,
  label: string,
  value: string,
): void {
  const labelWidth = 142;
  const valueLines = wrapText(value, context.fonts.regular, 7.8, CONTENT_WIDTH - labelWidth - 18);
  const rowHeight = Math.max(24, 13 + valueLines.length * 9);
  ensureSpace(context, rowHeight + 2);

  context.currentPage.drawRectangle({
    x: MARGIN_LEFT,
    y: context.y - rowHeight + 6,
    width: CONTENT_WIDTH,
    height: rowHeight,
    color: COLORS.softBlue,
    borderColor: COLORS.line,
    borderWidth: 0.5,
  });
  context.currentPage.drawText(label, {
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
  const height = 55;
  context.currentPage.drawRectangle({
    x,
    y: context.y - height,
    width,
    height,
    color: COLORS.softBlue,
    borderColor: COLORS.line,
    borderWidth: 0.7,
  });
  context.currentPage.drawText(label, {
    x: x + 10,
    y: context.y - 17,
    size: 6.7,
    font: context.fonts.bold,
    color: COLORS.muted,
  });
  const valueLines = wrapText(value, context.fonts.bold, 11, width - 20).slice(0, 2);
  valueLines.forEach((line, index) => {
    context.currentPage.drawText(line, {
      x: x + 10,
      y: context.y - 36 - index * 11,
      size: 11,
      font: context.fonts.bold,
      color: COLORS.navy,
    });
  });
}

function drawBullet(context: ReportContext, text: string): void {
  const size = 8.3;
  const lineHeight = 11.2;
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

function drawPrototypeDisclaimer(context: ReportContext): void {
  const disclaimer =
    "This AcquiTwin AI report compares two saved prediction records and their stored input snapshots. Differences are descriptive only and do not establish causation, intervention effectiveness, or verified project outcomes. This is an SIH student/research prototype report and is not an official Government of India or Ministry of Rural Development document.";
  const lines = wrapText(disclaimer, context.fonts.regular, 7.3, CONTENT_WIDTH - 24);
  const boxHeight = Math.max(68, 36 + lines.length * 8.5);
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
  context.currentPage.drawText("PROTOTYPE & COMPARISON DISCLAIMER", {
    x: MARGIN_LEFT + 12,
    y: context.y - 17,
    size: 8,
    font: context.fonts.bold,
    color: COLORS.navy,
  });
  lines.forEach((line, index) => {
    context.currentPage.drawText(line, {
      x: MARGIN_LEFT + 12,
      y: context.y - 32 - index * 8.5,
      size: 7.3,
      font: context.fonts.regular,
      color: COLORS.ink,
    });
  });
  context.y -= boxHeight + 18;
}

function drawComparisonRecord(
  context: ReportContext,
  heading: string,
  record: PredictionComparisonRecord,
): void {
  drawSectionTitle(context, heading);
  drawKeyValueRow(context, "Prediction ID", `#${record.predictionId}`);
  drawKeyValueRow(context, "Prediction Timestamp", formatTimestamp(record.timestamp));
  drawKeyValueRow(context, "Model Version", textOrUnavailable(record.modelVersion));
  drawKeyValueRow(context, "Risk Score", `${formatNumber(record.riskScore)} / 100`);
  drawKeyValueRow(context, "Risk Level", textOrUnavailable(record.riskLevel));
  drawKeyValueRow(context, "Delay Probability", formatProbability(record.delayProbability));
  drawKeyValueRow(
    context,
    "Predicted Delay",
    record.predictedDelayDays === null
      ? "Not recorded"
      : `${formatNumber(record.predictedDelayDays, 0)} days`,
  );
  context.y -= 10;
}

function drawOutputDifferences(
  context: ReportContext,
  data: PredictionComparisonReportData,
): void {
  drawSectionTitle(context, "Changes in Model Outputs");

  if (!data.outputDifferences) {
    const reason = !data.sameModel
      ? "Numerical differences are not calculated because the two saved predictions use different model versions."
      : !data.validOutputs
        ? "Numerical differences are not calculated because one or more saved output values are invalid or unavailable."
        : "Numerical output differences are unavailable.";
    drawWrappedParagraph(context, reason);
    return;
  }

  ensureSpace(context, 72);
  const gap = 8;
  const width = (CONTENT_WIDTH - gap * 2) / 3;
  const metrics = [
    { label: "RISK SCORE CHANGE", value: `${signed(data.outputDifferences.riskScore)} points` },
    {
      label: "PROBABILITY CHANGE",
      value: `${signed(data.outputDifferences.probability)} pp`,
    },
    { label: "DELAY CHANGE", value: `${signed(data.outputDifferences.delayDays)} days` },
  ];
  metrics.forEach((metric, index) => {
    drawMetricBox(context, MARGIN_LEFT + index * (width + gap), width, metric.label, metric.value);
  });
  context.y -= 73;
}

function drawInputChanges(
  context: ReportContext,
  data: PredictionComparisonReportData,
): void {
  drawSectionTitle(context, "Changes in Saved Input Features");

  if (!data.snapshotsAvailable) {
    drawWrappedParagraph(
      context,
      "Both saved input snapshots are required for input-level comparison. One or both snapshots were unavailable.",
    );
    return;
  }

  if (data.inputChanges.length === 0) {
    drawWrappedParagraph(context, "No input changes were detected between the two saved snapshots.", {
      bold: true,
      color: COLORS.green,
    });
    return;
  }

  for (const change of data.inputChanges) {
    const delta =
      change.difference === null ? "" : `; numerical difference ${signed(change.difference, 4)}`;
    drawBullet(
      context,
      `${humanizeFeature(change.feature)} [${change.category}]: ${printable(
        change.previous,
      )} -> ${printable(change.latest)}${delta}.`,
    );
  }

  drawWrappedParagraph(
    context,
    "Input differences are descriptive only. They do not establish causal responsibility for any observed model-output difference.",
    { size: 7.5, color: COLORS.muted },
  );
}

function drawCoverageAndLimitations(
  context: ReportContext,
  data: PredictionComparisonReportData,
): void {
  drawSectionTitle(context, "Coverage, Interpretation & Limitations");
  drawBullet(
    context,
    `Prediction records retrieved for the current project: ${data.recordsRetrieved}; API reported total: ${data.apiReportedTotal}.`,
  );
  drawBullet(
    context,
    "The two records are ordered by prediction ID for comparison. Prediction-ID order does not independently verify real-world event chronology.",
  );
  drawBullet(
    context,
    "Prototype model outputs are decision-support estimates and are not verified land-acquisition outcomes.",
  );
  drawBullet(
    context,
    "Input changes and output changes do not establish causation or prove intervention effectiveness.",
  );
  drawBullet(
    context,
    "Results may not be directly comparable when model versions differ.",
  );
  drawBullet(
    context,
    "Generating or downloading this report does not modify saved project or prediction records.",
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

export async function downloadPredictionComparisonReportPdf(
  rawData: PredictionComparisonReportData,
): Promise<void> {
  const data = sanitizePdfValue(rawData);

  const pdf = await PDFDocument.create();
  pdf.setTitle(
    `AcquiTwin AI Prediction Comparison - ${data.earlier.predictionId} vs ${data.later.predictionId}`,
  );
  pdf.setSubject("Saved land-acquisition prediction comparison assessment");
  pdf.setAuthor("AcquiTwin AI - Student / Research Prototype");
  pdf.setCreator("AcquiTwin AI");

  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const emblem = await loadHeaderEmblem(pdf);

  const firstPage = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const reportId = `ACQUITWIN/COMPARE/${data.earlier.predictionId}-${data.later.predictionId}/${reportTimestampId()}`;

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

  context.currentPage.drawText(
    "Prepared for comparison of saved model outputs and their stored input snapshots.",
    {
      x: MARGIN_LEFT,
      y: context.y - 8,
      size: 8,
      font: context.fonts.regular,
      color: COLORS.muted,
    },
  );
  context.y -= 30;

  drawSectionTitle(context, "Project & Report Metadata");
  drawKeyValueRow(context, "Project Name", textOrUnavailable(data.projectName));
  drawKeyValueRow(
    context,
    "Compared Predictions",
    `#${data.earlier.predictionId} vs #${data.later.predictionId}`,
  );
  drawKeyValueRow(context, "Report Date", todayDisplay());
  drawKeyValueRow(context, "Report ID", reportId);
  context.y -= 12;

  drawPrototypeDisclaimer(context);
  drawComparisonRecord(context, "Earlier Saved Prediction", data.earlier);
  drawComparisonRecord(context, "Later Saved Prediction", data.later);
  drawOutputDifferences(context, data);
  drawInputChanges(context, data);
  drawCoverageAndLimitations(context, data);

  const totalPages = context.pages.length;
  context.pages.forEach((page, index) => {
    drawFooter(page, context.fonts, reportId, index + 1, totalPages);
  });

  const bytes = await pdf.save();
  const safeProject = sanitizeFilename(data.projectName).slice(0, 60) || "Project";
  triggerBrowserDownload(
    bytes,
    `AcquiTwin_Prediction_Comparison_${safeProject}_P${data.earlier.predictionId}_vs_P${data.later.predictionId}.pdf`,
  );
}
