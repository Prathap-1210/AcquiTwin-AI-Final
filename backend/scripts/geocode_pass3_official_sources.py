from __future__ import annotations

import csv
import json
import math
import os
import re
import sys
import time
from pathlib import Path
from typing import Any, Optional
from urllib.parse import quote, urlparse

import requests
from bs4 import BeautifulSoup


# ============================================================
# BACKEND IMPORT PATH
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

# Start very small.
MAX_PROJECTS: Optional[int] = 20

# Maximum villages/localities geocoded from one project.
MAX_LOCATIONS_PER_PROJECT = 8

SOURCE_TIMEOUT = 30
MAPTILER_TIMEOUT = 30

# Prevent aggressive requests to the official portal.
SOURCE_REQUEST_DELAY = 1.0

SCRIPT_DIR = Path(__file__).resolve().parent

RESULTS_CSV = (
    SCRIPT_DIR
    / "geocode_pass3_official_sources_results.csv"
)


# ============================================================
# REQUEST HEADERS
# ============================================================

SOURCE_HEADERS = {
    "User-Agent": (
        "AcquiTwinAI/1.0 "
        "student-research GIS-enrichment"
    )
}

MAPTILER_HEADERS = {
    "User-Agent": (
        "AcquiTwinAI/1.0 "
        "student-research GIS-enrichment"
    )
}


# ============================================================
# ALLOWED OFFICIAL SOURCES
# ============================================================

ALLOWED_BHOOMI_HOSTS = {
    "bhoomirashi.gov.in",
    "www.bhoomirashi.gov.in",
}


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
# GENERIC HELPERS
# ============================================================

def clean_text(
    value: Any,
) -> Optional[str]:

    if value is None:
        return None

    text = str(value).strip()

    if not text:
        return None

    if text.lower() in {
        "none",
        "null",
        "nan",
        "unknown",
        "not recorded",
    }:
        return None

    return text


def normalize(
    value: Any,
) -> str:

    if value is None:
        return ""

    text = str(value).lower()

    text = text.replace(
        "&",
        " and ",
    )

    text = re.sub(
        r"[^a-z0-9]+",
        " ",
        text,
    )

    text = re.sub(
        r"\s+",
        " ",
        text,
    )

    return text.strip()


def normalize_state(
    value: Any,
) -> str:

    text = normalize(
        value
    )

    return STATE_ALIASES.get(
        text,
        text,
    )


def unique_strings(
    values: list[str],
) -> list[str]:

    output = []
    seen = set()

    for value in values:

        value = clean_place(
            value
        )

        if not value:
            continue

        key = normalize(
            value
        )

        if not key:
            continue

        if key in seen:
            continue

        seen.add(
            key
        )

        output.append(
            value
        )

    return output


# ============================================================
# MAPTILER KEY
# ============================================================

def parse_env_file(
    path: Path,
) -> dict[str, str]:

    values: dict[str, str] = {}

    if not path.exists():
        return values

    try:

        content = path.read_text(
            encoding="utf-8",
        )

    except Exception:
        return values


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

        key = key.strip()

        value = (
            value
            .strip()
            .strip('"')
            .strip("'")
        )

        values[
            key
        ] = value

    return values


def get_maptiler_key() -> str:

    # First preference:
    # environment variable.

    direct = clean_text(
        os.getenv(
            "MAPTILER_KEY"
        )
    )

    if direct:
        return direct


    # Backend .env
    backend_env = parse_env_file(
        BACKEND_DIR
        / ".env"
    )

    for key_name in (
        "MAPTILER_KEY",
        "VITE_MAPTILER_KEY",
    ):

        value = clean_text(
            backend_env.get(
                key_name
            )
        )

        if value:
            return value


    # Your frontend already contains
    # VITE_MAPTILER_KEY.
    frontend_env = parse_env_file(
        PROJECT_ROOT
        / "frontend"
        / ".env"
    )

    value = clean_text(
        frontend_env.get(
            "VITE_MAPTILER_KEY"
        )
    )

    if value:
        return value


    raise RuntimeError(
        "MapTiler API key not found. "
        "Expected MAPTILER_KEY in the environment "
        "or VITE_MAPTILER_KEY in frontend/.env."
    )


# ============================================================
# NOTES / SOURCE URL
# ============================================================

def parse_notes(
    notes: Any,
) -> dict[str, Any]:

    if notes is None:
        return {}

    if isinstance(
        notes,
        dict,
    ):
        return dict(
            notes
        )


    raw = str(
        notes
    ).strip()

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


    output: dict[str, Any] = {}


    url_match = re.search(
        r"https?://[^\s\"'}]+",
        raw,
        flags=re.IGNORECASE,
    )

    if url_match:

        output[
            "source_url"
        ] = url_match.group(0)


    return output


def extract_source_url(
    project: Project,
) -> Optional[str]:

    notes = parse_notes(
        getattr(
            project,
            "notes",
            None,
        )
    )

    source_url = clean_text(
        notes.get(
            "source_url"
        )
    )

    if not source_url:
        return None


    try:

        parsed = urlparse(
            source_url
        )

    except Exception:
        return None


    hostname = (
        parsed.hostname
        or ""
    ).lower()


    if hostname not in ALLOWED_BHOOMI_HOSTS:
        return None


    if parsed.scheme not in {
        "http",
        "https",
    }:
        return None


    return source_url


# ============================================================
# OFFICIAL SOURCE FETCH
# ============================================================

def fetch_source_page(
    source_url: str,
) -> tuple[
    Optional[str],
    str,
]:

    try:

        response = requests.get(
            source_url,
            headers=SOURCE_HEADERS,
            timeout=SOURCE_TIMEOUT,
            allow_redirects=True,
        )

    except requests.RequestException as exc:

        return (
            None,
            f"REQUEST_ERROR: {exc}",
        )


    # Never silently follow to an unrelated domain.
    final_host = (
        urlparse(
            response.url
        ).hostname
        or ""
    ).lower()


    if final_host not in ALLOWED_BHOOMI_HOSTS:

        return (
            None,
            "UNEXPECTED_REDIRECT",
        )


    if response.status_code != 200:

        return (
            None,
            f"HTTP_{response.status_code}",
        )


    html = response.text


    if not html.strip():

        return (
            None,
            "EMPTY_RESPONSE",
        )


    text_lower = html.lower()


    if (
        "site is under maintenance"
        in text_lower
    ):

        return (
            None,
            "SOURCE_MAINTENANCE",
        )


    time.sleep(
        SOURCE_REQUEST_DELAY
    )


    return (
        html,
        "OK",
    )


# ============================================================
# CLEAN LOCATION STRING
# ============================================================

def clean_place(
    value: Any,
) -> Optional[str]:

    value = clean_text(
        value
    )

    if not value:
        return None


    value = re.sub(
        r"\s+",
        " ",
        value,
    ).strip()


    value = value.strip(
        " :;,-|()[]{}"
    )


    # Reject obvious labels rather than values.
    normalized = normalize(
        value
    )


    bad_exact = {
        "village",
        "village name",
        "district",
        "district name",
        "state",
        "state name",
        "tehsil",
        "taluka",
        "sub district",
        "subdistrict",
        "location",
        "name",
        "select",
        "na",
        "nil",
    }


    if normalized in bad_exact:
        return None


    # Reject very long prose.
    if len(value) > 80:
        return None


    # Reject numeric-only values.
    if re.fullmatch(
        r"[\d\s./+-]+",
        value,
    ):
        return None


    # For this pass, prefer Latin-script
    # place names for more reliable geocoding.
    if not re.search(
        r"[A-Za-z]",
        value,
    ):
        return None


    return value


# ============================================================
# SOURCE TABLE EXTRACTION
# ============================================================

def header_index(
    headers: list[str],
    keywords: tuple[str, ...],
) -> Optional[int]:

    for index, header in enumerate(
        headers
    ):

        normalized = normalize(
            header
        )

        for keyword in keywords:

            if keyword in normalized:
                return index

    return None


def extract_locations_from_tables(
    soup: BeautifulSoup,
) -> list[dict[str, Optional[str]]]:

    locations: list[
        dict[str, Optional[str]]
    ] = []


    for table in soup.find_all(
        "table"
    ):

        rows: list[
            list[str]
        ] = []


        for tr in table.find_all(
            "tr"
        ):

            cells = [
                cell.get_text(
                    " ",
                    strip=True,
                )
                for cell in tr.find_all(
                    [
                        "th",
                        "td",
                    ]
                )
            ]

            cells = [
                cell
                for cell in cells
                if cell.strip()
            ]

            if cells:
                rows.append(
                    cells
                )


        if not rows:
            continue


        # ----------------------------------------------------
        # Find table header containing Village.
        # ----------------------------------------------------

        header_row_index = None
        village_index = None
        district_index = None
        state_index = None
        subdistrict_index = None


        for row_index, row in enumerate(
            rows
        ):

            normalized_row = [
                normalize(
                    item
                )
                for item in row
            ]


            candidate_village = (
                header_index(
                    normalized_row,
                    (
                        "village",
                        "village name",
                        "revenue village",
                        "mouza",
                    ),
                )
            )


            if candidate_village is None:
                continue


            header_row_index = (
                row_index
            )

            village_index = (
                candidate_village
            )


            district_index = (
                header_index(
                    normalized_row,
                    (
                        "district",
                        "district name",
                    ),
                )
            )


            state_index = (
                header_index(
                    normalized_row,
                    (
                        "state",
                        "state name",
                    ),
                )
            )


            subdistrict_index = (
                header_index(
                    normalized_row,
                    (
                        "sub district",
                        "subdistrict",
                        "tehsil",
                        "taluka",
                        "taluk",
                    ),
                )
            )


            break


        if (
            header_row_index
            is not None
            and village_index
            is not None
        ):

            for row in rows[
                header_row_index + 1:
            ]:

                if (
                    village_index
                    >= len(row)
                ):
                    continue


                village = clean_place(
                    row[
                        village_index
                    ]
                )


                if not village:
                    continue


                district = None
                state = None
                subdistrict = None


                if (
                    district_index
                    is not None
                    and district_index
                    < len(row)
                ):

                    district = clean_place(
                        row[
                            district_index
                        ]
                    )


                if (
                    state_index
                    is not None
                    and state_index
                    < len(row)
                ):

                    state = clean_place(
                        row[
                            state_index
                        ]
                    )


                if (
                    subdistrict_index
                    is not None
                    and subdistrict_index
                    < len(row)
                ):

                    subdistrict = clean_place(
                        row[
                            subdistrict_index
                        ]
                    )


                locations.append(
                    {
                        "village":
                            village,

                        "subdistrict":
                            subdistrict,

                        "district":
                            district,

                        "state":
                            state,
                    }
                )


        # ----------------------------------------------------
        # Also handle simple label/value rows:
        #
        # Village | Khushalpur
        # District | Banka
        # ----------------------------------------------------

        for row in rows:

            if len(row) < 2:
                continue


            label = normalize(
                row[0]
            )


            if (
                label in {
                    "village",
                    "village name",
                    "revenue village",
                    "mouza",
                }
            ):

                village = clean_place(
                    row[1]
                )

                if village:

                    locations.append(
                        {
                            "village":
                                village,

                            "subdistrict":
                                None,

                            "district":
                                None,

                            "state":
                                None,
                        }
                    )


    return locations


# ============================================================
# SOURCE TEXT EXTRACTION FALLBACK
# ============================================================

def extract_locations_from_text(
    soup: BeautifulSoup,
) -> list[
    dict[str, Optional[str]]
]:

    text = soup.get_text(
        "\n",
        strip=True,
    )


    results: list[
        dict[str, Optional[str]]
    ] = []


    patterns = [
        (
            r"(?:Village Name|Village|Revenue Village|Mouza)"
            r"\s*[:\-]\s*"
            r"([A-Za-z][A-Za-z .'-]{2,60})"
        ),
    ]


    for pattern in patterns:

        for match in re.finditer(
            pattern,
            text,
            flags=re.IGNORECASE,
        ):

            village = clean_place(
                match.group(1)
            )


            if not village:
                continue


            results.append(
                {
                    "village":
                        village,

                    "subdistrict":
                        None,

                    "district":
                        None,

                    "state":
                        None,
                }
            )


    return results


# ============================================================
# DEDUP SOURCE LOCATIONS
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


    for location in locations:

        village = clean_place(
            location.get(
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
                location.get(
                    "district"
                )
            ),
            normalize(
                location.get(
                    "state"
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

                "subdistrict":
                    clean_place(
                        location.get(
                            "subdistrict"
                        )
                    ),

                "district":
                    clean_place(
                        location.get(
                            "district"
                        )
                    ),

                "state":
                    clean_place(
                        location.get(
                            "state"
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


    if (
        not isinstance(
            center,
            list,
        )
        or len(center) < 2
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


    if (
        not isinstance(
            center,
            list,
        )
        or len(center) < 2
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


def feature_country_code(
    feature: dict[str, Any],
) -> str:

    properties = feature.get(
        "properties",
        {},
    )

    code = (
        properties.get(
            "country_code"
        )
        or feature.get(
            "country_code"
        )
        or ""
    )

    return normalize(
        code
    )


def feature_region(
    feature: dict[str, Any],
) -> Optional[str]:

    # Feature itself may be a region.
    feature_id = str(
        feature.get(
            "id",
            ""
        )
    ).lower()


    if feature_id.startswith(
        "region."
    ):

        value = clean_text(
            feature.get(
                "text"
            )
        )

        if value:
            return value


    context = feature.get(
        "context",
        []
    )


    if isinstance(
        context,
        list,
    ):

        for item in context:

            if not isinstance(
                item,
                dict,
            ):
                continue


            item_id = str(
                item.get(
                    "id",
                    ""
                )
            ).lower()


            if item_id.startswith(
                "region."
            ):

                value = clean_text(
                    item.get(
                        "text"
                    )
                )

                if value:
                    return value


    return None


def feature_name_text(
    feature: dict[str, Any],
) -> str:

    return " ".join(
        filter(
            None,
            [
                str(
                    feature.get(
                        "text",
                        ""
                    )
                ),

                str(
                    feature.get(
                        "place_name",
                        ""
                    )
                ),
            ],
        )
    )


def is_non_place_feature(
    feature: dict[str, Any],
) -> bool:

    feature_id = str(
        feature.get(
            "id",
            ""
        )
    ).lower()


    prefix = (
        feature_id.split(
            ".",
            1,
        )[0]
    )


    # Do not resolve a village name to
    # a bank, shop, address, etc.
    rejected_prefixes = {
        "poi",
        "address",
    }


    if prefix in rejected_prefixes:
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
        "restaurant",
        "hotel",
        "shop",
        "office",
        "bank",
        "hospital",
    }:
        return True


    return False


def place_matches_feature(
    place: str,
    feature: dict[str, Any],
) -> bool:

    expected = normalize(
        place
    )

    returned = normalize(
        feature_name_text(
            feature
        )
    )


    if not expected:
        return False


    if expected in returned:
        return True


    expected_tokens = set(
        expected.split()
    )

    returned_tokens = set(
        returned.split()
    )


    if not expected_tokens:
        return False


    overlap = len(
        expected_tokens
        &
        returned_tokens
    )


    ratio = (
        overlap
        /
        len(
            expected_tokens
        )
    )


    return ratio >= 0.8


# ============================================================
# MAPTILER GEOCODING
# ============================================================

def maptiler_geocode(
    place: str,
    *,
    state: Optional[str],
    district: Optional[str],
    api_key: str,
) -> Optional[
    dict[str, Any]
]:

    query_parts = [
        place
    ]


    if district:

        query_parts.append(
            district
        )


    if state:

        query_parts.append(
            state
        )


    query_parts.append(
        "India"
    )


    query = ", ".join(
        query_parts
    )


    encoded = quote(
        query,
        safe="",
    )


    url = (
        "https://api.maptiler.com/"
        f"geocoding/{encoded}.json"
    )


    params = {
        "key":
            api_key,

        "limit":
            5,

        "language":
            "en",
    }


    print(
        "Geocoding:",
        query,
    )


    try:

        response = requests.get(
            url,
            params=params,
            headers=MAPTILER_HEADERS,
            timeout=MAPTILER_TIMEOUT,
        )

    except requests.RequestException as exc:

        print(
            "MapTiler error:",
            exc,
        )

        return None


    if response.status_code == 403:

        raise RuntimeError(
            "MapTiler returned 403. "
            "Check the API key or key restrictions."
        )


    if response.status_code != 200:

        print(
            "MapTiler HTTP:",
            response.status_code,
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


    for feature in features:

        if not isinstance(
            feature,
            dict,
        ):
            continue


        if is_non_place_feature(
            feature
        ):
            continue


        center = feature_center(
            feature
        )


        if not center:
            continue


        country_code = feature_country_code(
            feature
        )


        if (
            country_code
            and country_code != "in"
        ):
            continue


        returned_state = feature_region(
            feature
        )


        if (
            state
            and returned_state
            and normalize_state(
                state
            )
            != normalize_state(
                returned_state
            )
        ):

            continue


        if not place_matches_feature(
            place,
            feature,
        ):
            continue


        latitude, longitude = center


        return {
            "place":
                place,

            "latitude":
                latitude,

            "longitude":
                longitude,

            "state":
                returned_state,

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
                    place
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


    p1 = math.radians(
        lat1
    )

    p2 = math.radians(
        lat2
    )


    delta_lat = math.radians(
        lat2 - lat1
    )

    delta_lon = math.radians(
        lon2 - lon1
    )


    a = (
        math.sin(
            delta_lat / 2
        ) ** 2
        +
        math.cos(p1)
        *
        math.cos(p2)
        *
        math.sin(
            delta_lon / 2
        ) ** 2
    )


    return (
        2
        *
        radius
        *
        math.asin(
            math.sqrt(a)
        )
    )


def max_distance_between_points(
    points: list[
        dict[str, Any]
    ],
) -> float:

    maximum = 0.0


    for i in range(
        len(points)
    ):

        for j in range(
            i + 1,
            len(points),
        ):

            distance = haversine_km(
                points[i][
                    "latitude"
                ],
                points[i][
                    "longitude"
                ],
                points[j][
                    "latitude"
                ],
                points[j][
                    "longitude"
                ],
            )


            maximum = max(
                maximum,
                distance,
            )


    return maximum


# ============================================================
# REPRESENTATIVE LOCATION
# ============================================================

def representative_location(
    points: list[
        dict[str, Any]
    ],
) -> tuple[
    float,
    float,
]:

    latitude = sum(
        point[
            "latitude"
        ]
        for point in points
    ) / len(points)


    longitude = sum(
        point[
            "longitude"
        ]
        for point in points
    ) / len(points)


    return (
        latitude,
        longitude,
    )


# ============================================================
# CSV LOG
# ============================================================

def log_result(
    *,
    project_id: str,
    status: str,
    source_url: str = "",
    extracted: int = 0,
    resolved: int = 0,
    latitude: str = "",
    longitude: str = "",
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
                    "source_url",
                    "extracted_locations",
                    "resolved_locations",
                    "latitude",
                    "longitude",
                    "detail",
                ]
            )


        writer.writerow(
            [
                project_id,
                status,
                source_url,
                extracted,
                resolved,
                latitude,
                longitude,
                detail,
            ]
        )


# ============================================================
# SAVE PROJECT
# ============================================================

def save_project_gis(
    db,
    project: Project,
    points: list[
        dict[str, Any]
    ],
) -> None:

    latitude, longitude = (
        representative_location(
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
        0.90
        if len(points) >= 3
        else
        0.85
        if len(points) == 2
        else
        0.78
    )


    print(
        "\nREPRESENTATIVE GIS LOCATION"
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

    print(
        "Locations:",
        len(points)
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
        "Bhoomi Rashi public source "
        "+ MapTiler Geocoding"
    )


    project.geocode_confidence = (
        confidence
    )


    # This still does NOT represent
    # exact road alignment.
    project.route_geometry = None


    db.add(
        project
    )

    db.commit()

    db.refresh(
        project
    )


    print(
        "SAVED TO DATABASE"
    )


# ============================================================
# PROCESS PROJECT
# ============================================================

def process_project(
    db,
    project: Project,
    api_key: str,
) -> str:

    project_id = str(
        project.project_id
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
        "NAME:",
        (
            project.project_name[:180]
            if project.project_name
            else ""
        )
    )

    print(
        "STATE:",
        project.state
    )

    print(
        "DISTRICT:",
        project.district
    )


    source_url = extract_source_url(
        project
    )


    if not source_url:

        print(
            "No supported Bhoomi Rashi source URL."
        )

        log_result(
            project_id=
                project_id,

            status=
                "NO_SOURCE",
        )

        return "unresolved"


    print(
        "SOURCE:",
        source_url
    )


    html, fetch_status = (
        fetch_source_page(
            source_url
        )
    )


    if not html:

        print(
            "Source unavailable:",
            fetch_status
        )

        log_result(
            project_id=
                project_id,

            status=
                fetch_status,

            source_url=
                source_url,
        )

        return "unresolved"


    soup = BeautifulSoup(
        html,
        "html.parser",
    )


    table_locations = (
        extract_locations_from_tables(
            soup
        )
    )


    text_locations = (
        extract_locations_from_text(
            soup
        )
    )


    locations = (
        deduplicate_locations(
            table_locations
            +
            text_locations
        )
    )


    print(
        "Official locations extracted:",
        len(locations)
    )


    if not locations:

        print(
            "No village/locality evidence "
            "found on public source page."
        )

        log_result(
            project_id=
                project_id,

            status=
                "NO_LOCATION_DATA",

            source_url=
                source_url,
        )

        return "unresolved"


    # Limit API usage while preserving
    # several affected locations.
    locations = locations[
        :MAX_LOCATIONS_PER_PROJECT
    ]


    resolved_points: list[
        dict[str, Any]
    ] = []


    for location in locations:

        village = location[
            "village"
        ]


        state = (
            location.get(
                "state"
            )
            or
            clean_text(
                project.state
            )
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
            village,
            state=
                state,

            district=
                district,

            api_key=
                api_key,
        )


        if not result:

            print(
                "UNRESOLVED PLACE:",
                village
            )

            continue


        print(
            "VALID PLACE:",
            result[
                "display_name"
            ]
        )


        resolved_points.append(
            result
        )


    print(
        "Resolved official locations:",
        len(
            resolved_points
        )
    )


    if not resolved_points:

        log_result(
            project_id=
                project_id,

            status=
                "GEOCODING_FAILED",

            source_url=
                source_url,

            extracted=
                len(
                    locations
                ),
        )

        return "unresolved"


    # ========================================================
    # SAFETY CHECK:
    # source locations should form a sensible geographic group.
    # ========================================================

    if len(
        resolved_points
    ) >= 2:

        maximum_distance = (
            max_distance_between_points(
                resolved_points
            )
        )


        print(
            "Maximum source spread:",
            f"{maximum_distance:.1f} km"
        )


        # If locations are scattered over a huge
        # distance, do not automatically map.
        if maximum_distance > 500:

            print(
                "REJECTED: official locations "
                "are geographically inconsistent."
            )


            log_result(
                project_id=
                    project_id,

                status=
                    "NEEDS_REVIEW",

                source_url=
                    source_url,

                extracted=
                    len(
                        locations
                    ),

                resolved=
                    len(
                        resolved_points
                    ),

                detail=
                    (
                        "Resolved locations spread "
                        f"{maximum_distance:.1f} km"
                    ),
            )


            return "unresolved"


    latitude, longitude = (
        representative_location(
            resolved_points
        )
    )


    save_project_gis(
        db,
        project,
        resolved_points,
    )


    log_result(
        project_id=
            project_id,

        status=
            (
                "DRY_RUN_RESOLVED"
                if DRY_RUN
                else
                "RESOLVED"
            ),

        source_url=
            source_url,

        extracted=
            len(
                locations
            ),

        resolved=
            len(
                resolved_points
            ),

        latitude=
            str(
                latitude
            ),

        longitude=
            str(
                longitude
            ),

        detail=
            (
                "Bhoomi Rashi public "
                "location evidence"
            ),
    )


    return "resolved"


# ============================================================
# GET ONLY UNRESOLVED PROJECTS WITH SOURCE
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
        "\n"
        + "=" * 80
    )

    print(
        "ACQUITWIN GIS PASS 3"
    )

    print(
        "OFFICIAL-SOURCE ENRICHMENT"
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


    api_key = (
        get_maptiler_key()
    )


    print(
        "MapTiler key loaded: YES"
    )


    db = SessionLocal()


    try:

        projects = get_projects(
            db
        )


        print(
            "Projects selected:",
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

                status = (
                    process_project(
                        db,
                        project,
                        api_key,
                    )
                )


                if status == "resolved":

                    resolved += 1

                else:

                    unresolved += 1


            except KeyboardInterrupt:

                print(
                    "\nStopped by user."
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


        print(
            "\n"
            + "=" * 80
        )

        print(
            "PASS 3 COMPLETE"
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