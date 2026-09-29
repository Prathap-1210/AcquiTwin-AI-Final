import io
import importlib
import re
from typing import Any

import fitz

from PIL import Image


try:
    pytesseract: Any = importlib.import_module("pytesseract")
except ImportError:
    pytesseract = None


def _ocr_image(image: Image.Image) -> str:
    if pytesseract is None:
        raise RuntimeError(
            "OCR requires the optional 'pytesseract' package."
        )

    return pytesseract.image_to_string(
        image,
        lang="eng",
    )


# ============================================================
# OCR CONFIGURATION
# ============================================================

# If Windows cannot find tesseract automatically,
# uncomment this line and adjust the path if required.
#
# pytesseract.pytesseract.tesseract_cmd = (
#     r"C:\Program Files\Tesseract-OCR\tesseract.exe"
# )


# ============================================================
# MAIN TEXT EXTRACTION
# ============================================================

def extract_text_from_file(
    file_bytes: bytes,
    extension: str,
) -> tuple[str, str]:
    """
    Returns:
        extracted_text
        extraction_method

    extraction_method can be:
        PDF_TEXT
        OCR_PDF
        OCR_IMAGE
        TEXT_FILE
    """

    extension = extension.lower()

    if extension == ".pdf":
        return extract_pdf_text_with_ocr_fallback(
            file_bytes
        )

    if extension in {
        ".jpg",
        ".jpeg",
        ".png",
    }:
        text = extract_image_text(
            file_bytes
        )

        return text, "OCR_IMAGE"

    if extension == ".txt":
        text = file_bytes.decode(
            "utf-8",
            errors="ignore",
        ).strip()

        return text, "TEXT_FILE"

    raise ValueError(
        f"Unsupported file extension: {extension}"
    )


# ============================================================
# PDF EXTRACTION
# ============================================================

def extract_pdf_text_with_ocr_fallback(
    file_bytes: bytes,
) -> tuple[str, str]:

    document = fitz.open(
        stream=file_bytes,
        filetype="pdf",
    )

    normal_text: list[str] = []

    for page in document:

        page_text = page.get_text(
            "text"
        ).strip()

        if page_text:
            normal_text.append(
                page_text
            )

    joined_text = "\n".join(
        normal_text
    ).strip()

    # --------------------------------------------------------
    # If enough machine-readable text exists,
    # OCR is unnecessary.
    # --------------------------------------------------------

    if len(joined_text) >= 50:

        document.close()

        return (
            joined_text,
            "PDF_TEXT",
        )

    # --------------------------------------------------------
    # OCR FALLBACK
    # --------------------------------------------------------

    ocr_pages: list[str] = []

    for page in document:

        pixmap = page.get_pixmap(
            matrix=fitz.Matrix(
                2.0,
                2.0,
            ),
            alpha=False,
        )

        image_bytes = (
            pixmap.tobytes("png")
        )

        image = Image.open(
            io.BytesIO(
                image_bytes
            )
        )

        page_text = _ocr_image(image)

        if page_text.strip():
            ocr_pages.append(
                page_text.strip()
            )

    document.close()

    return (
        "\n".join(
            ocr_pages
        ).strip(),
        "OCR_PDF",
    )


# ============================================================
# IMAGE OCR
# ============================================================

def extract_image_text(
    file_bytes: bytes,
) -> str:

    image = Image.open(
        io.BytesIO(
            file_bytes
        )
    )

    image = image.convert(
        "RGB"
    )

    text = _ocr_image(image)

    return text.strip()


# ============================================================
# DOCUMENT ANALYSIS
# ============================================================

def analyse_document(
    text: str,
    file_name: str,
    extraction_method: str,
) -> dict[str, Any]:

    cleaned_text = clean_text(
        text
    )

    # --------------------------------------------------------
    # Insufficient information
    # --------------------------------------------------------

    if len(cleaned_text) < 30:

        return {
            "document_type": (
                detect_document_type(
                    cleaned_text,
                    file_name,
                )
            ),

            "processing_status":
                "INSUFFICIENT_INFORMATION",

            "extracted_data": {
                "extraction_method":
                    extraction_method,

                "text_length":
                    len(cleaned_text),
            },

            "risk_signals": {
                "readiness_score": 0,

                "risk_level":
                    "UNKNOWN",

                "missing_fields": [],

                "detected_risks": [],

                "signals": [
                    (
                        "The system could not "
                        "extract enough readable "
                        "information from the "
                        "document."
                    )
                ],
            },
        }

    document_type = (
        detect_document_type(
            cleaned_text,
            file_name,
        )
    )

    extracted_data = (
        extract_entities(
            cleaned_text
        )
    )

    extracted_data[
        "extraction_method"
    ] = extraction_method

    extracted_data[
        "text_length"
    ] = len(
        cleaned_text
    )

    validation = (
        validate_document(
            document_type=
                document_type,

            extracted_data=
                extracted_data,

            text=
                cleaned_text,
        )
    )

    return {
        "document_type":
            document_type,

        "processing_status":
            "COMPLETED",

        "extracted_data":
            extracted_data,

        "risk_signals":
            validation,
    }


# ============================================================
# TEXT CLEANING
# ============================================================

def clean_text(
    text: str,
) -> str:

    text = text.replace(
        "\x00",
        " ",
    )

    text = re.sub(
        r"[ \t]+",
        " ",
        text,
    )

    text = re.sub(
        r"\n{3,}",
        "\n\n",
        text,
    )

    return text.strip()


# ============================================================
# DOCUMENT TYPE CLASSIFICATION
# ============================================================

def detect_document_type(
    text: str,
    file_name: str,
) -> str:

    combined = (
        f"{file_name} {text}"
        .lower()
    )

    categories = {

        "COMPENSATION": [
            "compensation",
            "award amount",
            "award notice",
            "compensation amount",
            "payment",
            "beneficiary",
        ],

        "SURVEY": [
            "survey number",
            "survey no",
            "survey no.",
            "resurvey",
            "extent of land",
            "land survey",
        ],

        "OWNERSHIP": [
            "patta",
            "owner name",
            "ownership",
            "title deed",
            "land owner",
            "revenue record",
        ],

        "LEGAL": [
            "court",
            "petition",
            "case number",
            "case no",
            "writ petition",
            "litigation",
            "judgment",
        ],

        "NOTIFICATION_APPROVAL": [
            "notification",
            "gazette",
            "approval",
            "competent authority",
            "section 3a",
            "section 3d",
        ],
    }

    scores = {}

    for (
        category,
        keywords,
    ) in categories.items():

        scores[
            category
        ] = sum(

            1

            for keyword in keywords

            if keyword
            in combined
        )

    best_category = max(
        scores,
        key=scores.get,
    )

    if (
        scores[
            best_category
        ]
        == 0
    ):
        return "UNKNOWN"

    return best_category


# ============================================================
# REGEX HELPER
# ============================================================

def first_match(
    patterns: list[str],
    text: str,
) -> str | None:

    for pattern in patterns:

        match = re.search(
            pattern,
            text,
            flags=re.IGNORECASE,
        )

        if match:

            value = (
                match
                .group(1)
                .strip()
            )

            value = re.sub(
                r"\s+",
                " ",
                value,
            )

            return value[:250]

    return None


# ============================================================
# ENTITY EXTRACTION
# ============================================================

def extract_entities(
    text: str,
) -> dict[str, Any]:

    survey_number = first_match(
        [
            (
                r"(?:survey\s*"
                r"(?:no\.?|number)"
                r"|s\.?\s*no\.?)"
                r"\s*[:\-]?\s*"
                r"([A-Za-z0-9\/\-.]+)"
            )
        ],
        text,
    )

    village = first_match(
        [
            (
                r"village\s*[:\-]\s*"
                r"([^\n,;]+)"
            )
        ],
        text,
    )

    district = first_match(
        [
            (
                r"district\s*[:\-]\s*"
                r"([^\n,;]+)"
            )
        ],
        text,
    )

    owner_name = first_match(
        [
            (
                r"(?:owner(?:'s)?\s*name"
                r"|land\s*owner"
                r"|name\s*of\s*owner)"
                r"\s*[:\-]\s*"
                r"([^\n,;]+)"
            )
        ],
        text,
    )

    compensation_amount = (
        first_match(
            [
                (
                    r"(?:compensation\s*"
                    r"amount"
                    r"|award\s*amount)"
                    r"\s*[:\-]?\s*"
                    r"(?:rs\.?|₹)?\s*"
                    r"([\d,]+"
                    r"(?:\.\d{1,2})?)"
                )
            ],
            text,
        )
    )

    case_number = first_match(
        [
            (
                r"(?:case\s*"
                r"(?:no\.?|number)"
                r"|w\.?p\.?\s*"
                r"(?:no\.?)?)"
                r"\s*[:\-]?\s*"
                r"([A-Za-z0-9\/\-.]+)"
            )
        ],
        text,
    )

    land_area = first_match(
        [
            (
                r"(?:land\s*area"
                r"|extent"
                r"(?:\s*of\s*land)?)"
                r"\s*[:\-]?\s*"
                r"([\d.]+\s*"
                r"(?:hectares?"
                r"|ha"
                r"|acres?"
                r"|sq\.?\s*m)?)"
            )
        ],
        text,
    )

    return {
        "survey_number":
            survey_number,

        "village":
            village,

        "district":
            district,

        "owner_name":
            owner_name,

        "land_area":
            land_area,

        "compensation_amount":
            compensation_amount,

        "case_number":
            case_number,
    }


# ============================================================
# DOCUMENT VALIDATION
# ============================================================

def validate_document(
    document_type: str,
    extracted_data: dict[str, Any],
    text: str,
) -> dict[str, Any]:

    requirements = {

        "SURVEY": [
            "survey_number",
            "village",
            "land_area",
        ],

        "OWNERSHIP": [
            "survey_number",
            "owner_name",
            "village",
        ],

        "COMPENSATION": [
            "survey_number",
            "owner_name",
            "compensation_amount",
        ],

        "LEGAL": [
            "case_number",
        ],

        "NOTIFICATION_APPROVAL": [
            "district",
        ],
    }

    required_fields = (
        requirements.get(
            document_type,
            [],
        )
    )

    missing_fields = [

        field

        for field
        in required_fields

        if not extracted_data.get(
            field
        )
    ]

    if required_fields:

        found = (
            len(required_fields)
            - len(
                missing_fields
            )
        )

        readiness_score = round(
            (
                found
                / len(
                    required_fields
                )
            )
            * 100,
            2,
        )

    else:

        readiness_score = 50.0

    lower_text = text.lower()

    signals = []

    detected_risks = []

    risk_keywords = {

        "compensation_pending": [
            "compensation pending",
            "payment pending",
            "unpaid compensation",
        ],

        "ownership_dispute": [
            "ownership dispute",
            "title dispute",
            "disputed ownership",
        ],

        "legal_case": [
            "court case",
            "litigation",
            "writ petition",
        ],

        "approval_pending": [
            "approval pending",
            "pending approval",
        ],
    }

    for (
        signal_name,
        keywords,
    ) in risk_keywords.items():

        if any(
            keyword in lower_text
            for keyword
            in keywords
        ):

            detected_risks.append(
                signal_name
            )

    if missing_fields:

        signals.append(
            (
                "Important fields are "
                "missing or could not "
                "be extracted."
            )
        )

    if detected_risks:

        signals.append(
            (
                "Potential land-acquisition "
                "risk language was found "
                "in the document."
            )
        )

    if readiness_score >= 80:

        risk_level = "LOW"

    elif readiness_score >= 50:

        risk_level = "MEDIUM"

    else:

        risk_level = "HIGH"

    if len(
        detected_risks
    ) >= 2:

        risk_level = "HIGH"

    elif (
        detected_risks
        and risk_level == "LOW"
    ):

        risk_level = "MEDIUM"

    return {
        "readiness_score":
            readiness_score,

        "risk_level":
            risk_level,

        "missing_fields":
            missing_fields,

        "detected_risks":
            detected_risks,

        "signals":
            signals,
    }