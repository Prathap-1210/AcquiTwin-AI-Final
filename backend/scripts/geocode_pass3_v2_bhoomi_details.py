from __future__ import annotations

import csv
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any, Optional
from urllib.parse import quote, urlparse, parse_qs

import requests
from bs4 import BeautifulSoup


# ============================================================
# PROJECT IMPORT PATH
# ============================================================

BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = BACKEND_DIR.parent

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

DRY_RUN = True

# Test only 20 first.
MAX_PROJECTS: Optional[int] = 20

# Maximum official villages to geocode for one project.
MAX_VILLAGES_PER_PROJECT = 10

SOURCE_TIMEOUT = 30
MAPTILER_TIMEOUT = 30

SOURCE_DELAY = 1.2
MAPTILER_DELAY = 0.25


BHOOMI_BASE = (
    "https://bhoomirashi.gov.in/"
    "auth/revamp/"
)


HEADERS = {
    "User-Agent": (
        "AcquiTwinAI/1.0 "
        "student-research GIS-enrichment"
    )
}


SCRIPT_DIR = Path(__file__).resolve().parent

RESULTS_CSV = (
    SCRIPT_DIR
    / "geocode_pass3_v2_results.csv"
)


# ============================================================
# STATE NORMALISATION
# ============================================================

STATE_ALIASES = {
    "orissa": "odisha",
    "odisha": "odisha",

    "uttaranchal": "uttarakhand",
    "uttarakhand": "uttarakhand",

    "pondicherry": "puducherry",
    "puducherry": "puducherry",

    "nct of delhi": "delhi",
    "national capital territory of delhi": "delhi",
    "delhi": "delhi",

    "jammu kashmir": "jammu and kashmir",
    "jammu and kashmir": "jammu and kashmir",
}


# ============================================================
# BASIC HELPERS
# ============================================================

def clean_text(
    value: Any,
) -> Optional[str]:

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


def normalize(
    value: Any,
) -> str:

    if value is None:
        return ""

    value = str(value).lower()

    value = value.replace(
        "&",
        " and ",
    )

    value = re.sub(
        r"[^a-z0-9]+",
        " ",
        value,
    )

    value = re.sub(
        r"\s+",
        " ",
        value,
    )

    return value.strip()


def normalize_state(
    value: Any,
) -> str:

    value = normalize(
        value
    )

    return STATE_ALIASES.get(
        value,
        value,
    )


def clean_village_name(
    value: Any,
) -> Optional[str]:

    value = clean_text(
        value
    )

    if not value:
        return None

    # Example:
    # Bhangali (110)
    # ->
    # Bhangali

    value = re.sub(
        r"\s*\(\s*\d+\s*\)\s*$",
        "",
        value,
    )

    value = re.sub(
        r"\s+",
        " ",
        value,
    ).strip(
        " ,.;:-"
    )

    if len(value) < 2:
        return None

    return value


# ============================================================
# ENV FILE
# ============================================================

def parse_env(
    path: Path,
) -> dict[str, str]:

    output: dict[str, str] = {}

    if not path.exists():
        return output

    try:

        content = path.read_text(
            encoding="utf-8",
        )

    except Exception:

        return output


    for line in content.splitlines():

        line = line.strip()

        if (
            not line
            or line.startswith("#")
            or "=" not in line
        ):
            continue

        key, value = line.split(
            "=",
            1,
        )

        output[
            key.strip()
        ] = (
            value.strip()
            .strip('"')
            .strip("'")
        )

    return output


def get_maptiler_key() -> str:

    key = clean_text(
        os.getenv(
            "MAPTILER_KEY"
        )
    )

    if key:
        return key


    backend_env = parse_env(
        BACKEND_DIR
        / ".env"
    )

    key = clean_text(
        backend_env.get(
            "MAPTILER_KEY"
        )
        or
        backend_env.get(
            "VITE_MAPTILER_KEY"
        )
    )

    if key:
        return key


    frontend_env = parse_env(
        PROJECT_ROOT
        / "frontend"
        / ".env"
    )

    key = clean_text(
        frontend_env.get(
            "VITE_MAPTILER_KEY"
        )
    )

    if key:
        return key


    raise RuntimeError(
        "MapTiler API key not found."
    )


# ============================================================
# PROJECT NOTES
# ============================================================

def parse_notes(
    notes: Any,
) -> dict[str, Any]:

    if isinstance(
        notes,
        dict,
    ):
        return notes

    raw = clean_text(
        notes
    )

    if not raw:
        return {}


    try:

        parsed = json.loads(
            raw
        )

        if isinstance(
            parsed,
            dict,
        ):
            return parsed

    except Exception:
        pass


    match = re.search(
        r"https?://[^\s\"'}]+",
        raw,
        flags=re.IGNORECASE,
    )

    if match:

        return {
            "source_url":
                match.group(0)
        }


    return {}


def source_url_for_project(
    project: Project,
) -> Optional[str]:

    notes = parse_notes(
        project.notes
    )

    source_url = clean_text(
        notes.get(
            "source_url"
        )
    )

    if not source_url:
        return None


    parsed = urlparse(
        source_url
    )


    if (
        parsed.hostname
        not in {
            "bhoomirashi.gov.in",
            "www.bhoomirashi.gov.in",
        }
    ):
        return None


    return source_url


def numeric_bhoomi_project_id(
    source_url: str,
) -> Optional[str]:

    try:

        parsed = urlparse(
            source_url
        )

        query = parse_qs(
            parsed.query
        )

        values = query.get(
            "project_id",
            [],
        )

        if not values:
            return None

        value = str(
            values[0]
        ).strip()

        if not value.isdigit():
            return None

        return value

    except Exception:

        return None


# ============================================================
# HTTP
# ============================================================

def fetch_public_page(
    url: str,
) -> Optional[str]:

    try:

        response = requests.get(
            url,
            headers=HEADERS,
            timeout=SOURCE_TIMEOUT,
            allow_redirects=True,
        )

    except requests.RequestException as exc:

        print(
            "REQUEST ERROR:",
            exc
        )

        return None


    final_host = (
        urlparse(
            response.url
        ).hostname
        or ""
    ).lower()


    if final_host not in {
        "bhoomirashi.gov.in",
        "www.bhoomirashi.gov.in",
    }:

        return None


    if response.status_code != 200:

        print(
            "HTTP:",
            response.status_code
        )

        return None


    # If protected page redirected to login,
    # don't attempt to bypass it.
    if (
        "login1.cshtml"
        in response.url.lower()
    ):

        print(
            "Protected/login page -> skipped"
        )

        return None


    time.sleep(
        SOURCE_DELAY
    )


    return response.text


# ============================================================
# EXTRACT NOTIFICATION IDS FROM RAW HTML
# ============================================================

def extract_notification_ids(
    html: str,
    page_name: str,
) -> list[str]:

    # We deliberately inspect RAW HTML rather than BeautifulSoup hrefs.
    #
    # BeautifulSoup/browser HTML entity decoding can transform:
    #
    # &notification_id
    #
    # into:
    #
    # ¬ification_id
    #
    # because "&not" is an HTML entity.

    pattern = (
        rf"{re.escape(page_name)}"
        r"\.cshtml"
        r"[^\"']*?"
        r"notification_id=(\d+)"
    )


    ids = re.findall(
        pattern,
        html,
        flags=re.IGNORECASE,
    )


    output = []

    seen = set()


    for value in ids:

        if value in seen:
            continue

        seen.add(
            value
        )

        output.append(
            value
        )


    return output


# ============================================================
# BUILD SAFE DETAIL URL
# ============================================================

def build_detail_url(
    *,
    page: str,
    project_id: str,
    notification_id: str,
) -> str:

    return (
        f"{BHOOMI_BASE}"
        f"{page}.cshtml?"
        f"project_id={project_id}"
        f"&EncHid="
        f"&notification_id={notification_id}"
        f"&nid=9"
    )


# ============================================================
# PARSE SDET1 (3D DETAILS)
# ============================================================

def find_header_index(
    values: list[str],
    alternatives: set[str],
) -> Optional[int]:

    for index, value in enumerate(
        values
    ):

        normalized = normalize(
            value
        )

        if normalized in alternatives:
            return index

    return None


def parse_sdet1_locations(
    html: str,
) -> list[
    dict[str, Optional[str]]
]:

    soup = BeautifulSoup(
        html,
        "html.parser",
    )

    output: list[
        dict[str, Optional[str]]
    ] = []

    seen = set()

    # ========================================================
    # IMPORTANT:
    # Bhoomi Rashi pages contain nested tables.
    #
    # We only want rows shaped like:
    #
    # S.No | District | Sub District | Village
    #      | Survey Number | Area | Description
    #
    # Then:
    #
    # 1 | KANGRA | Dhira | Bhangali (110)
    #   | Survey1 | ...
    #
    # ========================================================

    for table in soup.find_all(
        "table"
    ):

        rows = table.find_all(
            "tr",
            recursive=False,
        )

        # Some useful tables may not expose rows
        # as direct children because of tbody.
        if not rows:

            tbody = table.find(
                "tbody",
                recursive=False,
            )

            if tbody:

                rows = tbody.find_all(
                    "tr",
                    recursive=False,
                )

        if not rows:
            continue

        header_indices = None

        for row_index, row in enumerate(
            rows
        ):

            cells = row.find_all(
                [
                    "th",
                    "td",
                ],
                recursive=False,
            )

            values = [
                clean_text(
                    cell.get_text(
                        " ",
                        strip=True,
                    )
                )
                or ""
                for cell in cells
            ]

            normalized_values = [
                normalize(
                    value
                )
                for value in values
            ]

            # ------------------------------------------------
            # Locate the REAL land table header.
            # ------------------------------------------------

            if (
                "district"
                in normalized_values
                and
                "sub district"
                in normalized_values
                and
                "village"
                in normalized_values
                and
                "survey number"
                in normalized_values
            ):

                header_indices = {
                    "district":
                        normalized_values.index(
                            "district"
                        ),

                    "subdistrict":
                        normalized_values.index(
                            "sub district"
                        ),

                    "village":
                        normalized_values.index(
                            "village"
                        ),

                    "survey":
                        normalized_values.index(
                            "survey number"
                        ),
                }

                continue

            # ------------------------------------------------
            # Ignore everything until correct header found.
            # ------------------------------------------------

            if not header_indices:
                continue

            required_index = max(
                header_indices.values()
            )

            if len(values) <= required_index:
                continue

            district = clean_text(
                values[
                    header_indices[
                        "district"
                    ]
                ]
            )

            subdistrict = clean_text(
                values[
                    header_indices[
                        "subdistrict"
                    ]
                ]
            )

            village_raw = clean_text(
                values[
                    header_indices[
                        "village"
                    ]
                ]
            )

            survey_number = clean_text(
                values[
                    header_indices[
                        "survey"
                    ]
                ]
            )

            village = clean_village_name(
                village_raw
            )

            if not village:
                continue

            # ------------------------------------------------
            # Reject headers accidentally repeated.
            # ------------------------------------------------

            village_norm = normalize(
                village
            )

            if village_norm in {
                "village",
                "survey number",
                "name",
                "address",
                "type",
                "area",
                "land parties",
            }:
                continue

            # ------------------------------------------------
            # Reject survey-number-looking values.
            #
            # Examples:
            # 147/1
            # 17B/2
            # 225B/2A2L
            # ------------------------------------------------

            if re.fullmatch(
                r"[0-9A-Za-z/\-\s]+",
                village,
            ):

                # A real village normally contains
                # alphabetic words rather than being primarily
                # a cadastral/survey identifier.
                letters = re.findall(
                    r"[A-Za-z]+",
                    village,
                )

                digits = re.findall(
                    r"\d+",
                    village,
                )

                if (
                    digits
                    and
                    not (
                        len(letters) >= 1
                        and
                        any(
                            len(word) >= 3
                            for word in letters
                        )
                    )
                ):
                    continue

            # ------------------------------------------------
            # District / subdivision must also be sensible.
            # ------------------------------------------------

            if district:

                if normalize(
                    district
                ) in {
                    "district",
                    "sub district",
                    "village",
                    "survey number",
                    "name",
                    "address",
                    "type",
                }:

                    district = None

            if subdistrict:

                if normalize(
                    subdistrict
                ) in {
                    "district",
                    "sub district",
                    "village",
                    "survey number",
                    "name",
                    "address",
                    "type",
                }:

                    subdistrict = None

            # ------------------------------------------------
            # DEDUPLICATE BY PLACE.
            #
            # A village can contain hundreds of survey numbers.
            # GIS only needs the village once.
            # ------------------------------------------------

            key = (
                normalize(
                    district
                ),
                normalize(
                    subdistrict
                ),
                normalize(
                    village
                ),
            )

            if key in seen:
                continue

            seen.add(
                key
            )

            output.append(
                {
                    "district":
                        district,

                    "subdistrict":
                        subdistrict,

                    "village":
                        village,

                    "source_village":
                        village_raw,

                    "survey_number":
                        survey_number,
                }
            )

    return output

# ============================================================
# PARSE CALAVIL FALLBACK
# ============================================================

def parse_calavil_villages(
    html: str,
) -> list[str]:

    soup = BeautifulSoup(
        html,
        "html.parser",
    )


    villages: list[str] = []


    for table in soup.find_all(
        "table"
    ):

        rows = table.find_all(
            "tr"
        )


        found_header = False


        for row in rows:

            cells = [
                cell.get_text(
                    " ",
                    strip=True,
                )
                for cell in row.find_all(
                    [
                        "td",
                        "th",
                    ]
                )
            ]


            if not cells:
                continue


            normalized = [
                normalize(
                    value
                )
                for value in cells
            ]


            if (
                "villages"
                in normalized
                or
                "village"
                in normalized
            ):

                found_header = True
                continue


            if not found_header:
                continue


            # Expected:
            #
            # Bhangali (110) | Added

            first = clean_village_name(
                cells[0]
            )


            if not first:
                continue


            if normalize(
                first
            ) in {
                "villages",
                "village",
                "action",
                "added",
            }:

                continue


            villages.append(
                first
            )


    unique = []

    seen = set()


    for village in villages:

        key = normalize(
            village
        )

        if key in seen:
            continue

        seen.add(
            key
        )

        unique.append(
            village
        )


    return unique


# ============================================================
# COLLECT OFFICIAL LOCATIONS
# ============================================================

def collect_official_locations(
    source_url: str,
) -> list[
    dict[str, Optional[str]]
]:

    numeric_id = (
        numeric_bhoomi_project_id(
            source_url
        )
    )


    if not numeric_id:

        print(
            "No numeric Bhoomi Rashi project ID."
        )

        return []


    project_html = fetch_public_page(
        source_url
    )


    if not project_html:
        return []


    # ========================================================
    # PRIORITY 1:
    # sdet1 = 3D detail / survey table
    # ========================================================

    sdet1_ids = (
        extract_notification_ids(
            project_html,
            "sdet1",
        )
    )


    print(
        "3D notification IDs:",
        sdet1_ids
    )


    all_locations: list[
        dict[str, Optional[str]]
    ] = []


    for notification_id in sdet1_ids:

        url = build_detail_url(
            page="sdet1",
            project_id=numeric_id,
            notification_id=notification_id,
        )


        print(
            "Reading 3D details:",
            url
        )


        html = fetch_public_page(
            url
        )


        if not html:
            continue


        locations = (
            parse_sdet1_locations(
                html
            )
        )


        print(
            "3D rows found:",
            len(locations)
        )


        all_locations.extend(
            locations
        )


    # ========================================================
    # If sdet1 successfully supplied locations,
    # use those authoritative district/subdistrict/village rows.
    # ========================================================

    if all_locations:

        return deduplicate_locations(
            all_locations
        )


    # ========================================================
    # PRIORITY 2:
    # CALA / 3A villages.
    # ========================================================

    calavil_ids = (
        extract_notification_ids(
            project_html,
            "calavil",
        )
    )


    print(
        "CALA notification IDs:",
        calavil_ids
    )


    fallback_locations = []


    for notification_id in calavil_ids:

        url = build_detail_url(
            page="calavil",
            project_id=numeric_id,
            notification_id=notification_id,
        )


        print(
            "Reading CALA:",
            url
        )


        html = fetch_public_page(
            url
        )


        if not html:
            continue


        villages = (
            parse_calavil_villages(
                html
            )
        )


        for village in villages:

            fallback_locations.append(
                {
                    "district":
                        None,

                    "subdistrict":
                        None,

                    "village":
                        village,

                    "source_village":
                        village,
                }
            )


    return deduplicate_locations(
        fallback_locations
    )


# ============================================================
# DEDUP
# ============================================================

def deduplicate_locations(
    locations: list[
        dict[str, Optional[str]]
    ],
) -> list[
    dict[str, Optional[str]]
]:

    output = []

    seen = set()


    for item in locations:

        village = clean_village_name(
            item.get(
                "village"
            )
        )


        if not village:
            continue


        key = (
            normalize(
                village
            ),
            normalize(
                item.get(
                    "subdistrict"
                )
            ),
            normalize(
                item.get(
                    "district"
                )
            ),
        )


        if key in seen:
            continue


        seen.add(
            key
        )


        output.append(
            {
                "village":
                    village,

                "source_village":
                    item.get(
                        "source_village"
                    ),

                "subdistrict":
                    clean_text(
                        item.get(
                            "subdistrict"
                        )
                    ),

                "district":
                    clean_text(
                        item.get(
                            "district"
                        )
                    ),
            }
        )


    return output


# ============================================================
# MAPTILER FEATURE HELPERS
# ============================================================

def feature_center(
    feature: dict[str, Any],
) -> Optional[
    tuple[float, float]
]:

    center = feature.get(
        "center"
    )


    if not (
        isinstance(
            center,
            list,
        )
        and len(center) >= 2
    ):

        geometry = feature.get(
            "geometry",
            {},
        )


        if (
            geometry.get(
                "type"
            )
            == "Point"
        ):

            center = geometry.get(
                "coordinates"
            )


    if not (
        isinstance(
            center,
            list,
        )
        and len(center) >= 2
    ):

        return None


    try:

        longitude = float(
            center[0]
        )

        latitude = float(
            center[1]
        )

    except (
        TypeError,
        ValueError,
    ):

        return None


    if not (
        -90 <= latitude <= 90
        and
        -180 <= longitude <= 180
    ):

        return None


    return (
        latitude,
        longitude,
    )


def maptiler_feature_text(
    feature: dict[str, Any],
) -> str:

    values = [
        feature.get(
            "text",
            ""
        ),

        feature.get(
            "place_name",
            ""
        ),
    ]


    context = feature.get(
        "context",
        []
    )


    if isinstance(
        context,
        list,
    ):

        for item in context:

            if isinstance(
                item,
                dict,
            ):

                values.append(
                    item.get(
                        "text",
                        ""
                    )
                )


    return " ".join(
        str(value)
        for value in values
        if value
    )


def feature_is_poi(
    feature: dict[str, Any],
) -> bool:

    identifier = str(
        feature.get(
            "id",
            ""
        )
    ).lower()


    if identifier.startswith(
        "poi."
    ):

        return True


    if identifier.startswith(
        "address."
    ):

        return True


    properties = feature.get(
        "properties",
        {},
    )


    kind = normalize(
        properties.get(
            "kind"
        )
    )


    if kind in {
        "poi",
        "shop",
        "office",
        "bank",
        "restaurant",
        "hotel",
        "hospital",
    }:

        return True


    return False


# ============================================================
# MAPTILER GEOCODE
# ============================================================

def maptiler_geocode(
    *,
    village: str,
    subdistrict: Optional[str],
    district: Optional[str],
    state: Optional[str],
    api_key: str,
) -> Optional[
    dict[str, Any]
]:

    components = [
        village
    ]


    if subdistrict:

        components.append(
            subdistrict
        )


    if district:

        components.append(
            district
        )


    if state:

        components.append(
            state
        )


    components.append(
        "India"
    )


    query = ", ".join(
        components
    )


    print(
        "Geocoding:",
        query
    )


    url = (
        "https://api.maptiler.com/"
        f"geocoding/{quote(query, safe='')}.json"
    )


    try:

        response = requests.get(
            url,
            params={
                "key":
                    api_key,

                "limit":
                    5,

                "language":
                    "en",
            },
            headers=HEADERS,
            timeout=MAPTILER_TIMEOUT,
        )

    except requests.RequestException as exc:

        print(
            "MapTiler request failed:",
            exc
        )

        return None


    time.sleep(
        MAPTILER_DELAY
    )


    if response.status_code != 200:

        print(
            "MapTiler HTTP:",
            response.status_code
        )

        return None


    try:

        payload = response.json()

    except Exception:

        return None


    features = payload.get(
        "features",
        []
    )


    if not isinstance(
        features,
        list,
    ):

        return None


    village_norm = normalize(
        village
    )


    district_norm = normalize(
        district
    )


    state_norm = normalize_state(
        state
    )


    for feature in features:

        if not isinstance(
            feature,
            dict,
        ):
            continue


        if feature_is_poi(
            feature
        ):
            continue


        center = feature_center(
            feature
        )


        if not center:
            continue


        feature_text = normalize(
            maptiler_feature_text(
                feature
            )
        )


        # Village/locality name must occur in
        # returned location context.
        if village_norm not in feature_text:

            continue


        # If official district is known,
        # prefer/require it in result text.
        if (
            district_norm
            and district_norm
            not in feature_text
        ):

            continue


        # State validation.
        if state_norm:

            returned_state_match = False


            for alias_candidate in {
                state_norm,
                normalize(
                    state
                ),
            }:

                if (
                    alias_candidate
                    and alias_candidate
                    in feature_text
                ):

                    returned_state_match = True

                    break


            if not returned_state_match:

                continue


        latitude, longitude = (
            center
        )


        return {
            "village":
                village,

            "latitude":
                latitude,

            "longitude":
                longitude,

            "display_name":
                (
                    feature.get(
                        "place_name"
                    )
                    or
                    feature.get(
                        "text"
                    )
                    or
                    village
                ),
        }


    return None


# ============================================================
# REPRESENTATIVE LOCATION
# ============================================================

def representative_point(
    points: list[
        dict[str, Any]
    ],
) -> tuple[
    float,
    float,
]:

    latitude = sum(
        item[
            "latitude"
        ]
        for item in points
    ) / len(points)


    longitude = sum(
        item[
            "longitude"
        ]
        for item in points
    ) / len(points)


    return (
        latitude,
        longitude,
    )


# ============================================================
# RESULT LOG
# ============================================================

def log_result(
    *,
    project_id: str,
    status: str,
    official_rows: int = 0,
    geocoded_rows: int = 0,
    latitude: str = "",
    longitude: str = "",
    detail: str = "",
) -> None:

    exists = (
        RESULTS_CSV.exists()
    )


    with RESULTS_CSV.open(
        "a",
        newline="",
        encoding="utf-8",
    ) as handle:

        writer = csv.writer(
            handle
        )


        if not exists:

            writer.writerow(
                [
                    "project_id",
                    "status",
                    "official_rows",
                    "geocoded_rows",
                    "latitude",
                    "longitude",
                    "detail",
                ]
            )


        writer.writerow(
            [
                project_id,
                status,
                official_rows,
                geocoded_rows,
                latitude,
                longitude,
                detail,
            ]
        )


# ============================================================
# SAVE
# ============================================================

def save_project(
    db,
    project: Project,
    points: list[
        dict[str, Any]
    ],
) -> None:

    latitude, longitude = (
        representative_point(
            points
        )
    )


    accuracy = (
        "CORRIDOR"
        if len(points) >= 2
        else
        "LOCALITY_APPROX"
    )


    confidence = (
        0.92
        if len(points) >= 3
        else
        0.88
        if len(points) == 2
        else
        0.82
    )


    print()
    print(
        "REPRESENTATIVE LOCATION:"
    )

    print(
        "Latitude :",
        latitude
    )

    print(
        "Longitude:",
        longitude
    )

    print(
        "Accuracy :",
        accuracy
    )


    if DRY_RUN:

        print(
            "DRY RUN -> NOT SAVED"
        )

        return


    project.latitude = (
        latitude
    )

    project.longitude = (
        longitude
    )


    project.gis_status = (
        "MAPPED"
    )


    project.location_accuracy = (
        accuracy
    )


    project.location_source = (
        "Bhoomi Rashi 3D notification "
        "+ MapTiler Geocoding"
    )


    project.geocode_confidence = (
        confidence
    )


    # This is still NOT the actual
    # road alignment/polyline.
    project.route_geometry = None


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
# PROCESS PROJECT
# ============================================================

def process_project(
    db,
    project: Project,
    api_key: str,
) -> str:

    print()
    print(
        "=" * 90
    )

    print(
        "PROJECT:",
        project.project_id
    )

    print(
        "STATE:",
        project.state
    )

    print(
        "DISTRICT:",
        project.district
    )

    print(
        "NAME:",
        (
            project.project_name[:200]
            if project.project_name
            else ""
        )
    )


    source_url = (
        source_url_for_project(
            project
        )
    )


    if not source_url:

        print(
            "No supported source URL."
        )

        return "unresolved"


    print(
        "SOURCE:",
        source_url
    )


    locations = (
        collect_official_locations(
            source_url
        )
    )


    print(
        "Official location rows:",
        len(locations)
    )


    if not locations:

        log_result(
            project_id=
                str(
                    project.project_id
                ),

            status=
                "NO_OFFICIAL_LOCATION",
        )

        return "unresolved"


    for location in locations:

        print(
            "OFFICIAL:",
            location.get(
                "district"
            ),
            "|",
            location.get(
                "subdistrict"
            ),
            "|",
            location.get(
                "village"
            ),
        )


    locations = locations[
        :MAX_VILLAGES_PER_PROJECT
    ]


    resolved = []


    for location in locations:

        state = clean_text(
            project.state
        )


        district = (
            location.get(
                "district"
            )
            or
            clean_text(
                project.district
            )
        )


        result = maptiler_geocode(
            village=
                location[
                    "village"
                ],

            subdistrict=
                location.get(
                    "subdistrict"
                ),

            district=
                district,

            state=
                state,

            api_key=
                api_key,
        )


        if result:

            print(
                "VALID:",
                result[
                    "display_name"
                ]
            )


            resolved.append(
                result
            )

        else:

            print(
                "UNRESOLVED:",
                location[
                    "village"
                ]
            )


    print(
        "Validated official places:",
        len(resolved)
    )


    if not resolved:

        log_result(
            project_id=
                str(
                    project.project_id
                ),

            status=
                "GEOCODE_FAILED",

            official_rows=
                len(locations),
        )

        return "unresolved"


    latitude, longitude = (
        representative_point(
            resolved
        )
    )


    save_project(
        db,
        project,
        resolved,
    )


    log_result(
        project_id=
            str(
                project.project_id
            ),

        status=
            (
                "DRY_RUN_RESOLVED"
                if DRY_RUN
                else
                "RESOLVED"
            ),

        official_rows=
            len(locations),

        geocoded_rows=
            len(resolved),

        latitude=
            str(
                latitude
            ),

        longitude=
            str(
                longitude
            ),

        detail=
            "Bhoomi Rashi official "
            "notification location data",
    )


    return "resolved"


# ============================================================
# SELECT ONLY UNMAPPED SOURCE-BACKED PROJECTS
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
        .filter(
            Project.notes.isnot(
                None
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
        "=" * 90
    )

    print(
        "ACQUITWIN GIS PASS 3 V2"
    )

    print(
        "BHOOMI RASHI NOTIFICATION ENRICHMENT"
    )

    print(
        "=" * 90
    )


    print(
        "DRY_RUN:",
        DRY_RUN
    )

    print(
        "MAX_PROJECTS:",
        MAX_PROJECTS
    )


    api_key = (
        get_maptiler_key()
    )


    print(
        "MapTiler key loaded: YES"
    )


    db = SessionLocal()


    resolved = 0
    unresolved = 0
    errors = 0


    try:

        projects = get_projects(
            db
        )


        print(
            "Projects selected:",
            len(projects)
        )


        for index, project in enumerate(
            projects,
            start=1,
        ):

            print()
            print(
                f"[{index}/{len(projects)}]"
            )


            try:

                status = process_project(
                    db,
                    project,
                    api_key,
                )


                if status == "resolved":

                    resolved += 1

                else:

                    unresolved += 1


            except KeyboardInterrupt:

                print(
                    "Stopped by user."
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
                    project_id=
                        str(
                            project.project_id
                        ),

                    status=
                        "ERROR",

                    detail=
                        str(exc),
                )


    finally:

        db.close()


    print()
    print(
        "=" * 90
    )

    print(
        "PASS 3 V2 COMPLETE"
    )

    print(
        "=" * 90
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
        "Results    :",
        RESULTS_CSV
    )


    if DRY_RUN:

        print(
            "DATABASE WAS NOT MODIFIED."
        )


if __name__ == "__main__":
    main()