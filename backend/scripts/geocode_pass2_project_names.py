from __future__ import annotations

import csv
import math
import re
import sys
import time
import unicodedata
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Optional

import requests


# ============================================================
# BACKEND IMPORT PATH
# ============================================================

BACKEND_DIR = Path(__file__).resolve().parents[1]

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


from app.database.session import SessionLocal

try:
    from app.model.project import Project
except ImportError:
    from app.model.project import Project


# ============================================================
# CONFIGURATION
# ============================================================

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"

HEADERS = {
    "User-Agent": "AcquiTwinAI/1.0 student-research GIS-enrichment"
}

REQUEST_TIMEOUT = 30
REQUEST_DELAY = 1.2
MAX_RETRIES = 3

# ============================================================
# IMPORTANT
# ============================================================
# KEEP TRUE FIRST.
# Nothing is written to Supabase.
# ============================================================

DRY_RUN = True

MAX_PROJECTS: Optional[int] = 100


SCRIPT_DIR = Path(__file__).resolve().parent

RESULTS_CSV = (
    SCRIPT_DIR
    / "geocode_pass2_results_v3.csv"
)


# ============================================================
# CACHE
# ============================================================

GEOCODE_CACHE: dict[
    str,
    list[dict[str, Any]]
] = {}


# ============================================================
# INDIA STATES / UTs
# ============================================================

INDIAN_STATES = [
    "Andaman and Nicobar Islands",
    "Andhra Pradesh",
    "Arunachal Pradesh",
    "Assam",
    "Bihar",
    "Chandigarh",
    "Chhattisgarh",
    "Dadra and Nagar Haveli and Daman and Diu",
    "Delhi",
    "Goa",
    "Gujarat",
    "Haryana",
    "Himachal Pradesh",
    "Jammu and Kashmir",
    "Jharkhand",
    "Karnataka",
    "Kerala",
    "Ladakh",
    "Lakshadweep",
    "Madhya Pradesh",
    "Maharashtra",
    "Manipur",
    "Meghalaya",
    "Mizoram",
    "Nagaland",
    "Odisha",
    "Puducherry",
    "Punjab",
    "Rajasthan",
    "Sikkim",
    "Tamil Nadu",
    "Telangana",
    "Tripura",
    "Uttar Pradesh",
    "Uttarakhand",
    "West Bengal",
]


STATE_ALIASES = {
    "orissa": "odisha",
    "uttaranchal": "uttarakhand",
    "pondicherry": "puducherry",
    "nct of delhi": "delhi",
    "national capital territory of delhi": "delhi",
    "jammu kashmir": "jammu and kashmir",
}


# ============================================================
# WORDS THAT ARE NOT LOCATIONS
# ============================================================

BAD_PLACE_WORDS = {
    "two",
    "three",
    "four",
    "six",
    "lane",
    "lanes",
    "laning",
    "widening",
    "construction",
    "maintenance",
    "management",
    "operation",
    "development",
    "improvement",
    "rehabilitation",
    "upgradation",
    "upgrading",
    "carriageway",
    "package",
    "section",
    "stretch",
    "project",
    "highway",
    "road",
    "bridge",
    "culvert",
    "shoulder",
}


# ============================================================
# NORMALISATION
# ============================================================

def clean_text(value: Any) -> Optional[str]:

    if value is None:
        return None

    value = str(value).strip()

    if not value:
        return None

    if value.lower() in {
        "none",
        "null",
        "nan",
        "unknown",
        "not recorded",
    }:
        return None

    return value


def remove_accents(value: str) -> str:

    return "".join(
        char
        for char in unicodedata.normalize(
            "NFKD",
            value,
        )
        if not unicodedata.combining(char)
    )


def normalize(value: Any) -> str:

    if value is None:
        return ""

    text = remove_accents(
        str(value)
    ).lower()

    # Fix common copied/mis-decoded dashes.
    text = (
        text
        .replace("â€“", "-")
        .replace("â€”", "-")
        .replace("–", "-")
        .replace("—", "-")
        .replace("&", " and ")
    )

    text = re.sub(
        r"[^a-z0-9]+",
        " ",
        text,
    )

    return re.sub(
        r"\s+",
        " ",
        text,
    ).strip()


def normalize_state(value: Any) -> str:

    value = normalize(value)

    return STATE_ALIASES.get(
        value,
        value,
    )


def normalize_project_name(
    value: str,
) -> str:

    return (
        value
        .replace("â€“", "-")
        .replace("â€”", "-")
        .replace("–", "-")
        .replace("—", "-")
    )


# ============================================================
# STATE HANDLING
# ============================================================

def extract_state_from_name(
    project_name: Optional[str],
) -> Optional[str]:

    if not project_name:
        return None

    text = normalize(
        project_name
    )

    found = []

    for state in INDIAN_STATES:

        if re.search(
            rf"\b{re.escape(normalize(state))}\b",
            text,
        ):
            found.append(state)

    if len(found) == 1:
        return found[0]

    if len(found) > 1:
        return "; ".join(found)

    if "orissa" in text:
        return "Odisha"

    if "uttaranchal" in text:
        return "Uttarakhand"

    if "pondicherry" in text:
        return "Puducherry"

    return None


def get_project_state(
    project: Project,
) -> Optional[str]:

    state = clean_text(
        getattr(
            project,
            "state",
            None,
        )
    )

    if state:
        return state

    return extract_state_from_name(
        clean_text(
            getattr(
                project,
                "project_name",
                None,
            )
        )
    )


def split_states(
    value: Optional[str],
) -> list[str]:

    if not value:
        return []

    parts = re.split(
        r"[;,/&]+",
        value,
    )

    return [
        item.strip()
        for item in parts
        if item.strip()
    ]


# ============================================================
# LOCATION CLEANING
# ============================================================

def clean_place(
    value: Any,
) -> Optional[str]:

    value = clean_text(value)

    if not value:
        return None

    value = normalize_project_name(
        value
    )

    # Remove brackets around names.
    value = value.strip(
        " ()[]{}.,:-"
    )

    # Common junk before a real location.
    prefixes = [
        r"^on\s+",
        r"^at\s+",
        r"^near\s+",
        r"^from\s+",
        r"^to\s+",
        r"^for\s+",
        r"^and\s+for\s+",
        r"^including\s+",
        r"^construction\s+of\s+",
        r"^development\s+of\s+",
        r"^rehabilitation\s+and\s+up[- ]?gradation\s+of\s+",
        r"^rehabilitation\s+&\s+up[- ]?gradation\s+of\s+",
        r"^upgradation\s+of\s+",
        r"^upgrading\s+of\s+",
        r"^widening\s+of\s+",
        r"^improvement\s+of\s+",
    ]

    changed = True

    while changed:

        changed = False

        for pattern in prefixes:

            new_value = re.sub(
                pattern,
                "",
                value,
                flags=re.IGNORECASE,
            ).strip()

            if new_value != value:
                value = new_value
                changed = True


    # Remove common suffix junk.
    value = re.sub(
        r"\s+railway\s+crossing$",
        "",
        value,
        flags=re.IGNORECASE,
    )

    value = re.sub(
        r"\s+railway\s+station$",
        "",
        value,
        flags=re.IGNORECASE,
    )

    value = re.sub(
        r"\s+(?:road|section|stretch)$",
        "",
        value,
        flags=re.IGNORECASE,
    )

    value = re.sub(
        r"\s+",
        " ",
        value,
    ).strip(
        " ()[]{}.,:-"
    )

    if len(value) < 3:
        return None

    tokens = normalize(
        value
    ).split()

    if not tokens:
        return None

    if all(
        token in BAD_PLACE_WORDS
        for token in tokens
    ):
        return None

    return value


# ============================================================
# PLACE QUALITY CHECK
# ============================================================

def valid_place_name(
    value: Optional[str],
) -> bool:

    if not value:
        return False

    text = normalize(
        value
    )

    if not text:
        return False

    if text in BAD_PLACE_WORDS:
        return False

    bad_phrases = [
        "two lane",
        "four lane",
        "six lane",
        "two laning",
        "four laning",
        "six laning",
        "paved shoulder",
        "carriage way",
        "carriageway",
        "detailed project report",
        "revised technical approval",
        "feasibility study",
    ]

    for phrase in bad_phrases:

        if phrase in text:
            return False

    tokens = text.split()

    if len(tokens) > 6:
        return False

    bad_count = sum(
        token in BAD_PLACE_WORDS
        for token in tokens
    )

    if (
        bad_count /
        max(len(tokens), 1)
        >= 0.5
    ):
        return False

    return True


# ============================================================
# BYPASS EXTRACTION
# ============================================================

def extract_bypass(
    project_name: str,
) -> Optional[str]:

    text = normalize_project_name(
        project_name
    )

    # More specific patterns FIRST.
    patterns = [
        r"\bincluding\s+(?:construction\s+of\s+)?([A-Za-z][A-Za-z .'-]{1,50}?)\s+bypass\b",

        r"\bconstruction\s+of\s+(?:\d+\s*[- ]?lane\s+)?([A-Za-z][A-Za-z .'-]{1,50}?)\s+bypass\b",

        r"\bdevelopment\s+of\s+([A-Za-z][A-Za-z .'-]{1,50}?)\s+bypass\b",

        r"\b([A-Za-z][A-Za-z .'-]{1,35}?)\s+city\s+bypass\b",

        r"(?:^|[:;(])\s*([A-Za-z][A-Za-z .'-]{1,35}?)\s+bypass\b",
    ]

    for pattern in patterns:

        matches = list(
            re.finditer(
                pattern,
                text,
                re.IGNORECASE,
            )
        )

        if not matches:
            continue

        # Prefer the last matching bypass reference.
        match = matches[-1]

        place = clean_place(
            match.group(1)
        )

        if valid_place_name(
            place
        ):
            return place

    return None


# ============================================================
# NEAR / AT / VILLAGE EXTRACTION
# ============================================================

def extract_locality(
    project_name: str,
) -> Optional[str]:

    text = normalize_project_name(
        project_name
    )

    patterns = [
        # Parenthesised near locality:
        # (near Bodi)
        r"\(\s*near\s+([A-Za-z][A-Za-z .'-]{1,45}?)\s*\)",

        # near Uchipulli ...
        r"\bnear\s+([A-Za-z][A-Za-z .'-]{1,45}?)(?=\s+(?:of|on|in|at|railway)\b|[),;]|$)",

        # at Chapra railway crossing
        r"\bat\s+([A-Za-z][A-Za-z .'-]{1,45}?)(?=\s+railway\s+crossing\b)",

        # at Phaphamau,
        r"\bat\s+([A-Za-z][A-Za-z .'-]{1,45}?)(?=[),;]|$)",

        # Village Khushalpur
        r"\bvillage\s+([A-Za-z][A-Za-z .'-]{1,45}?)(?=[),;]|$)",
    ]

    for pattern in patterns:

        match = re.search(
            pattern,
            text,
            re.IGNORECASE,
        )

        if not match:
            continue

        place = clean_place(
            match.group(1)
        )

        if valid_place_name(
            place
        ):
            return place

    return None


# ============================================================
# ROUTE EXTRACTION
# ============================================================

def endpoint_cleanup(
    value: str,
) -> Optional[str]:

    value = clean_place(
        value
    )

    if not value:
        return None

    # If a chain sneaks in:
    #
    # "Khurai - Bina"
    #
    # caller decides whether to use first or last.
    return value


def extract_parenthesized_route(
    text: str,
) -> Optional[
    tuple[str, str]
]:

    # Examples:
    #
    # (Nayagarh to Khordha)
    # (Maicheli to Semilisahi)
    # (Birpur- Bihpur Section)
    # (Hajipur- Mushrigharari)

    groups = re.findall(
        r"\(([^()]{3,120})\)",
        text,
    )

    for group in groups:

        result = extract_route_core(
            group
        )

        if result:
            return result

    return None


def extract_multi_hyphen_chain(
    text: str,
) -> Optional[
    tuple[str, str]
]:

    # Search for sequences such as:
    #
    # Sagar - Khurai - Bina
    # Bilaspur-Takhatpur-Mungali-Pandariya-Pondi
    # Abohar-Sito-Gunno-Dabwali

    candidates = re.findall(
        (
            r"([A-Za-z][A-Za-z .' ]{1,25}"
            r"(?:\s*-\s*[A-Za-z][A-Za-z .' ]{1,25}){2,})"
        ),
        text,
    )

    for candidate in candidates:

        parts = [
            clean_place(part)
            for part in re.split(
                r"\s*-\s*",
                candidate,
            )
        ]

        parts = [
            part
            for part in parts
            if valid_place_name(part)
        ]

        if len(parts) >= 3:

            return (
                parts[0],
                parts[-1],
            )

    return None


def extract_route_core(
    text: str,
) -> Optional[
    tuple[str, str]
]:

    text = normalize_project_name(
        text
    )

    # --------------------------------------------------------
    # X (chainage...) TO Y
    # --------------------------------------------------------

    pattern = re.search(
        (
            r"\b([A-Za-z][A-Za-z .'-]{1,45}?)"
            r"(?:\s*\([^)]{0,80}\))?"
            r"\s+to\s+"
            r"([A-Za-z][A-Za-z .'-]{1,45}?)"
            r"(?:\s*\([^)]{0,80}\))?"
            r"(?="
            r"\s+(?:section|road|stretch|on|of|from|km|and|including)\b"
            r"|[),;:&]"
            r"|$"
            r")"
        ),
        text,
        re.IGNORECASE,
    )

    if pattern:

        start = endpoint_cleanup(
            pattern.group(1)
        )

        end = endpoint_cleanup(
            pattern.group(2)
        )

        if (
            valid_place_name(start)
            and valid_place_name(end)
            and normalize(start)
            != normalize(end)
        ):
            return start, end


    # --------------------------------------------------------
    # BETWEEN X & Y
    # --------------------------------------------------------

    pattern = re.search(
        (
            r"\bbetween\s+"
            r"([A-Za-z][A-Za-z .'-]{1,40}?)"
            r"\s+(?:and|&)\s+"
            r"([A-Za-z][A-Za-z .'-]{1,40}?)"
            r"(?=[),;]|$|\s+(?:in|at|on)\b)"
        ),
        text,
        re.IGNORECASE,
    )

    if pattern:

        start = endpoint_cleanup(
            pattern.group(1)
        )

        end = endpoint_cleanup(
            pattern.group(2)
        )

        if (
            valid_place_name(start)
            and valid_place_name(end)
        ):
            return start, end


    # --------------------------------------------------------
    # X - Y
    # --------------------------------------------------------

    pattern = re.search(
        (
            r"\b([A-Za-z][A-Za-z .' ]{1,35}?)"
            r"\s*-\s*"
            r"([A-Za-z][A-Za-z .' ]{1,35}?)"
            r"(?="
            r"\s+(?:section|road|stretch|including|from|on|of|nh)\b"
            r"|[),;]"
            r"|$"
            r")"
        ),
        text,
        re.IGNORECASE,
    )

    if pattern:

        start = endpoint_cleanup(
            pattern.group(1)
        )

        end = endpoint_cleanup(
            pattern.group(2)
        )

        if (
            valid_place_name(start)
            and valid_place_name(end)
            and normalize(start)
            != normalize(end)
        ):

            return start, end

    return None


def extract_route(
    project_name: str,
) -> Optional[
    tuple[str, str]
]:

    text = normalize_project_name(
        project_name
    )

    # 1. Parentheses often contain the cleanest corridor.
    route = extract_parenthesized_route(
        text
    )

    if route:
        return route

    # 2. Multi-stop routes.
    route = extract_multi_hyphen_chain(
        text
    )

    if route:
        return route

    # 3. General route patterns.
    return extract_route_core(
        text
    )


# ============================================================
# GEOCODER HELPERS
# ============================================================

def search_nominatim(
    query: str,
) -> list[dict[str, Any]]:

    if query in GEOCODE_CACHE:
        return GEOCODE_CACHE[
            query
        ]

    params = {
        "q": query,
        "format": "jsonv2",
        "limit": 8,
        "countrycodes": "in",
        "addressdetails": 1,
    }

    for attempt in range(
        1,
        MAX_RETRIES + 1,
    ):

        try:

            response = requests.get(
                NOMINATIM_URL,
                params=params,
                headers=HEADERS,
                timeout=REQUEST_TIMEOUT,
            )

            if response.status_code == 429:

                wait = 5 * attempt

                print(
                    f"Rate limit. Waiting {wait}s..."
                )

                time.sleep(wait)

                continue

            response.raise_for_status()

            results = response.json()

            if not isinstance(
                results,
                list,
            ):
                results = []

            GEOCODE_CACHE[
                query
            ] = results

            time.sleep(
                REQUEST_DELAY
            )

            return results

        except requests.RequestException as exc:

            print(
                "Geocoder error:",
                exc,
            )

            if attempt < MAX_RETRIES:
                time.sleep(
                    5 * attempt
                )

    GEOCODE_CACHE[
        query
    ] = []

    return []


# ============================================================
# RESULT VALIDATION
# ============================================================

def get_result_state(
    result: dict[str, Any],
) -> Optional[str]:

    return clean_text(
        result
        .get(
            "address",
            {},
        )
        .get(
            "state"
        )
    )


def place_similarity(
    expected: str,
    result: dict[str, Any],
) -> float:

    expected_norm = normalize(
        expected
    )

    display = normalize(
        result.get(
            "display_name",
            "",
        )
    )

    address = result.get(
        "address",
        {},
    )

    candidates = [
        address.get("city"),
        address.get("town"),
        address.get("village"),
        address.get("municipality"),
        address.get("county"),
        address.get("state_district"),
        address.get("suburb"),
        address.get("hamlet"),
    ]

    candidate_texts = [
        normalize(item)
        for item in candidates
        if item
    ]

    # Exact occurrence is strongest.
    if expected_norm in display:
        return 1.0

    best = 0.0

    for candidate in candidate_texts:

        score = SequenceMatcher(
            None,
            expected_norm,
            candidate,
        ).ratio()

        best = max(
            best,
            score,
        )

    return best


def valid_result_for_place(
    place: str,
    result: dict[str, Any],
) -> bool:

    try:
        latitude = float(
            result["lat"]
        )

        longitude = float(
            result["lon"]
        )

    except (
        KeyError,
        TypeError,
        ValueError,
    ):
        return False

    if not (
        -90 <= latitude <= 90
        and
        -180 <= longitude <= 180
    ):
        return False

    country_code = normalize(
        result
        .get(
            "address",
            {},
        )
        .get(
            "country_code"
        )
    )

    if (
        country_code
        and country_code != "in"
    ):
        return False

    # Prevent results such as a random bank/store
    # from satisfying a city/town query.
    similarity = place_similarity(
        place,
        result,
    )

    return similarity >= 0.72


# ============================================================
# GEOCODE PLACE
# ============================================================

def geocode_place(
    place: str,
    project_state: Optional[str],
    *,
    allow_cross_state: bool = False,
) -> Optional[dict[str, Any]]:

    states = split_states(
        project_state
    )

    queries: list[
        tuple[str, Optional[str]]
    ] = []


    for state in states:

        queries.append(
            (
                f"{place}, {state}, India",
                state,
            )
        )


    # Always allow India fallback.
    queries.append(
        (
            f"{place}, India",
            None,
        )
    )


    for query, expected_state in queries:

        print(
            "Trying:",
            query
        )

        results = search_nominatim(
            query
        )


        valid_candidates = []


        for result in results:

            if not valid_result_for_place(
                place,
                result,
            ):
                continue


            returned_state = (
                get_result_state(
                    result
                )
            )


            if (
                expected_state
                and
                returned_state
                and
                normalize_state(
                    expected_state
                )
                !=
                normalize_state(
                    returned_state
                )
            ):
                continue


            # For India-wide fallback, if the project has a state,
            # prefer a matching state unless cross-state is allowed.
            if (
                expected_state is None
                and
                states
                and
                returned_state
                and
                not allow_cross_state
            ):

                valid_state_names = {
                    normalize_state(
                        item
                    )
                    for item in states
                }

                if (
                    normalize_state(
                        returned_state
                    )
                    not in valid_state_names
                ):
                    continue


            valid_candidates.append(
                result
            )


        if not valid_candidates:
            continue


        # Pick the candidate that best matches the place name.
        best = max(
            valid_candidates,
            key=lambda item:
                place_similarity(
                    place,
                    item,
                ),
        )


        return {
            "latitude":
                float(
                    best["lat"]
                ),

            "longitude":
                float(
                    best["lon"]
                ),

            "display_name":
                best.get(
                    "display_name",
                    "",
                ),

            "state":
                get_result_state(
                    best
                ),
        }


    return None


# ============================================================
# DISTANCE
# ============================================================

def haversine_km(
    lat1: float,
    lon1: float,
    lat2: float,
    lon2: float,
) -> float:

    radius = 6371.0

    phi1 = math.radians(
        lat1
    )

    phi2 = math.radians(
        lat2
    )

    delta_phi = math.radians(
        lat2 - lat1
    )

    delta_lambda = math.radians(
        lon2 - lon1
    )

    a = (
        math.sin(
            delta_phi / 2
        ) ** 2
        +
        math.cos(phi1)
        *
        math.cos(phi2)
        *
        math.sin(
            delta_lambda / 2
        ) ** 2
    )

    return (
        2
        * radius
        * math.asin(
            math.sqrt(a)
        )
    )


# ============================================================
# ROUTE VALIDATION
# ============================================================

def validate_route(
    project_state: Optional[str],
    start: dict[str, Any],
    end: dict[str, Any],
) -> bool:

    distance = haversine_km(
        start["latitude"],
        start["longitude"],
        end["latitude"],
        end["longitude"],
    )

    print(
        f"Endpoint distance: "
        f"{distance:.1f} km"
    )

    # Extremely long result is probably an ambiguous
    # place-name match.
    if distance > 700:
        print(
            "Rejected: endpoints are too far apart."
        )
        return False


    if not project_state:
        return True


    allowed_states = {
        normalize_state(state)
        for state in split_states(
            project_state
        )
    }


    start_state = normalize_state(
        start.get("state")
    )

    end_state = normalize_state(
        end.get("state")
    )


    # At least one endpoint should belong to
    # the recorded project state(s).
    if allowed_states:

        if (
            start_state not in allowed_states
            and
            end_state not in allowed_states
        ):

            print(
                "Rejected: neither endpoint "
                "matches project state."
            )

            return False


    return True


# ============================================================
# CSV LOG
# ============================================================

def log_result(
    project_id: str,
    status: str,
    method: str = "",
    detail: str = "",
) -> None:

    exists = RESULTS_CSV.exists()

    with RESULTS_CSV.open(
        "a",
        newline="",
        encoding="utf-8",
    ) as file:

        writer = csv.writer(
            file
        )

        if not exists:

            writer.writerow(
                [
                    "project_id",
                    "status",
                    "method",
                    "detail",
                ]
            )

        writer.writerow(
            [
                project_id,
                status,
                method,
                detail,
            ]
        )


# ============================================================
# SAVE LOCALITY
# ============================================================

def save_locality(
    db,
    project: Project,
    locality: str,
    result: dict[str, Any],
) -> None:

    print(
        "VALID LOCALITY:"
    )

    print(
        result[
            "display_name"
        ]
    )

    print(
        "Latitude :",
        result[
            "latitude"
        ]
    )

    print(
        "Longitude:",
        result[
            "longitude"
        ]
    )


    if DRY_RUN:

        print(
            "DRY RUN -> not saved"
        )

        return


    project.latitude = (
        result[
            "latitude"
        ]
    )

    project.longitude = (
        result[
            "longitude"
        ]
    )


    if (
        not clean_text(
            project.state
        )
        and
        result.get(
            "state"
        )
    ):

        project.state = (
            result[
                "state"
            ]
        )


    project.gis_status = (
        "MAPPED"
    )

    project.location_accuracy = (
        "LOCALITY_APPROX"
    )

    project.location_source = (
        "project_name + "
        "OpenStreetMap Nominatim"
    )

    project.geocode_confidence = (
        0.75
    )

    db.add(
        project
    )

    db.commit()

    db.refresh(
        project
    )

    print(
        "SAVED"
    )


# ============================================================
# SAVE ROUTE
# ============================================================

def save_route(
    db,
    project: Project,
    start_name: str,
    end_name: str,
    start: dict[str, Any],
    end: dict[str, Any],
) -> None:

    latitude = (
        start["latitude"]
        +
        end["latitude"]
    ) / 2.0

    longitude = (
        start["longitude"]
        +
        end["longitude"]
    ) / 2.0


    print(
        "VALID ROUTE:"
    )

    print(
        "START:",
        start_name
    )

    print(
        start[
            "display_name"
        ]
    )

    print(
        "END:",
        end_name
    )

    print(
        end[
            "display_name"
        ]
    )

    print(
        "Representative midpoint:",
        latitude,
        longitude,
    )


    if DRY_RUN:

        print(
            "DRY RUN -> not saved"
        )

        return


    project.start_location = (
        start_name
    )

    project.start_latitude = (
        start[
            "latitude"
        ]
    )

    project.start_longitude = (
        start[
            "longitude"
        ]
    )


    project.end_location = (
        end_name
    )

    project.end_latitude = (
        end[
            "latitude"
        ]
    )

    project.end_longitude = (
        end[
            "longitude"
        ]
    )


    project.latitude = (
        latitude
    )

    project.longitude = (
        longitude
    )


    # Actual road geometry is NOT known yet.
    project.route_geometry = None


    if (
        not clean_text(
            project.state
        )
    ):

        start_state = clean_text(
            start.get(
                "state"
            )
        )

        end_state = clean_text(
            end.get(
                "state"
            )
        )

        if (
            start_state
            and
            end_state
            and
            normalize_state(
                start_state
            )
            ==
            normalize_state(
                end_state
            )
        ):

            project.state = (
                start_state
            )


    project.gis_status = (
        "MAPPED"
    )

    project.location_accuracy = (
        "CORRIDOR_APPROX"
    )

    project.location_source = (
        "project_name endpoints + "
        "OpenStreetMap Nominatim"
    )

    project.geocode_confidence = (
        0.80
    )


    db.add(
        project
    )

    db.commit()

    db.refresh(
        project
    )

    print(
        "SAVED"
    )


# ============================================================
# PROCESS ONE PROJECT
# ============================================================

def process_project(
    db,
    project: Project,
) -> str:

    project_id = str(
        project.project_id
    )

    name = clean_text(
        project.project_name
    )

    state = get_project_state(
        project
    )


    print(
        "\n"
        + "=" * 80
    )

    print(
        "PROJECT:",
        project_id
    )

    print(
        "STATE:",
        state
    )

    print(
        "NAME:",
        (
            name[:220]
            if name
            else ""
        )
    )


    if not name:

        return "unresolved"


    # ========================================================
    # PASS 1 — BYPASS
    # ========================================================

    bypass = extract_bypass(
        name
    )


    if bypass:

        print(
            "BYPASS LOCALITY FOUND:",
            bypass
        )


        result = geocode_place(
            bypass,
            state,
            allow_cross_state=False,
        )


        if result:

            save_locality(
                db,
                project,
                bypass,
                result,
            )


            log_result(
                project_id,
                (
                    "DRY_RUN_RESOLVED"
                    if DRY_RUN
                    else
                    "RESOLVED"
                ),
                "BYPASS",
                bypass,
            )


            return "resolved"


        print(
            "Bypass locality unresolved."
        )


    # ========================================================
    # PASS 2 — ROUTE
    # ========================================================

    route = extract_route(
        name
    )


    if route:

        start_name, end_name = (
            route
        )


        print(
            "ROUTE FOUND:"
        )

        print(
            start_name,
            "->",
            end_name
        )


        start = geocode_place(
            start_name,
            state,
            allow_cross_state=True,
        )


        if not start:

            print(
                "START unresolved."
            )

        else:

            end = geocode_place(
                end_name,
                state,
                allow_cross_state=True,
            )


            if not end:

                print(
                    "END unresolved."
                )

            elif validate_route(
                state,
                start,
                end,
            ):

                save_route(
                    db,
                    project,
                    start_name,
                    end_name,
                    start,
                    end,
                )


                log_result(
                    project_id,
                    (
                        "DRY_RUN_RESOLVED"
                        if DRY_RUN
                        else
                        "RESOLVED"
                    ),
                    "ROUTE",
                    (
                        f"{start_name} -> "
                        f"{end_name}"
                    ),
                )


                return "resolved"


    # ========================================================
    # PASS 3 — NEAR / AT / VILLAGE
    # ========================================================

    locality = extract_locality(
        name
    )


    if locality:

        print(
            "LOCALITY FOUND:",
            locality
        )


        result = geocode_place(
            locality,
            state,
            allow_cross_state=False,
        )


        if result:

            save_locality(
                db,
                project,
                locality,
                result,
            )


            log_result(
                project_id,
                (
                    "DRY_RUN_RESOLVED"
                    if DRY_RUN
                    else
                    "RESOLVED"
                ),
                "LOCALITY",
                locality,
            )


            return "resolved"


    print(
        "UNRESOLVED: insufficient reliable GIS evidence."
    )


    log_result(
        project_id,
        "UNRESOLVED",
        "",
        "No validated locality/route",
    )


    return "unresolved"


# ============================================================
# FETCH PROJECTS
# ============================================================

def get_projects(
    db,
) -> list[Project]:

    query = (
        db.query(
            Project
        )
        .filter(
            (
                Project.latitude.is_(
                    None
                )
            )
            |
            (
                Project.longitude.is_(
                    None
                )
            )
        )
        .order_by(
            Project.id.asc()
        )
    )


    if MAX_PROJECTS is not None:

        query = query.limit(
            MAX_PROJECTS
        )


    return query.all()


# ============================================================
# MAIN
# ============================================================

def main() -> None:

    print(
        "\n"
        + "=" * 80
    )

    print(
        "ACQUITWIN GIS ENRICHMENT V3"
    )

    print(
        "=" * 80
    )

    print(
        "Dry run:",
        DRY_RUN
    )

    print(
        "Maximum projects:",
        MAX_PROJECTS
    )


    db = SessionLocal()


    try:

        projects = get_projects(
            db
        )


        print(
            "\nProjects to process:",
            len(projects)
        )


        resolved = 0
        unresolved = 0
        errors = 0


        for index, project in enumerate(
            projects,
            start=1,
        ):

            print(
                f"\n[{index}/{len(projects)}]"
            )


            try:

                status = process_project(
                    db,
                    project,
                )


                if status == "resolved":

                    resolved += 1

                else:

                    unresolved += 1


            except KeyboardInterrupt:

                print(
                    "\nStopped."
                )

                break


            except Exception as exc:

                db.rollback()

                errors += 1


                print(
                    "ERROR:",
                    exc
                )


                log_result(
                    str(
                        project.project_id
                    ),
                    "ERROR",
                    "",
                    str(exc),
                )


        print(
            "\n"
            + "=" * 80
        )

        print(
            "PASS 2 V3 COMPLETE"
        )

        print(
            "=" * 80
        )

        print(
            "Resolved   :",
            resolved
        )

        print(
            "Unresolved :",
            unresolved
        )

        print(
            "Errors     :",
            errors
        )

        print(
            "Dry run    :",
            DRY_RUN
        )

        print(
            "\nResults:"
        )

        print(
            RESULTS_CSV
        )


        if DRY_RUN:

            print(
                "\nDATABASE WAS NOT MODIFIED."
            )


    finally:

        db.close()


if __name__ == "__main__":
    main()