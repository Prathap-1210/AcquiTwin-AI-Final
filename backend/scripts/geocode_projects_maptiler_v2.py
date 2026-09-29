from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
import time

from difflib import SequenceMatcher
from pathlib import Path
from typing import Any
from urllib.parse import quote

import requests
from sqlalchemy import or_, select


# ============================================================
# MAKE BACKEND IMPORTABLE
# ============================================================

BACKEND_ROOT = Path(__file__).resolve().parents[1]

if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(
        0,
        str(BACKEND_ROOT),
    )

from app.database.session import SessionLocal
from app.model.project import Project


# ============================================================
# CONFIG
# ============================================================

MAPTILER_KEY = os.getenv(
    "MAPTILER_API_KEY",
    "",
).strip()

if not MAPTILER_KEY:
    raise RuntimeError(
        "MAPTILER_API_KEY is not configured."
    )


MAPTILER_URL = (
    "https://api.maptiler.com/geocoding"
)

REQUEST_TIMEOUT = 20


CACHE_DIR = (
    Path(__file__).resolve().parent
    / ".geocode_cache"
)

CACHE_DIR.mkdir(
    parents=True,
    exist_ok=True,
)

CACHE_FILE = (
    CACHE_DIR
    / "maptiler_v2_results.json"
)


# ============================================================
# INDIAN STATES / UTs
# ============================================================

INDIAN_STATES = [
    "Andhra Pradesh",
    "Arunachal Pradesh",
    "Assam",
    "Bihar",
    "Chhattisgarh",
    "Goa",
    "Gujarat",
    "Haryana",
    "Himachal Pradesh",
    "Jharkhand",
    "Karnataka",
    "Kerala",
    "Madhya Pradesh",
    "Maharashtra",
    "Manipur",
    "Meghalaya",
    "Mizoram",
    "Nagaland",
    "Odisha",
    "Punjab",
    "Rajasthan",
    "Sikkim",
    "Tamil Nadu",
    "Telangana",
    "Tripura",
    "Uttar Pradesh",
    "Uttarakhand",
    "West Bengal",
    "Andaman and Nicobar Islands",
    "Chandigarh",
    "Dadra and Nagar Haveli and Daman and Diu",
    "Delhi",
    "Jammu and Kashmir",
    "Ladakh",
    "Lakshadweep",
    "Puducherry",
]


# ============================================================
# COMMON SOURCE SPELLING VARIANTS
# ============================================================

ALIASES = {
    "koksara": [
        "Kokasara",
    ],

    "bolangir": [
        "Balangir",
    ],

    "sonepur": [
        "Subarnapur",
        "Sonapur",
    ],

    "rameshwaram": [
        "Rameswaram",
    ],

    "atchampathu": [
        "Achampathu",
    ],

    "viratipathu": [
        "Virattipathu",
        "Virattipattu",
    ],

    "bodi": [
        "Bodinayakkanur",
        "Bodinayakanur",
    ],

    "fathehpur": [
        "Fatehpur",
    ],

    "sahapura": [
        "Shahpura",
    ],

    "titlagarh": [
        "Titilagarh",
    ],
}


# ============================================================
# MAPTILER TYPES
# ============================================================

ACCEPTED_PLACE_TYPES = {
    "place",
    "county",
    "locality",
    "municipality",
    "municipal_district",
    "neighbourhood",
}

REJECTED_PLACE_TYPES = {
    "region",
    "country",
    "address",
    "continental_marine",
}


# ============================================================
# GENERIC WORDS
# ============================================================

GENERIC_WORDS = {
    "road",
    "section",
    "highway",
    "national highway",
    "railway",
    "chainage",
    "lane",
    "laning",
    "widening",
    "construction",
    "acquisition",
    "land",
    "project",
    "bridge",
    "rob",
    "bypass",
    "town",
    "city",
    "phase",
    "shoulder",
    "paved",
    "existing",
    "design",
    "junction",
    "state",
    "district",
}


# ============================================================
# CACHE
# ============================================================

def load_cache() -> dict[str, Any]:

    if not CACHE_FILE.exists():
        return {}

    try:

        with CACHE_FILE.open(
            "r",
            encoding="utf-8",
        ) as file:

            value = json.load(file)

        if isinstance(value, dict):
            return value

    except Exception:
        pass

    return {}


CACHE = load_cache()


def save_cache() -> None:

    temp = CACHE_FILE.with_suffix(
        ".tmp"
    )

    with temp.open(
        "w",
        encoding="utf-8",
    ) as file:

        json.dump(
            CACHE,
            file,
            ensure_ascii=False,
            indent=2,
        )

    temp.replace(
        CACHE_FILE
    )


# ============================================================
# HTTP
# ============================================================

HTTP = requests.Session()

HTTP.headers.update(
    {
        "Accept":
            "application/json",

        "User-Agent":
            "AcquiTwinAI-GIS-Recovery/2.0",
    }
)


# ============================================================
# NORMALIZATION
# ============================================================

def clean_text(
    value: Any,
) -> str:

    if value is None:
        return ""

    return re.sub(
        r"\s+",
        " ",
        str(value),
    ).strip()


def normalize(
    value: Any,
) -> str:

    text = clean_text(
        value
    ).casefold()

    text = (
        text
        .replace(
            "orissa",
            "odisha",
        )
        .replace(
            "uttaranchal",
            "uttarakhand",
        )
        .replace(
            "pondicherry",
            "puducherry",
        )
    )

    text = re.sub(
        r"[^a-z0-9]+",
        " ",
        text,
    )

    return " ".join(
        text.split()
    )


def english_part(
    value: str,
) -> str:

    value = clean_text(
        value
    )

    match = re.search(
        r"[\u0900-\u097F]",
        value,
    )

    if match:
        value = value[
            :match.start()
        ]

    return clean_text(
        value
    )


# ============================================================
# STATE HELPERS
# ============================================================

def infer_states(
    database_state: str,
    project_name: str,
) -> list[str]:

    result: list[str] = []

    raw_state = clean_text(
        database_state
    )

    # Database may contain:
    #
    # Madhya Pradesh; Uttar Pradesh

    if raw_state:

        for part in re.split(
            r"[;,/]",
            raw_state,
        ):

            part = clean_text(
                part
            )

            if part:
                result.append(
                    part
                )

    project_normalized = normalize(
        project_name
    )

    for state in INDIAN_STATES:

        if (
            normalize(state)
            in project_normalized
            and state not in result
        ):

            result.append(
                state
            )

    return result


def state_matches(
    place_name: str,
    expected_states: list[str],
) -> bool:

    if not expected_states:
        return True

    place = normalize(
        place_name
    )

    return any(
        normalize(state)
        in place
        for state in expected_states
    )


def detected_state(
    place_name: str,
) -> str | None:

    place = normalize(
        place_name
    )

    for state in INDIAN_STATES:

        if normalize(state) in place:
            return state

    return None


# ============================================================
# CANDIDATE CLEANING
# ============================================================

def clean_candidate(
    value: str,
) -> str:

    value = clean_text(
        value
    )

    value = value.strip(
        " ,.;:-()[]"
    )

    # --------------------------------------------------------
    # Remove common leading noise
    # --------------------------------------------------------

    value = re.sub(
        r"^(?:"
        r"near|"
        r"including|"
        r"at|"
        r"on|"
        r"from|"
        r"towards|"
        r"for|"
        r"of|"
        r"the"
        r")\s+",
        "",
        value,
        flags=re.IGNORECASE,
    )

    # --------------------------------------------------------
    # Remove common trailing infrastructure words
    # --------------------------------------------------------

    value = re.sub(
        r"\s+(?:"
        r"road|"
        r"section|"
        r"stretch|"
        r"town|"
        r"city|"
        r"bypass|"
        r"by\s*pass|"
        r"railway|"
        r"phase"
        r")$",
        "",
        value,
        flags=re.IGNORECASE,
    )

    value = clean_text(
        value
    )

    # --------------------------------------------------------
    # Never interpret chainage/numbers as places
    # --------------------------------------------------------

    if any(
        character.isdigit()
        for character in value
    ):
        return ""

    if len(value) < 3:
        return ""

    if len(value) > 55:
        return ""

    # --------------------------------------------------------
    # Reject states themselves as project localities
    # --------------------------------------------------------

    normalized_value = normalize(
        value
    )

    for state in INDIAN_STATES:

        if (
            normalized_value
            == normalize(state)
        ):
            return ""

    # --------------------------------------------------------
    # Reject obvious infrastructure phrases
    # --------------------------------------------------------

    tokens = set(
        normalized_value.split()
    )

    generic_hits = sum(
        1
        for word in GENERIC_WORDS
        if normalize(word) in tokens
    )

    if (
        generic_hits >= 2
    ):
        return ""

    if normalized_value in {
        normalize(word)
        for word in GENERIC_WORDS
    }:
        return ""

    return value


# ============================================================
# ADD UNIQUE CANDIDATE
# ============================================================

def add_candidate(
    collection: list[str],
    value: str,
) -> None:

    candidate = clean_candidate(
        value
    )

    if not candidate:
        return

    key = normalize(
        candidate
    )

    if any(
        normalize(existing)
        == key
        for existing
        in collection
    ):
        return

    collection.append(
        candidate
    )


# ============================================================
# PLACE EXTRACTION
# ============================================================

def extract_places(
    project_name: str,
) -> tuple[
    list[str],
    list[str],
]:

    text = english_part(
        project_name
    )

    route_places: list[str] = []
    point_places: list[str] = []

    # ========================================================
    # EXPLICIT A TO B
    # ========================================================

    route_pattern = re.compile(
        r"\b"
        r"([A-Z][A-Za-z.'-]*"
        r"(?:\s+[A-Z][A-Za-z.'-]*){0,2})"
        r"\s+to\s+"
        r"([A-Z][A-Za-z.'-]*"
        r"(?:\s+[A-Z][A-Za-z.'-]*){0,2})",
    )

    for match in route_pattern.finditer(
        text
    ):

        add_candidate(
            route_places,
            match.group(1),
        )

        add_candidate(
            route_places,
            match.group(2),
        )

    # ========================================================
    # PARENTHETICAL LOCATIONS
    # ========================================================

    for content in re.findall(
        r"\(([^()]*)\)",
        text,
    ):

        # Ignore obvious chainage-only parentheses.

        if re.search(
            r"\b(?:km|chainage)\b",
            content,
            flags=re.IGNORECASE,
        ):
            continue

        pieces = re.split(
            r"\s+to\s+|"
            r"\s*[-–—]\s*",
            content,
            flags=re.IGNORECASE,
        )

        valid_pieces = []

        for piece in pieces:

            candidate = clean_candidate(
                piece
            )

            if candidate:
                valid_pieces.append(
                    candidate
                )

        if len(valid_pieces) >= 2:

            for candidate in valid_pieces:
                add_candidate(
                    route_places,
                    candidate,
                )

        elif len(valid_pieces) == 1:

            add_candidate(
                point_places,
                valid_pieces[0],
            )

    # ========================================================
    # NEAR X
    # ========================================================

    for match in re.finditer(
        r"\bnear\s+"
        r"([A-Z][A-Za-z.'-]*"
        r"(?:\s+[A-Z][A-Za-z.'-]*){0,2})",
        text,
        flags=re.IGNORECASE,
    ):

        add_candidate(
            point_places,
            match.group(1),
        )

    # ========================================================
    # FOR X CITY / TOWN
    # ========================================================

    for match in re.finditer(
        r"\bfor\s+"
        r"([A-Z][A-Za-z.'-]*"
        r"(?:\s+[A-Z][A-Za-z.'-]*){0,2})"
        r"\s+(?:city|town)\b",
        text,
        flags=re.IGNORECASE,
    ):

        add_candidate(
            point_places,
            match.group(1),
        )

    # ========================================================
    # AT X
    # ========================================================

    for match in re.finditer(
        r"\bat\s+"
        r"([A-Z][A-Za-z.'-]*"
        r"(?:\s+[A-Z][A-Za-z.'-]*){0,2})",
        text,
    ):

        add_candidate(
            point_places,
            match.group(1),
        )

    # ========================================================
    # A, B BYPASS
    # ========================================================

    for match in re.finditer(
        r"([A-Z][A-Za-z.'-]+"
        r"(?:\s*,\s*[A-Z][A-Za-z.'-]+)+)"
        r"\s+(?:Bypass|by\s*pass)\b",
        text,
        flags=re.IGNORECASE,
    ):

        for part in match.group(1).split(
            ","
        ):

            add_candidate(
                point_places,
                part,
            )

    # ========================================================
    # X BYPASS
    # ========================================================

    for match in re.finditer(
        r"\b"
        r"([A-Z][A-Za-z.'-]*)"
        r"\s+(?:Bypass|by\s*pass)\b",
        text,
        flags=re.IGNORECASE,
    ):

        add_candidate(
            point_places,
            match.group(1),
        )

    return (
        route_places,
        point_places,
    )


# ============================================================
# ALIASES
# ============================================================

def candidate_variants(
    candidate: str,
) -> list[str]:

    values = [
        candidate
    ]

    key = normalize(
        candidate
    )

    values.extend(
        ALIASES.get(
            key,
            [],
        )
    )

    result = []

    for value in values:

        if normalize(value) not in {
            normalize(existing)
            for existing in result
        }:

            result.append(
                value
            )

    return result


# ============================================================
# MAPTILER
# ============================================================

def maptiler_search(
    query: str,
) -> list[dict[str, Any]]:

    query = clean_text(
        query
    )

    if not query:
        return []

    cache_key = (
        "v2|"
        + query.casefold()
    )

    if cache_key in CACHE:

        value = CACHE[
            cache_key
        ]

        return (
            value
            if isinstance(
                value,
                list,
            )
            else []
        )

    url = (
        MAPTILER_URL
        + "/"
        + quote(
            query,
            safe="",
        )
        + ".json"
    )

    params = {
        "key":
            MAPTILER_KEY,

        "country":
            "in",

        "language":
            "en",

        "limit":
            8,

        "autocomplete":
            "false",

        "fuzzyMatch":
            "true",
    }

    try:

        response = HTTP.get(
            url,
            params=params,
            timeout=REQUEST_TIMEOUT,
        )

        response.raise_for_status()

        body = response.json()

        features = body.get(
            "features",
            [],
        )

        if not isinstance(
            features,
            list,
        ):
            features = []

    except Exception as exc:

        print(
            f"      MAPTILER ERROR: {exc}"
        )

        features = []

    CACHE[
        cache_key
    ] = features

    save_cache()

    time.sleep(
        0.05
    )

    return features


# ============================================================
# COORDINATES
# ============================================================

def feature_coordinate(
    feature: dict[str, Any],
):

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


# ============================================================
# LEXICAL MATCH
# ============================================================

def lexical_similarity(
    candidate: str,
    result_text: str,
) -> float:

    candidate_norm = normalize(
        candidate
    )

    result_norm = normalize(
        result_text
    )

    if not candidate_norm:
        return 0.0

    if not result_norm:
        return 0.0

    if candidate_norm == result_norm:
        return 1.0

    return SequenceMatcher(
        None,
        candidate_norm,
        result_norm,
    ).ratio()


# ============================================================
# SEARCH A CANDIDATE
# ============================================================

def search_candidate(
    candidate: str,
    district: str,
    expected_states: list[str],
) -> list[dict[str, Any]]:

    variants = candidate_variants(
        candidate
    )

    queries: list[
        tuple[str, str]
    ] = []

    for variant in variants:

        for state in expected_states:

            if district:

                queries.append(
                    (
                        variant,
                        f"{variant}, "
                        f"{district}, "
                        f"{state}, India",
                    )
                )

            queries.append(
                (
                    variant,
                    f"{variant}, "
                    f"{state}, India",
                )
            )

        # IMPORTANT:
        # Allow lookup without known DB state.
        queries.append(
            (
                variant,
                f"{variant}, India",
            )
        )

    options = []

    seen_coordinates = set()

    for variant, query in queries:

        features = (
            maptiler_search(
                query
            )
        )

        for feature in features:

            coordinate = (
                feature_coordinate(
                    feature
                )
            )

            if coordinate is None:
                continue

            place_types = set(
                feature.get(
                    "place_type",
                    [],
                )
                or []
            )

            if (
                place_types
                & REJECTED_PLACE_TYPES
            ):
                continue

            if not (
                place_types
                & ACCEPTED_PLACE_TYPES
            ):
                continue

            place_name = clean_text(
                feature.get(
                    "place_name"
                )
            )

            if not state_matches(
                place_name,
                expected_states,
            ):
                continue

            result_text = clean_text(
                feature.get(
                    "text"
                )
            )

            # Compare against BOTH original candidate
            # and known spelling aliases.

            similarity = max(
                lexical_similarity(
                    value,
                    result_text,
                )
                for value
                in variants
            )

            # This rejects cases such as:
            #
            # Sahapura -> Rajasthan
            #
            # 000 -> Rajasthan

            if similarity < 0.70:
                continue

            try:
                relevance = float(
                    feature.get(
                        "relevance",
                        0,
                    )
                    or 0
                )

            except (
                TypeError,
                ValueError,
            ):
                relevance = 0.0

            key = (
                round(
                    coordinate[0],
                    5,
                ),
                round(
                    coordinate[1],
                    5,
                ),
            )

            if key in seen_coordinates:
                continue

            seen_coordinates.add(
                key
            )

            quality = (
                similarity * 2.0
                +
                relevance
            )

            options.append(
                {
                    "candidate":
                        candidate,

                    "matched_text":
                        result_text,

                    "latitude":
                        coordinate[0],

                    "longitude":
                        coordinate[1],

                    "place_name":
                        place_name,

                    "place_type":
                        list(
                            place_types
                        ),

                    "state":
                        detected_state(
                            place_name
                        ),

                    "similarity":
                        similarity,

                    "relevance":
                        relevance,

                    "quality":
                        quality,
                }
            )

    options.sort(
        key=lambda item:
            item[
                "quality"
            ],
        reverse=True,
    )

    return options[
        :8
    ]


# ============================================================
# HAVERSINE
# ============================================================

def distance_km(
    first: dict[str, Any],
    second: dict[str, Any],
) -> float:

    lat1 = math.radians(
        first["latitude"]
    )

    lon1 = math.radians(
        first["longitude"]
    )

    lat2 = math.radians(
        second["latitude"]
    )

    lon2 = math.radians(
        second["longitude"]
    )

    dlat = lat2 - lat1
    dlon = lon2 - lon1

    a = (
        math.sin(
            dlat / 2
        ) ** 2
        +
        math.cos(lat1)
        * math.cos(lat2)
        * math.sin(
            dlon / 2
        ) ** 2
    )

    return (
        6371.0
        *
        2
        *
        math.asin(
            math.sqrt(a)
        )
    )


# ============================================================
# BEST CORRIDOR PAIR
# ============================================================

def choose_corridor_pair(
    start_options: list[dict[str, Any]],
    end_options: list[dict[str, Any]],
):

    best = None
    best_score = -999.0

    for start in start_options:

        for end in end_options:

            # If provider identified states,
            # corridor endpoints should agree.

            if (
                start.get("state")
                and
                end.get("state")
                and
                normalize(
                    start["state"]
                )
                !=
                normalize(
                    end["state"]
                )
            ):
                continue

            distance = distance_km(
                start,
                end,
            )

            # Infrastructure corridors may be long,
            # but absurdly distant duplicate-place matches
            # are less desirable.

            proximity_bonus = max(
                0.0,
                1.25
                -
                (
                    distance
                    / 500.0
                ),
            )

            score = (
                start[
                    "quality"
                ]
                +
                end[
                    "quality"
                ]
                +
                proximity_bonus
            )

            if score > best_score:

                best_score = score

                best = (
                    start,
                    end,
                    distance,
                )

    return best


# ============================================================
# GEOCODE PROJECT
# ============================================================

def geocode_project(
    project: dict[str, Any],
):

    project_name = clean_text(
        project[
            "project_name"
        ]
    )

    district = clean_text(
        project.get(
            "district"
        )
    )

    expected_states = (
        infer_states(
            clean_text(
                project.get(
                    "state"
                )
            ),
            project_name,
        )
    )

    (
        route_places,
        point_places,
    ) = extract_places(
        project_name
    )

    # ========================================================
    # TRY CORRIDOR FIRST
    # ========================================================

    route_resolved = []

    for candidate in route_places:

        options = search_candidate(
            candidate,
            district,
            expected_states,
        )

        if options:

            route_resolved.append(
                (
                    candidate,
                    options,
                )
            )

    if len(route_resolved) >= 2:

        start_name, start_options = (
            route_resolved[0]
        )

        end_name, end_options = (
            route_resolved[-1]
        )

        pair = choose_corridor_pair(
            start_options,
            end_options,
        )

        if pair:

            start, end, corridor_distance = (
                pair
            )

            latitude = (
                start[
                    "latitude"
                ]
                +
                end[
                    "latitude"
                ]
            ) / 2

            longitude = (
                start[
                    "longitude"
                ]
                +
                end[
                    "longitude"
                ]
            ) / 2

            confidence = min(
                start[
                    "relevance"
                ],
                end[
                    "relevance"
                ],
                start[
                    "similarity"
                ],
                end[
                    "similarity"
                ],
            )

            return {
                "latitude":
                    latitude,

                "longitude":
                    longitude,

                "start_location":
                    start_name,

                "start_latitude":
                    start[
                        "latitude"
                    ],

                "start_longitude":
                    start[
                        "longitude"
                    ],

                "end_location":
                    end_name,

                "end_latitude":
                    end[
                        "latitude"
                    ],

                "end_longitude":
                    end[
                        "longitude"
                    ],

                "accuracy":
                    "CORRIDOR_APPROX",

                "confidence":
                    confidence,

                "description":
                    (
                        f"{start['place_name']} "
                        f"→ "
                        f"{end['place_name']}"
                    ),

                "distance_km":
                    corridor_distance,

                "route_places":
                    route_places,

                "point_places":
                    point_places,
            }

    # ========================================================
    # TRY POINT CANDIDATES
    # ========================================================

    point_results = []

    # Also use route candidates as single-location
    # fallbacks if only one endpoint could be resolved.

    all_point_candidates = (
        point_places
        +
        route_places
    )

    seen = set()

    for candidate in all_point_candidates:

        key = normalize(
            candidate
        )

        if key in seen:
            continue

        seen.add(
            key
        )

        options = search_candidate(
            candidate,
            district,
            expected_states,
        )

        if options:

            point_results.append(
                (
                    candidate,
                    options[0],
                )
            )

    if point_results:

        point_results.sort(
            key=lambda item:
                item[1][
                    "quality"
                ],
            reverse=True,
        )

        candidate, result = (
            point_results[0]
        )

        confidence = min(
            result[
                "relevance"
            ],
            result[
                "similarity"
            ],
        )

        return {
            "latitude":
                result[
                    "latitude"
                ],

            "longitude":
                result[
                    "longitude"
                ],

            "start_location":
                None,

            "start_latitude":
                None,

            "start_longitude":
                None,

            "end_location":
                None,

            "end_latitude":
                None,

            "end_longitude":
                None,

            "accuracy":
                "LOCALITY_APPROX",

            "confidence":
                confidence,

            "description":
                result[
                    "place_name"
                ],

            "matched_candidate":
                candidate,

            "route_places":
                route_places,

            "point_places":
                point_places,
        }

    # ========================================================
    # NO STATE-CENTROID FALLBACK
    # ========================================================

    return {
        "unresolved":
            True,

        "route_places":
            route_places,

        "point_places":
            point_places,

        "expected_states":
            expected_states,
    }


# ============================================================
# DATABASE LOAD
# ============================================================

def load_projects():

    db = SessionLocal()

    try:

        rows = db.scalars(
            select(Project)
            .where(
                or_(
                    Project.latitude.is_(
                        None
                    ),
                    Project.longitude.is_(
                        None
                    ),
                )
            )
            .order_by(
                Project.id
            )
        ).all()

        return [
            {
                "id":
                    project.id,

                "project_id":
                    project.project_id,

                "project_name":
                    project.project_name,

                "state":
                    project.state,

                "district":
                    project.district,
            }

            for project
            in rows
        ]

    finally:
        db.close()


# ============================================================
# SAVE
# ============================================================

def save_result(
    project_id: int,
    result: dict[str, Any],
):

    db = SessionLocal()

    try:

        project = db.get(
            Project,
            project_id,
        )

        if project is None:
            return

        if (
            project.latitude
            is not None
            and
            project.longitude
            is not None
        ):
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

        project.start_location = (
            result.get(
                "start_location"
            )
        )

        project.start_latitude = (
            result.get(
                "start_latitude"
            )
        )

        project.start_longitude = (
            result.get(
                "start_longitude"
            )
        )

        project.end_location = (
            result.get(
                "end_location"
            )
        )

        project.end_latitude = (
            result.get(
                "end_latitude"
            )
        )

        project.end_longitude = (
            result.get(
                "end_longitude"
            )
        )

        project.gis_status = (
            "MAPPED"
        )

        project.location_accuracy = (
            result[
                "accuracy"
            ]
        )

        project.location_source = (
            "MapTiler Geocoding API"
        )

        project.geocode_confidence = (
            round(
                float(
                    result[
                        "confidence"
                    ]
                ),
                4,
            )
        )

        db.commit()

    except Exception:

        db.rollback()
        raise

    finally:
        db.close()


# ============================================================
# MAIN
# ============================================================

def main():

    parser = argparse.ArgumentParser()

    parser.add_argument(
        "--limit",
        type=int,
        default=20,
    )

    parser.add_argument(
        "--apply",
        action="store_true",
    )

    args = parser.parse_args()

    projects = load_projects()

    if args.limit > 0:

        projects = projects[
            :args.limit
        ]

    mode = (
        "APPLY"
        if args.apply
        else "DRY RUN"
    )

    print("=" * 80)
    print(
        "ACQUITWIN MAPTILER GIS RECOVERY V2"
    )
    print("=" * 80)

    print(
        f"Mode               : {mode}"
    )

    print(
        f"Projects to process: {len(projects)}"
    )

    print()

    resolved = 0
    unresolved = 0

    accuracy_counts = {}

    for index, project in enumerate(
        projects,
        start=1,
    ):

        print(
            f"[{index}/{len(projects)}] "
            f"{project['project_id']}"
        )

        print(
            f"    {project['project_name']}"
        )

        result = geocode_project(
            project
        )

        print(
            "    Route candidates:",
            result.get(
                "route_places",
                [],
            ),
        )

        print(
            "    Point candidates:",
            result.get(
                "point_places",
                [],
            ),
        )

        if result.get(
            "unresolved"
        ):

            unresolved += 1

            print(
                "    RESULT     : UNRESOLVED"
            )

            print(
                "    STATES     :",
                result.get(
                    "expected_states",
                    [],
                ),
            )

            print()

            continue

        resolved += 1

        accuracy = result[
            "accuracy"
        ]

        accuracy_counts[
            accuracy
        ] = (
            accuracy_counts.get(
                accuracy,
                0,
            )
            + 1
        )

        print(
            f"    RESULT     : "
            f"{accuracy}"
        )

        print(
            f"    LAT        : "
            f"{result['latitude']}"
        )

        print(
            f"    LNG        : "
            f"{result['longitude']}"
        )

        print(
            f"    CONFIDENCE : "
            f"{result['confidence']:.4f}"
        )

        print(
            f"    MATCH      : "
            f"{result['description']}"
        )

        if (
            result.get(
                "distance_km"
            )
            is not None
        ):

            print(
                f"    CORRIDOR KM: "
                f"{result['distance_km']:.1f}"
            )

        if args.apply:

            save_result(
                project[
                    "id"
                ],
                result,
            )

            print(
                "    DATABASE   : SAVED"
            )

        else:

            print(
                "    DATABASE   : NOT SAVED"
            )

        print()

    print("=" * 80)

    print(
        "V2 COMPLETE"
    )

    print("=" * 80)

    print(
        f"Resolved  : {resolved}"
    )

    print(
        f"Unresolved: {unresolved}"
    )

    print(
        f"Total     : {len(projects)}"
    )

    print()

    for accuracy, count in sorted(
        accuracy_counts.items()
    ):

        print(
            f"{accuracy:<22}: {count}"
        )

    if not args.apply:

        print()
        print(
            "DRY RUN ONLY — DATABASE NOT MODIFIED."
        )


if __name__ == "__main__":
    main()