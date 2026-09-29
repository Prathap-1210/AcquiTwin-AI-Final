from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any
from urllib.parse import quote

import requests
from sqlalchemy import or_, select

# ============================================================
# MAKE backend/app IMPORTABLE EVEN WHEN SCRIPT IS RUN DIRECTLY
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
# CONFIGURATION
# ============================================================

MAPTILER_KEY = os.getenv(
    "MAPTILER_API_KEY",
    "",
).strip()

if not MAPTILER_KEY:
    raise RuntimeError(
        "MAPTILER_API_KEY is not configured."
    )


MAPTILER_BASE_URL = (
    "https://api.maptiler.com/geocoding"
)

REQUEST_TIMEOUT = 20

CACHE_DIR = (
    Path(__file__).resolve().parent
    / ".geocode_cache"
)

CACHE_FILE = (
    CACHE_DIR
    / "maptiler_results.json"
)

CACHE_DIR.mkdir(
    parents=True,
    exist_ok=True,
)


# ============================================================
# SAFE PLACE TYPES
# ============================================================

# IMPORTANT:
# No "region" here.
#
# That prevents state centroids such as:
# Rajasthan
# Tamil Nadu
# Odisha
#
# from being accepted as project locations.

LOCALITY_TYPES = [
    "municipality",
    "municipal_district",
    "locality",
    "neighbourhood",
    "place",
    "road",
]

DISTRICT_TYPES = [
    "subregion",
    "county",
    "municipality",
    "municipal_district",
    "locality",
    "place",
]


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

        if isinstance(
            value,
            dict,
        ):
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
            "AcquiTwinAI-GIS-Enrichment/1.0",
    }
)


# ============================================================
# TEXT HELPERS
# ============================================================

def clean_text(
    value: Any,
) -> str:

    if value is None:
        return ""

    value = str(value)

    value = re.sub(
        r"\s+",
        " ",
        value,
    )

    return value.strip()


def normalize(
    value: Any,
) -> str:

    text = clean_text(
        value
    ).casefold()

    replacements = {
        "orissa":
            "odisha",

        "uttaranchal":
            "uttarakhand",

        "pondicherry":
            "puducherry",

        "nct of delhi":
            "delhi",

        "national capital territory of delhi":
            "delhi",
    }

    for old, new in replacements.items():
        text = text.replace(
            old,
            new,
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
    project_name: str,
) -> str:
    """
    Bhoomi Rashi names often contain the same title
    again in Hindi after the English description.

    Keep only the English/Latin portion for place extraction.
    """

    text = clean_text(
        project_name
    )

    match = re.search(
        r"[\u0900-\u097F]",
        text,
    )

    if match:
        text = text[
            :match.start()
        ]

    return clean_text(
        text
    )


# ============================================================
# LOCALITY CLEANING
# ============================================================

GENERIC_ONLY = {
    "national highway",
    "highway",
    "road",
    "section",
    "bypass",
    "town",
    "city",
    "state",
    "india",
    "railway",
    "land",
    "acquisition",
    "construction",
    "widening",
    "project",
    "existing",
    "design",
    "chainage",
}


def clean_candidate(
    value: str,
) -> str:

    value = clean_text(
        value
    )

    # Remove obvious chainage / highway clutter.
    value = re.sub(
        r"\b(?:NH|SH|Km|KM|No)\.?\s*[-:/+]?\s*\d+[A-Za-z/-]*",
        " ",
        value,
        flags=re.IGNORECASE,
    )

    value = re.sub(
        r"\b\d+(?:\.\d+)?\s*(?:km|kms)\b",
        " ",
        value,
        flags=re.IGNORECASE,
    )

    # Stop when generic infrastructure text begins.
    value = re.split(
        r"\b(?:"
        r"road|section|stretch|railway|"
        r"national highway|highway|"
        r"from|design chainage|existing chainage|"
        r"phase|project"
        r")\b",
        value,
        maxsplit=1,
        flags=re.IGNORECASE,
    )[0]

    value = value.strip(
        " ,.;:-()[]"
    )

    value = re.sub(
        r"\s+",
        " ",
        value,
    )

    # Remove generic prefix.
    value = re.sub(
        r"^(?:"
        r"construction of|"
        r"acquisition of|"
        r"land acquisition for|"
        r"land acquisition estimate for|"
        r"bypass for"
        r")\s+",
        "",
        value,
        flags=re.IGNORECASE,
    )

    value = clean_text(
        value
    )

    if len(value) < 3:
        return ""

    if len(value) > 60:
        return ""

    # Place candidates should not be mostly numbers.
    if sum(
        char.isdigit()
        for char in value
    ) > 3:
        return ""

    if normalize(value) in {
        normalize(item)
        for item in GENERIC_ONLY
    }:
        return ""

    return value


# ============================================================
# PROJECT-NAME PLACE EXTRACTION
# ============================================================

def extract_place_candidates(
    project_name: str,
) -> list[str]:

    text = english_part(
        project_name
    )

    results: list[str] = []

    def add(
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

        if not key:
            return

        if any(
            normalize(existing)
            == key
            for existing in results
        ):
            return

        results.append(
            candidate
        )

    # --------------------------------------------------------
    # "near Usilampatti"
    # "near Bodi"
    # --------------------------------------------------------

    for match in re.finditer(
        r"\bnear\s+"
        r"([A-Za-z][A-Za-z .'-]{2,35})",
        text,
        flags=re.IGNORECASE,
    ):
        add(
            match.group(1)
        )

    # --------------------------------------------------------
    # "at Kota"
    # --------------------------------------------------------

    for match in re.finditer(
        r"\bat\s+"
        r"([A-Za-z][A-Za-z .'-]{2,30})",
        text,
        flags=re.IGNORECASE,
    ):
        add(
            match.group(1)
        )

    # --------------------------------------------------------
    # "for Barmer city"
    # "for Titlagarh Town"
    # --------------------------------------------------------

    for match in re.finditer(
        r"\bfor\s+"
        r"([A-Za-z][A-Za-z .'-]{2,35})"
        r"\s+(?:city|town)\b",
        text,
        flags=re.IGNORECASE,
    ):
        add(
            match.group(1)
        )

    # --------------------------------------------------------
    # "Thiruvaiyaru Bypass"
    # "Kuchinda bypass"
    # "Rameshwaram Bypass"
    # --------------------------------------------------------

    for match in re.finditer(
        r"([A-Za-z][A-Za-z .,'-]{2,55})"
        r"\s+(?:bypass|by\s*pass)\b",
        text,
        flags=re.IGNORECASE,
    ):

        raw = match.group(1)

        # Example:
        # Atchampathu, Viratipathu
        for part in re.split(
            r"[,;/]",
            raw,
        ):
            add(
                part
            )

    # --------------------------------------------------------
    # Parentheses frequently contain corridor localities:
    #
    # (Bhawanipatna to Koksara)
    # (Bolangir - Sonepur)
    # (Sahapura - Alwar section)
    # --------------------------------------------------------

    for parenthetical in re.findall(
        r"\(([^()]*)\)",
        text,
    ):

        for part in re.split(
            r"\s+(?:to)\s+|\s*[-–—]\s*",
            parenthetical,
            flags=re.IGNORECASE,
        ):
            add(
                part
            )

    # --------------------------------------------------------
    # General A to B corridors.
    # --------------------------------------------------------

    corridor_pattern = re.compile(
        r"\b"
        r"([A-Za-z][A-Za-z .'’-]{2,35}?)"
        r"\s+to\s+"
        r"([A-Za-z][A-Za-z .'’-]{2,35})"
        r"\b",
        flags=re.IGNORECASE,
    )

    for match in corridor_pattern.finditer(
        text
    ):
        add(
            match.group(1)
        )

        add(
            match.group(2)
        )

    return results


# ============================================================
# MAPTILER API
# ============================================================

def maptiler_search(
    query: str,
    types: list[str],
) -> list[dict[str, Any]]:

    query = clean_text(
        query
    )

    if not query:
        return []

    cache_key = (
        query.casefold()
        + "|"
        + ",".join(types)
    )

    if cache_key in CACHE:

        cached = CACHE[
            cache_key
        ]

        return (
            cached
            if isinstance(
                cached,
                list,
            )
            else []
        )

    url = (
        MAPTILER_BASE_URL
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
            5,

        "autocomplete":
            "false",

        "fuzzyMatch":
            "true",

        "types":
            ",".join(
                types
            ),
    }

    try:

        response = HTTP.get(
            url,
            params=params,
            timeout=REQUEST_TIMEOUT,
        )

        response.raise_for_status()

        payload = response.json()

        features = payload.get(
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
            f"      API ERROR: {exc}"
        )

        features = []

    CACHE[
        cache_key
    ] = features

    save_cache()

    # Small delay to avoid aggressively hammering
    # the provider during a large recovery pass.
    time.sleep(
        0.08
    )

    return features


# ============================================================
# RESULT VALIDATION
# ============================================================

def state_matches(
    feature: dict[str, Any],
    expected_state: str,
) -> bool:

    if not expected_state:
        return True

    place_name = normalize(
        feature.get(
            "place_name",
            "",
        )
    )

    state = normalize(
        expected_state
    )

    return (
        state in place_name
    )


def feature_center(
    feature: dict[str, Any],
) -> tuple[
    float,
    float,
] | None:

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


def choose_feature(
    features: list[dict[str, Any]],
    expected_state: str,
    minimum_relevance: float,
) -> dict[str, Any] | None:

    accepted: list[
        dict[str, Any]
    ] = []

    for feature in features:

        if not isinstance(
            feature,
            dict,
        ):
            continue

        center = feature_center(
            feature
        )

        if center is None:
            continue

        place_types = (
            feature.get(
                "place_type"
            )
            or []
        )

        # Reject state/country-level results.
        if any(
            place_type in {
                "region",
                "country",
                "continental_marine",
            }
            for place_type
            in place_types
        ):
            continue

        if not state_matches(
            feature,
            expected_state,
        ):
            continue

        relevance = feature.get(
            "relevance",
            0,
        )

        try:
            relevance = float(
                relevance
            )
        except (
            TypeError,
            ValueError,
        ):
            relevance = 0.0

        if relevance < minimum_relevance:
            continue

        accepted.append(
            feature
        )

    if not accepted:
        return None

    accepted.sort(
        key=lambda item: float(
            item.get(
                "relevance",
                0,
            )
            or 0
        ),
        reverse=True,
    )

    return accepted[0]


# ============================================================
# GEOCODE A NAMED LOCALITY
# ============================================================

def geocode_locality(
    locality: str,
    district: str,
    state: str,
    minimum_relevance: float,
):

    queries = []

    if (
        locality
        and district
        and state
    ):
        queries.append(
            f"{locality}, "
            f"{district}, "
            f"{state}, India"
        )

    if (
        locality
        and state
    ):
        queries.append(
            f"{locality}, "
            f"{state}, India"
        )

    seen = set()

    for query in queries:

        key = normalize(
            query
        )

        if key in seen:
            continue

        seen.add(
            key
        )

        features = (
            maptiler_search(
                query,
                LOCALITY_TYPES,
            )
        )

        feature = choose_feature(
            features,
            state,
            minimum_relevance,
        )

        if feature is None:
            continue

        center = feature_center(
            feature
        )

        if center is None:
            continue

        relevance = float(
            feature.get(
                "relevance",
                0,
            )
            or 0
        )

        return {
            "query":
                query,

            "locality":
                locality,

            "latitude":
                center[0],

            "longitude":
                center[1],

            "relevance":
                relevance,

            "place_name":
                clean_text(
                    feature.get(
                        "place_name"
                    )
                ),

            "place_type":
                feature.get(
                    "place_type",
                    [],
                ),
        }

    return None


# ============================================================
# DISTRICT FALLBACK
# ============================================================

def geocode_district(
    district: str,
    state: str,
):

    if (
        not district
        or not state
    ):
        return None

    query = (
        f"{district}, "
        f"{state}, India"
    )

    features = maptiler_search(
        query,
        DISTRICT_TYPES,
    )

    feature = choose_feature(
        features,
        state,
        minimum_relevance=0.65,
    )

    if feature is None:
        return None

    center = feature_center(
        feature
    )

    if center is None:
        return None

    return {
        "query":
            query,

        "locality":
            district,

        "latitude":
            center[0],

        "longitude":
            center[1],

        "relevance":
            float(
                feature.get(
                    "relevance",
                    0,
                )
                or 0
            ),

        "place_name":
            clean_text(
                feature.get(
                    "place_name"
                )
            ),

        "place_type":
            feature.get(
                "place_type",
                [],
            ),
    }


# ============================================================
# PROJECT GEOCODING
# ============================================================

def geocode_project(
    project: dict[str, Any],
):

    name = clean_text(
        project[
            "project_name"
        ]
    )

    district = clean_text(
        project.get(
            "district"
        )
    )

    state = clean_text(
        project.get(
            "state"
        )
    )

    candidates = (
        extract_place_candidates(
            name
        )
    )

    hits = []

    for candidate in candidates:

        hit = geocode_locality(
            candidate,
            district,
            state,
            minimum_relevance=0.60,
        )

        if hit is None:
            continue

        # Prevent the same geographic point
        # from being added multiple times.
        duplicate = any(
            abs(
                existing[
                    "latitude"
                ]
                -
                hit[
                    "latitude"
                ]
            ) < 0.001
            and
            abs(
                existing[
                    "longitude"
                ]
                -
                hit[
                    "longitude"
                ]
            ) < 0.001
            for existing in hits
        )

        if not duplicate:
            hits.append(
                hit
            )

    # ========================================================
    # TWO OR MORE LOCALITIES → CORRIDOR APPROXIMATION
    # ========================================================

    if len(hits) >= 2:

        start = hits[0]
        end = hits[1]

        latitude = (
            start["latitude"]
            +
            end["latitude"]
        ) / 2

        longitude = (
            start["longitude"]
            +
            end["longitude"]
        ) / 2

        return {
            "latitude":
                latitude,

            "longitude":
                longitude,

            "start_location":
                start["locality"],

            "start_latitude":
                start["latitude"],

            "start_longitude":
                start["longitude"],

            "end_location":
                end["locality"],

            "end_latitude":
                end["latitude"],

            "end_longitude":
                end["longitude"],

            "accuracy":
                "CORRIDOR_APPROX",

            "confidence":
                min(
                    start[
                        "relevance"
                    ],
                    end[
                        "relevance"
                    ],
                ),

            "description":
                (
                    f"{start['place_name']} "
                    f"→ "
                    f"{end['place_name']}"
                ),
        }

    # ========================================================
    # ONE LOCALITY → LOCALITY APPROXIMATION
    # ========================================================

    if len(hits) == 1:

        hit = hits[0]

        return {
            "latitude":
                hit[
                    "latitude"
                ],

            "longitude":
                hit[
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
                hit[
                    "relevance"
                ],

            "description":
                hit[
                    "place_name"
                ],
        }

    # ========================================================
    # NO TITLE LOCALITY → DISTRICT APPROXIMATION
    # ========================================================

    district_hit = geocode_district(
        district,
        state,
    )

    if district_hit:

        return {
            "latitude":
                district_hit[
                    "latitude"
                ],

            "longitude":
                district_hit[
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
                "DISTRICT_APPROX",

            "confidence":
                district_hit[
                    "relevance"
                ],

            "description":
                district_hit[
                    "place_name"
                ],
        }

    # IMPORTANT:
    # There is intentionally NO STATE fallback.

    return None


# ============================================================
# DATABASE
# ============================================================

def load_unmapped():

    db = SessionLocal()

    try:

        projects = db.scalars(
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

                "district":
                    project.district,

                "state":
                    project.state,
            }

            for project
            in projects
        ]

    finally:
        db.close()


def save_mapping(
    project_database_id: int,
    result: dict[str, Any],
):

    db = SessionLocal()

    try:

        project = db.get(
            Project,
            project_database_id,
        )

        if project is None:
            return

        # Never overwrite an existing
        # reviewed location.
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
        help=(
            "Actually write accepted "
            "coordinates to the database."
        ),
    )

    args = parser.parse_args()

    projects = load_unmapped()

    if args.limit > 0:
        projects = projects[
            :args.limit
        ]

    total = len(
        projects
    )

    mode = (
        "APPLY"
        if args.apply
        else "DRY RUN"
    )

    print("=" * 78)
    print(
        "ACQUITWIN MAPTILER GIS RECOVERY"
    )
    print("=" * 78)

    print(
        f"Mode               : {mode}"
    )

    print(
        f"Projects to process: {total}"
    )

    print(
        f"Cache              : {CACHE_FILE}"
    )

    print()

    mapped = 0
    unresolved = 0

    accuracy_counts: dict[
        str,
        int,
    ] = {}

    for index, project in enumerate(
        projects,
        start=1,
    ):

        print(
            f"[{index}/{total}] "
            f"{project['project_id']}"
        )

        print(
            f"    "
            f"{project['project_name']}"
        )

        candidates = (
            extract_place_candidates(
                project[
                    "project_name"
                ]
            )
        )

        print(
            "    Candidates:",
            candidates
            if candidates
            else "NONE",
        )

        result = geocode_project(
            project
        )

        if result is None:

            unresolved += 1

            print(
                "    RESULT     : UNRESOLVED"
            )

            print()

            continue

        mapped += 1

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

        if result.get(
            "start_location"
        ):

            print(
                f"    START      : "
                f"{result['start_location']}"
            )

        if result.get(
            "end_location"
        ):

            print(
                f"    END        : "
                f"{result['end_location']}"
            )

        if args.apply:

            save_mapping(
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

    print("=" * 78)
    print(
        "MAPTILER GIS PASS COMPLETE"
    )
    print("=" * 78)

    print(
        f"Processed : {total}"
    )

    print(
        f"Resolvable: {mapped}"
    )

    print(
        f"Unresolved: {unresolved}"
    )

    print()

    print(
        "Accuracy:"
    )

    for accuracy, count in sorted(
        accuracy_counts.items()
    ):

        print(
            f"  {accuracy:<22} "
            f"{count}"
        )

    if not args.apply:

        print()
        print(
            "DRY RUN ONLY — "
            "NO DATABASE RECORDS WERE CHANGED."
        )


if __name__ == "__main__":
    main()