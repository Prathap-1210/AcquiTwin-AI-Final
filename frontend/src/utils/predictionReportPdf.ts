import {

  PDFDocument,

  StandardFonts,

  rgb,

  type PDFFont,

  type PDFImage,

  type PDFPage,

} from "pdf-lib";



// ============================================================

// ACQUITWIN AI — PREDICTION REPORT PDF

// Student / research prototype report builder.

// This file is intentionally separate from pdfReport.ts so the

// existing jsPDF reports remain unchanged.

// ============================================================



export interface PredictionReportRiskFactor {

  rank: number;

  feature: string;

  value: string | number | null;

  contribution: number;

  direction?: string | null;

}



export interface PredictionReportData {

  projectDatabaseId: number;

  projectId: string;

  projectName: string;



  district: string | null;

  state: string | null;

  currentStage: string | null;

  implementingAgency: string | null;



  predictionId: number;

  riskScore: number | null;

  riskLevel: string | null;

  delayProbability: number | null;

  expectedDelayDays: number | null;

  modelVersion: string | null;

  predictionTimestamp: string | null;



  riskFactors: PredictionReportRiskFactor[];

  inputSnapshot: Record<string, unknown> | null;

}



/**

 * pdf-lib standard Helvetica uses WinAnsi encoding.

 * Convert unsupported Unicode characters into safe report text so

 * PDF generation never crashes.

 *

 * Later, when a Unicode font is bundled, this can be removed.

 */

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



    for (const [key, item] of Object.entries(

      value as Record<string, unknown>,

    )) {

      result[key] = sanitizePdfValue(item);

    }



    return result as T;

  }



  return value;

}



// ============================================================

// PAGE CONSTANTS

// ============================================================



const PAGE_WIDTH = 595.28;

const PAGE_HEIGHT = 841.89;



const MARGIN_LEFT = 42;

const MARGIN_RIGHT = 42;



const CONTENT_WIDTH =

  PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;



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



  white: rgb(1, 1, 1),

};



// ============================================================

// INTERNAL TYPES

// ============================================================



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



  data: PredictionReportData;

  reportId: string;



  emblem: PDFImage | null;

}



// ============================================================

// BASIC FORMATTERS

// ============================================================



function textOrUnavailable(

  value: string | number | null | undefined,

): string {

  if (

    value === null ||

    value === undefined ||

    String(value).trim() === ""

  ) {

    return "Not recorded";

  }



  return String(value);

}



function formatNumber(

  value: number | null | undefined,

  digits = 2,

): string {

  if (

    value === null ||

    value === undefined ||

    !Number.isFinite(Number(value))

  ) {

    return "Not recorded";

  }



  return Number(value).toLocaleString("en-IN", {

    maximumFractionDigits: digits,

  });

}



function formatProbability(

  value: number | null | undefined,

): string {

  if (

    value === null ||

    value === undefined ||

    !Number.isFinite(Number(value))

  ) {

    return "Not recorded";

  }



  const numeric = Number(value);



  // AcquiTwin API stores this normally as a decimal such as 0.76.

  const percentage =

    numeric >= 0 && numeric <= 1

      ? numeric * 100

      : numeric;



  return `${percentage.toFixed(2)}%`;

}



function formatDateTime(

  value: string | null | undefined,

): string {

  if (!value) return "Not recorded";



  // Preserve backend wall-time when timezone information is absent.

  return value.replace("T", " ").slice(0, 19);

}



function todayDisplay(): string {

  return new Intl.DateTimeFormat("en-IN", {

    day: "2-digit",

    month: "short",

    year: "numeric",

  }).format(new Date());

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



// ============================================================

// TEXT WRAPPING

// ============================================================



function wrapText(

  text: string,

  font: PDFFont,

  fontSize: number,

  maxWidth: number,

): string[] {

  const normalized = text.replace(/\s+/g, " ").trim();



  if (!normalized) return [""];



  const words = normalized.split(" ");

  const lines: string[] = [];



  let currentLine = "";



  for (const word of words) {

    const candidate =

      currentLine.length > 0

        ? `${currentLine} ${word}`

        : word;



    const width = font.widthOfTextAtSize(

      candidate,

      fontSize,

    );



    if (width <= maxWidth) {

      currentLine = candidate;

      continue;

    }



    if (currentLine) {

      lines.push(currentLine);

    }



    // Very long unbroken text fallback.

    if (

      font.widthOfTextAtSize(word, fontSize) >

      maxWidth

    ) {

      let fragment = "";



      for (const character of word) {

        const next = fragment + character;



        if (

          font.widthOfTextAtSize(

            next,

            fontSize,

          ) > maxWidth

        ) {

          if (fragment) {

            lines.push(fragment);

          }

          fragment = character;

        } else {

          fragment = next;

        }

      }



      currentLine = fragment;

    } else {

      currentLine = word;

    }

  }



  if (currentLine) {

    lines.push(currentLine);

  }



  return lines;

}



// ============================================================

// HEADER / FOOTER

// ============================================================



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



async function loadHeaderEmblem(
  pdf: PDFDocument,
): Promise<PDFImage | null> {
  const sources = [
    "/emblem_of_india.png",
    "https://upload.wikimedia.org/wikipedia/commons/e/ee/Emblem_of_India_%28Government_Gazette%29.png",
  ];

  for (const source of sources) {
    try {
      const response = await fetch(source);

      if (!response.ok) {
        continue;
      }

      const bytes = await response.arrayBuffer();
      return await pdf.embedPng(bytes);
    } catch {
      // Try the next source.
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
  const width = font.widthOfTextAtSize(text, size);

  page.drawText(text, {
    x: centerX - width / 2,
    y,
    size,
    font,
    color,
  });
}

function drawHeader(
  page: PDFPage,
  fonts: Fonts,
  emblem: PDFImage | null,
): void {
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

    drawCenteredText(
      page,
      "EMBLEM",
      fonts.bold,
      6.2,
      emblemX + emblemWidth / 2,
      emblemY + 29,
      COLORS.navy,
    );

    drawCenteredText(
      page,
      "REFERENCE",
      fonts.regular,
      4.8,
      emblemX + emblemWidth / 2,
      emblemY + 19,
      COLORS.muted,
    );
  }

  const centerLeft = emblemX + emblemWidth + 12;
  const badgeWidth = 118;
  const badgeX = PAGE_WIDTH - MARGIN_RIGHT - badgeWidth;
  const centerRight = badgeX - 10;
  const centerX = centerLeft + (centerRight - centerLeft) / 2;

  drawCenteredText(
    page,
    "GOVERNMENT OF INDIA",
    fonts.bold,
    8.4,
    centerX,
    PAGE_HEIGHT - 49,
    COLORS.navy,
  );

  drawCenteredText(
    page,
    "MINISTRY OF RURAL DEVELOPMENT",
    fonts.bold,
    10.2,
    centerX,
    PAGE_HEIGHT - 63,
    COLORS.navy,
  );

  drawCenteredText(
    page,
    "LAND ACQUISITION & RURAL INFRASTRUCTURE",
    fonts.bold,
    7.1,
    centerX,
    PAGE_HEIGHT - 79,
    COLORS.ink,
  );

  drawCenteredText(
    page,
    "DEVELOPMENT PROJECTS",
    fonts.bold,
    7.1,
    centerX,
    PAGE_HEIGHT - 90,
    COLORS.ink,
  );

  drawCenteredText(
    page,
    "Project Monitoring and Assessment Series",
    fonts.regular,
    6.7,
    centerX,
    PAGE_HEIGHT - 104,
    COLORS.muted,
  );

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

  drawCenteredText(
    page,
    "ACQUITWIN AI",
    fonts.bold,
    7.2,
    badgeX + badgeWidth / 2,
    badgeY + 27,
    COLORS.navy,
  );

  drawCenteredText(
    page,
    "STUDENT / RESEARCH",
    fonts.bold,
    5.8,
    badgeX + badgeWidth / 2,
    badgeY + 16,
    COLORS.ink,
  );

  drawCenteredText(
    page,
    "PROTOTYPE - NOT OFFICIAL",
    fonts.bold,
    5.3,
    badgeX + badgeWidth / 2,
    badgeY + 7,
    COLORS.muted,
  );

  page.drawLine({
    start: {
      x: MARGIN_LEFT,
      y: PAGE_HEIGHT - 129,
    },
    end: {
      x: PAGE_WIDTH - MARGIN_RIGHT,
      y: PAGE_HEIGHT - 129,
    },
    thickness: 0.8,
    color: COLORS.line,
  });

  page.drawRectangle({
    x: MARGIN_LEFT,
    y: PAGE_HEIGHT - 136,
    width: 82,
    height: 2,
    color: COLORS.saffron,
  });

  page.drawRectangle({
    x: MARGIN_LEFT + 82,
    y: PAGE_HEIGHT - 136,
    width: CONTENT_WIDTH - 164,
    height: 2,
    color: COLORS.line,
  });

  page.drawRectangle({
    x: PAGE_WIDTH - MARGIN_RIGHT - 82,
    y: PAGE_HEIGHT - 136,
    width: 82,
    height: 2,
    color: COLORS.green,
  });

  page.drawText("PREDICTIVE ANALYSIS REPORT", {
    x: MARGIN_LEFT,
    y: PAGE_HEIGHT - 158,
    size: 15.5,
    font: fonts.bold,
    color: COLORS.navy,
  });

  page.drawText(
    "Land Acquisition Project Delay Risk Assessment",
    {
      x: MARGIN_LEFT,
      y: PAGE_HEIGHT - 174,
      size: 8.7,
      font: fonts.regular,
      color: COLORS.muted,
    },
  );

  const prototypeNotice =
    "SIH STUDENT / RESEARCH PROTOTYPE - NOT ISSUED BY THE MINISTRY OF RURAL DEVELOPMENT";

  const noticeWidth = fonts.bold.widthOfTextAtSize(
    prototypeNotice,
    5.4,
  );

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

    start: {

      x: MARGIN_LEFT,

      y: FOOTER_TOP,

    },

    end: {

      x: PAGE_WIDTH - MARGIN_RIGHT,

      y: FOOTER_TOP,

    },

    thickness: 0.7,

    color: COLORS.line,

  });



  page.drawText(`Report ID: ${reportId}`, {

    x: MARGIN_LEFT,

    y: 36,

    size: 6.8,

    font: fonts.regular,

    color: COLORS.muted,

  });



  const pageText =

    `Page ${pageNumber} of ${totalPages}`;



  const pageTextWidth =

    fonts.bold.widthOfTextAtSize(

      pageText,

      6.8,

    );



  page.drawText(pageText, {

    x: PAGE_WIDTH / 2 - pageTextWidth / 2,

    y: 36,

    size: 6.8,

    font: fonts.bold,

    color: COLORS.navy,

  });



  const prototypeText =

    "AcquiTwin AI prototype";



  const prototypeWidth =

    fonts.regular.widthOfTextAtSize(

      prototypeText,

      6.8,

    );



  page.drawText(prototypeText, {

    x:

      PAGE_WIDTH -

      MARGIN_RIGHT -

      prototypeWidth,

    y: 36,

    size: 6.8,

    font: fonts.regular,

    color: COLORS.muted,

  });



  const disclaimer =

    "For SIH demonstration and research use. Not issued by or on behalf of the Government of India.";



  const disclaimerWidth =

    fonts.regular.widthOfTextAtSize(

      disclaimer,

      5.7,

    );



  page.drawText(disclaimer, {

    x:

      PAGE_WIDTH / 2 -

      disclaimerWidth / 2,

    y: 22,

    size: 5.7,

    font: fonts.regular,

    color: COLORS.muted,

  });



  page.drawRectangle({

    x: 0,

    y: 7,

    width: PAGE_WIDTH,

    height: 2,

    color: COLORS.saffron,

  });



  page.drawRectangle({

    x: 0,

    y: 3,

    width: PAGE_WIDTH,

    height: 2,

    color: COLORS.green,

  });

}



// ============================================================

// PAGE MANAGEMENT

// ============================================================



function createReportPage(

  context: ReportContext,

): PDFPage {

  const page = context.pdf.addPage([

    PAGE_WIDTH,

    PAGE_HEIGHT,

  ]);



  drawHeader(

    page,

    context.fonts,

    context.emblem,

  );



  context.pages.push(page);

  context.currentPage = page;

  context.y = HEADER_BOTTOM;



  return page;

}



function ensureSpace(

  context: ReportContext,

  requiredHeight: number,

): void {

  if (

    context.y - requiredHeight <

    FOOTER_TOP + 18

  ) {

    createReportPage(context);

  }

}



// ============================================================

// DRAWING HELPERS

// ============================================================



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

  const font = options?.bold

    ? context.fonts.bold

    : context.fonts.regular;



  const color =

    options?.color ?? COLORS.ink;



  const indent = options?.indent ?? 0;



  const lineHeight =

    options?.lineHeight ?? size * 1.35;



  const spacingAfter =

    options?.spacingAfter ?? 7;



  const maxWidth =

    CONTENT_WIDTH - indent;



  const lines = wrapText(

    text,

    font,

    size,

    maxWidth,

  );



  for (const line of lines) {

    ensureSpace(

      context,

      lineHeight + 2,

    );



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



function drawSectionTitle(

  context: ReportContext,

  title: string,

): void {

  ensureSpace(context, 35);



  context.currentPage.drawRectangle({

    x: MARGIN_LEFT,

    y: context.y - 4,

    width: 4,

    height: 18,

    color: COLORS.saffron,

  });



  context.currentPage.drawText(title, {

    x: MARGIN_LEFT + 11,

    y: context.y,

    size: 12,

    font: context.fonts.bold,

    color: COLORS.navy,

  });



  context.y -= 27;

}



function drawKeyValueRow(

  context: ReportContext,

  label: string,

  value: string,

): void {

  const labelWidth = 142;

  const rowHeight = 24;



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



  context.currentPage.drawText(label, {

    x: MARGIN_LEFT + 9,

    y: context.y - 8,

    size: 7.7,

    font: context.fonts.bold,

    color: COLORS.navy,

  });



  const availableWidth =

    CONTENT_WIDTH - labelWidth - 18;



  const valueLines = wrapText(

    value,

    context.fonts.regular,

    7.8,

    availableWidth,

  ).slice(0, 2);



  valueLines.forEach((line, index) => {

    context.currentPage.drawText(line, {

      x: MARGIN_LEFT + labelWidth,

      y:

        context.y -

        8 -

        index * 9,

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



  context.currentPage.drawText(label, {

    x: x + 10,

    y: context.y - 17,

    size: 7,

    font: context.fonts.bold,

    color: COLORS.muted,

  });



  const valueLines = wrapText(

    value,

    context.fonts.bold,

    13,

    width - 20,

  );



  valueLines

    .slice(0, 2)

    .forEach((line, index) => {

      context.currentPage.drawText(line, {

        x: x + 10,

        y:

          context.y -

          37 -

          index * 13,

        size: 13,

        font: context.fonts.bold,

        color: COLORS.navy,

      });

    });

}



function drawBullet(

  context: ReportContext,

  text: string,

): void {

  const size = 8.5;

  const lineHeight = 11.5;

  const indent = 14;



  const lines = wrapText(

    text,

    context.fonts.regular,

    size,

    CONTENT_WIDTH - indent,

  );



  for (

    let index = 0;

    index < lines.length;

    index += 1

  ) {

    ensureSpace(

      context,

      lineHeight + 2,

    );



    if (index === 0) {

      context.currentPage.drawCircle({

        x: MARGIN_LEFT + 3,

        y: context.y + 3,

        size: 1.8,

        color: COLORS.navy,

      });

    }



    context.currentPage.drawText(

      lines[index],

      {

        x: MARGIN_LEFT + indent,

        y: context.y,

        size,

        font: context.fonts.regular,

        color: COLORS.ink,

      },

    );



    context.y -= lineHeight;

  }



  context.y -= 3;

}



// ============================================================

// REPORT SECTIONS

// ============================================================



function drawReportTitle(

  context: ReportContext,

): void {

  context.y -= 8;



  context.currentPage.drawText(

    "Prepared for decision support using saved project and prediction records.",

    {

      x: MARGIN_LEFT,

      y: context.y,

      size: 8,

      font: context.fonts.regular,

      color: COLORS.muted,

    },

  );



  context.y -= 22;

}



function drawProjectMetadata(

  context: ReportContext,

): void {

  drawSectionTitle(

    context,

    "Project & Prediction Metadata",

  );



  drawKeyValueRow(

    context,

    "Project Name",

    textOrUnavailable(

      context.data.projectName,

    ),

  );



  drawKeyValueRow(

    context,

    "Project ID",

    textOrUnavailable(

      context.data.projectId,

    ),

  );



  drawKeyValueRow(

    context,

    "District / State",

    `${textOrUnavailable(

      context.data.district,

    )} / ${textOrUnavailable(

      context.data.state,

    )}`,

  );



  drawKeyValueRow(

    context,

    "Current Stage",

    textOrUnavailable(

      context.data.currentStage,

    ),

  );



  drawKeyValueRow(

    context,

    "Implementing Agency",

    textOrUnavailable(

      context.data.implementingAgency,

    ),

  );



  drawKeyValueRow(

    context,

    "Report Date",

    todayDisplay(),

  );



  drawKeyValueRow(

    context,

    "Prediction Timestamp",

    formatDateTime(

      context.data.predictionTimestamp,

    ),

  );



  drawKeyValueRow(

    context,

    "Model Version",

    textOrUnavailable(

      context.data.modelVersion,

    ),

  );



  drawKeyValueRow(

    context,

    "Report ID",

    context.reportId,

  );



  context.y -= 12;

}



function drawPrototypeDisclaimer(
  context: ReportContext,
): void {
  const disclaimer =
    "This AcquiTwin AI report contains model-based predictions derived from the saved project and prediction records available to the prototype. Values are probabilistic estimates, not statements of fact. This report is intended for SIH demonstration and research use and is not an official Government of India or Ministry of Rural Development document. Land acquisition, compensation, legal, budgetary or alignment decisions require independent verification and authorised review.";

  const lines = wrapText(
    disclaimer,
    context.fonts.regular,
    7.3,
    CONTENT_WIDTH - 24,
  );

  const titleHeight = 23;
  const lineHeight = 8.6;
  const bottomPadding = 11;

  const boxHeight =
    titleHeight +
    lines.length * lineHeight +
    bottomPadding;

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

  context.currentPage.drawText(
    "PROTOTYPE & PREDICTIVE ANALYSIS DISCLAIMER",
    {
      x: MARGIN_LEFT + 12,
      y: context.y - 17,
      size: 8,
      font: context.fonts.bold,
      color: COLORS.navy,
    },
  );

  lines.forEach((line, index) => {
    context.currentPage.drawText(line, {
      x: MARGIN_LEFT + 12,
      y:
        context.y -
        titleHeight -
        9 -
        index * lineHeight,
      size: 7.3,
      font: context.fonts.regular,
      color: COLORS.ink,
    });
  });

  context.y -= boxHeight + 18;
}


function drawRiskSummary(

  context: ReportContext,

): void {

  drawSectionTitle(

    context,

    "Prediction Summary",

  );



  ensureSpace(context, 75);



  const gap = 8;

  const boxWidth =

    (CONTENT_WIDTH - gap * 3) / 4;



  const metrics = [

    {

      label: "RISK SCORE",

      value:

        context.data.riskScore === null

          ? "Not recorded"

          : `${formatNumber(

              context.data.riskScore,

            )} / 100`,

    },

    {

      label: "RISK LEVEL",

      value: textOrUnavailable(

        context.data.riskLevel,

      ),

    },

    {

      label: "DELAY PROBABILITY",

      value: formatProbability(

        context.data.delayProbability,

      ),

    },

    {

      label: "EXPECTED DELAY",

      value:

        context.data.expectedDelayDays ===

        null

          ? "Not recorded"

          : `${formatNumber(

              context.data.expectedDelayDays,

              0,

            )} days`,

    },

  ];



  metrics.forEach((metric, index) => {

    drawMetricBox(

      context,

      MARGIN_LEFT +

        index * (boxWidth + gap),

      boxWidth,

      metric.label,

      metric.value,

    );

  });



  context.y -= 77;

}



function drawPredictionExplanation(

  context: ReportContext,

): void {

  drawSectionTitle(

    context,

    "Prediction Explanation",

  );



  if (

    context.data.riskScore === null ||

    context.data.riskLevel === null

  ) {

    drawWrappedParagraph(

      context,

      "A complete prediction explanation cannot be produced because the saved prediction does not contain all required prediction values.",

    );



    return;

  }



  drawWrappedParagraph(

    context,

    `The saved AcquiTwin prediction assigns this project a risk score of ${formatNumber(

      context.data.riskScore,

    )}/100 with a recorded risk level of ${context.data.riskLevel}. The saved delay probability is ${formatProbability(

      context.data.delayProbability,

    )}, and the stored expected delay estimate is ${

      context.data.expectedDelayDays === null

        ? "not recorded"

        : `${formatNumber(

            context.data.expectedDelayDays,

            0,

          )} days`

    }.`,

  );



  drawWrappedParagraph(

    context,

    "These outputs describe the model's estimate for the saved input snapshot at the prediction timestamp. They do not establish that a delay will occur.",

  );

}



function drawRiskFactors(

  context: ReportContext,

): void {

  drawSectionTitle(

    context,

    "Major Model Risk Factors",

  );



  if (

    context.data.riskFactors.length === 0

  ) {

    drawWrappedParagraph(

      context,

      "No explanation factors were stored with this prediction.",

    );



    return;

  }



  const sorted = [

    ...context.data.riskFactors,

  ].sort(

    (a, b) =>

      a.rank - b.rank,

  );



  for (const factor of sorted) {

    const contributionDirection =

      factor.contribution > 0

        ? "increases model log-odds"

        : factor.contribution < 0

          ? "decreases model log-odds"

          : "has a neutral stored contribution";



    drawBullet(

      context,

      `Rank ${factor.rank}: ${humanizeFeature(

        factor.feature,

      )}. Recorded value: ${textOrUnavailable(

        factor.value,

      )}. Contribution: ${formatNumber(

        factor.contribution,

        4,

      )}; this ${contributionDirection}.`,

    );

  }



  drawWrappedParagraph(

    context,

    "Risk-factor contributions are model explanation values. They are relative to the model reference point and should not be interpreted as probability-percentage-point changes or proof of causality.",

    {

      size: 7.5,

      color: COLORS.muted,

      spacingAfter: 8,

    },

  );

}



function drawDataSources(

  context: ReportContext,

): void {

  drawSectionTitle(

    context,

    "Input & Data Sources",

  );



  drawBullet(

    context,

    `Selected project record from the AcquiTwin project database (database ID ${context.data.projectDatabaseId}, project ID ${context.data.projectId}).`,

  );



  drawBullet(

    context,

    `Saved prediction record #${context.data.predictionId}.`,

  );



  if (context.data.inputSnapshot) {

    drawBullet(

      context,

      "Saved ML input snapshot associated with the prediction.",

    );

  } else {

    drawBullet(

      context,

      "No ML input snapshot was stored with this prediction.",

    );

  }



  if (

    context.data.riskFactors.length > 0

  ) {

    drawBullet(

      context,

      "Saved model explanation / risk-factor records associated with the prediction.",

    );

  } else {

    drawBullet(

      context,

      "No saved risk-factor explanation records were available.",

    );

  }



  drawWrappedParagraph(

    context,

    "No additional external dataset ownership, verification status or as-of date is asserted in this report unless it is explicitly present in the saved AcquiTwin records.",

    {

      size: 7.7,

      color: COLORS.muted,

    },

  );

}



function drawAssumptions(

  context: ReportContext,

): void {

  drawSectionTitle(

    context,

    "Assumptions & Interpretation",

  );



  drawBullet(

    context,

    "The report represents the saved prediction at its recorded timestamp and does not automatically refresh historical prediction values.",

  );



  drawBullet(

    context,

    "The model output depends on the completeness and quality of the input values supplied when the prediction was generated.",

  );



  drawBullet(

    context,

    "A positive explanation contribution indicates an increase in the model's log-odds relative to its reference point; it does not establish causal responsibility.",

  );



  drawBullet(

    context,

    "Missing information is shown as unavailable or not recorded rather than being estimated or randomly generated.",

  );

}



function drawReviewActions(

  context: ReportContext,

): void {

  drawSectionTitle(

    context,

    "Recommended Review & Decision Support",

  );



  const increasingFactors =

    context.data.riskFactors

      .filter(

        (factor) =>

          factor.contribution > 0,

      )

      .sort(

        (a, b) =>

          a.rank - b.rank,

      );



  if (

    increasingFactors.length > 0

  ) {

    const names = increasingFactors

      .slice(0, 5)

      .map((factor) =>

        humanizeFeature(

          factor.feature,

        ),

      )

      .join(", ");



    drawBullet(

      context,

      `Review the evidence and current project status for the model's strongest positive-contribution factors: ${names}.`,

    );

  } else {

    drawBullet(

      context,

      "No positive-contribution risk factors were stored with this prediction; review the complete saved prediction inputs before drawing conclusions.",

    );

  }



  drawBullet(

    context,

    "Use AcquiTwin's What-If and Intervention Scenario tools when quantified scenario comparison is required.",

  );



  drawBullet(

    context,

    "Treat scenario results as decision support and compare their assumptions and trade-offs rather than automatically selecting an intervention.",

  );



  drawBullet(

    context,

    "Verify legal, ownership, compensation, document and field information through authorised project records before operational action.",

  );

}



function drawLimitations(

  context: ReportContext,

): void {

  drawSectionTitle(

    context,

    "Limitations",

  );



  drawBullet(

    context,

    "This is a student/research prototype report and not an official government assessment, sanction, legal opinion or acquisition order.",

  );



  drawBullet(

    context,

    "Predictions can be affected by incomplete, stale or incorrectly entered project data.",

  );



  drawBullet(

    context,

    "The report does not independently verify ownership claims, compensation status, court matters, land records or uploaded documents.",

  );



  drawBullet(

    context,

    "The prediction reflects the model version stored with the selected prediction record and may differ from later model versions.",

  );



  drawBullet(

    context,

    "No intervention impact or alternative-corridor outcome is claimed unless a corresponding AcquiTwin analysis has actually been run and saved.",

  );

}



// ============================================================

// DOWNLOAD

// ============================================================



function triggerBrowserDownload(

  bytes: Uint8Array,

  filename: string,

): void {

  const blob = new Blob(

    [bytes as BlobPart],

    {

      type: "application/pdf",

    },

  );



  const url =

    URL.createObjectURL(blob);



  const anchor =

    document.createElement("a");



  anchor.href = url;

  anchor.download = filename;



  document.body.appendChild(anchor);

  anchor.click();

  anchor.remove();



  URL.revokeObjectURL(url);

}



// ============================================================

// PUBLIC API

// ============================================================



export async function downloadPredictionReportPdf(
  data: PredictionReportData,
): Promise<void> {
  data = sanitizePdfValue(data);

  const pdf = await PDFDocument.create();

  pdf.setTitle(
    `AcquiTwin AI Prediction Report - ${data.projectId}`,
  );

  pdf.setSubject(
    "Land acquisition project delay predictive analysis",
  );

  pdf.setAuthor(
    "AcquiTwin AI - Student / Research Prototype",
  );

  pdf.setCreator("AcquiTwin AI");

  const regular = await pdf.embedFont(
    StandardFonts.Helvetica,
  );

  const bold = await pdf.embedFont(
    StandardFonts.HelveticaBold,
  );

  const emblem = await loadHeaderEmblem(pdf);

  const firstPage = pdf.addPage([
    PAGE_WIDTH,
    PAGE_HEIGHT,
  ]);

  const reportId =
    `ACQUITWIN/PRED/${data.projectId}/${data.predictionId}`;

  const context: ReportContext = {
    pdf,
    fonts: {
      regular,
      bold,
    },
    pages: [firstPage],
    currentPage: firstPage,
    y: HEADER_BOTTOM,
    data,
    reportId,
    emblem,
  };

  drawHeader(
    firstPage,
    context.fonts,
    context.emblem,
  );

  drawReportTitle(context);
  drawProjectMetadata(context);
  drawPrototypeDisclaimer(context);
  drawRiskSummary(context);

  drawPredictionExplanation(
    context,
  );

  drawRiskFactors(context);
  drawDataSources(context);
  drawAssumptions(context);
  drawReviewActions(context);
  drawLimitations(context);

  const totalPages =
    context.pages.length;

  context.pages.forEach(
    (page, index) => {
      drawFooter(
        page,
        context.fonts,
        reportId,
        index + 1,
        totalPages,
      );
    },
  );

  const bytes = await pdf.save();

  const safeProjectId =
    sanitizeFilename(
      data.projectId ||
        String(
          data.projectDatabaseId,
        ),
    );

  triggerBrowserDownload(
    bytes,
    `AcquiTwin_Prediction_Report_${safeProjectId}_P${data.predictionId}.pdf`,
  );
}
