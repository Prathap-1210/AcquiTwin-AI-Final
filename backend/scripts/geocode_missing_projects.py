from __future__ import annotations

import argparse
import json
import os
import re
import time
from pathlib import Path
from typing import Any

import requests
from sqlalchemy import or_, select

from app.database.session import SessionLocal
from app.model.project import Project


# ============================================================
# CONFIGURATION
# ============================================================

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"

USER_AGENT = (
    "AcquiTwinAI-SIH-Prototype/1.0 "
    "(one-time land-acquisition GIS enrichment)"
)

CONTACT_EMAIL = os.getenv(
    "NOMINATIM_CONTACT_EMAIL",
    "",
).strip()

REQUEST_DELAY_SECONDS = 1.10
REQUEST_TIMEOUT_SECONDS = 25

CACHE_DIR = (
    Path(__file__).resolve().parent
    / ".geocode_cache"
)

CACHE_FILE = (
    CACHE_DIR
    / "nominatim_results.json"
)

CACHE_DIR.mkdir(
    parents=True,
    exist_ok=True,
)


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
    temp_file = CACHE_FILE.with_suffix(
        ".tmp"
    )

    with temp_file.open(
        "w",
        encoding="utf-8",
    ) as file:
        json.dump(
            CACHE,
            file,
            ensure_ascii=False,
            indent=2,
        )

    temp_file.replace(
        CACHE_FILE
    )


# ============================================================
# HTTP SESSION
# ============================================================

HTTP = requests.Session()

HTTP.headers.update(
    {
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
    }
)

_last_request_time = 0.0


# ============================================================
# TEXT HELPERS
# ============================================================

def clean_text(
    value: Any,
) -> str:

    if value is None:
        return ""

    text = str(value)

    text = re.sub(
        r"\s+",
        " ",
        text,
    )

    return text.strip()


def normalized(
    value: Any,
) -> str:

    text = clean_text(
        value
    ).casefold()

    replacements = {
        "orissa": "odisha",
        "uttaranchal": "uttarakhand",
        "pondicherry": "puducherry",
        "nct of delhi": "delhi",
        "national capital territory of delhi": "delhi",
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


# ============================================================
# NOMINATIM REQUEST
# ============================================================

def nominatim_search(
    query: str,
) -> list[dict[str, Any]]:

    global _last_request_time

    query = clean_text(
        query
    )

    if not query:
        return []

    cache_key = query.casefold()

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

    elapsed = (
        time.monotonic()
        - _last_request_time
    )

    remaining = (
        REQUEST_DELAY_SECONDS
        - elapsed
    )

    if remaining > 0:
        time.sleep(
            remaining
        )

    params = {
        "q": query,
        "format": "jsonv2",
        "addressdetails": 1,
        "limit": 5,
        "countrycodes": "in",
    }

    if CONTACT_EMAIL:
        params["email"] = (
            CONTACT_EMAIL
        )

    try:
        response = HTTP.get(
            NOMINATIM_URL,
            params=params,
            timeout=(
                REQUEST_TIMEOUT_SECONDS
            ),
        )

        _last_request_time = (
            time.monotonic()
        )

        response.raise_for_status()

        payload = response.json()

        if not isinstance(
            payload,
            list,
        ):
            payload = []

    except Exception as exc:

        print(
            f"    REQUEST ERROR: {exc}"
        )

        payload = []

    CACHE[
        cache_key
    ] = payload

    save_cache()

    return payload


# ============================================================
# RESULT VALIDATION
# ============================================================

def result_is_in_expected_state(
    result: dict[str, Any],
    expected_state: str,
) -> bool:

    address = (
        result.get("address")
        or {}
    )

    country_code = normalized(
        address.get(
            "country_code"
        )
    )

    if (
        country_code
        and country_code != "in"
    ):
        return False

    if not expected_state:
        return True

    expected = normalized(
        expected_state
    )

    if not expected:
        return True

    candidates = [
        address.get("state"),
        address.get(
            "state_district"
        ),
        result.get(
            "display_name"
        ),
    ]

    combined = normalized(
        " ".join(
            clean_text(value)
            for value
            in candidates
            if value
        )
    )

    return (
        expected in combined
        or combined in expected
    )


def choose_result(
    results: list[dict[str, Any]],
    expected_state: str,
) -> dict[str, Any] | None:

    for result in results:

        if not isinstance(
            result,
            dict,
        ):
            continue

        if not result_is_in_expected_state(
            result,
            expected_state,
        ):
            continue

        try:
            lat = float(
                result["lat"]
            )

            lon = float(
                result["lon"]
            )

        except (
            KeyError,
            TypeError,
            ValueError,
        ):
            continue

        if (
            -90 <= lat <= 90
            and
            -180 <= lon <= 180
        ):
            return result

    return None


# ============================================================
# QUERY GENERATION
# ============================================================

def build_queries(
    project: dict[str, Any],
) -> list[
    tuple[
        str,
        str,
        float,
    ]
]:

    name = clean_text(
        project.get(
            "project_name"
        )
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

    queries: list[
        tuple[
            str,
            str,
            float,
        ]
    ] = []

    # --------------------------------------------------------
    # 1. Project name + district + state
    # --------------------------------------------------------

    if (
        name
        and district
        and state
    ):
        queries.append(
            (
                f"{name[:180]}, "
                f"{district}, "
                f"{state}, India",

                "PROJECT_NAME",

                0.90,
            )
        )

    # --------------------------------------------------------
    # 2. Project name + state
    # --------------------------------------------------------

    if (
        name
        and state
    ):
        queries.append(
            (
                f"{name[:200]}, "
                f"{state}, India",

                "PROJECT_NAME_STATE",

                0.80,
            )
        )

    # --------------------------------------------------------
    # 3. Project name anywhere in India
    # --------------------------------------------------------

    if name:
        queries.append(
            (
                f"{name[:220]}, India",

                "PROJECT_NAME_INDIA",

                0.70,
            )
        )

    # --------------------------------------------------------
    # 4. District administrative fallback
    # --------------------------------------------------------

    if (
        district
        and state
    ):
        queries.append(
            (
                f"{district}, "
                f"{state}, India",

                "DISTRICT_APPROX",

                0.55,
            )
        )

    # --------------------------------------------------------
    # 5. State administrative fallback
    # --------------------------------------------------------

    if state:
        queries.append(
            (
                f"{state}, India",

                "STATE_APPROX",

                0.30,
            )
        )

    # Remove duplicate queries while
    # preserving their order.

    seen: set[str] = set()

    unique = []

    for item in queries:

        key = normalized(
            item[0]
        )

        if (
            not key
            or key in seen
        ):
            continue

        seen.add(
            key
        )

        unique.append(
            item
        )

    return unique


# ============================================================
# GEOCODE ONE PROJECT
# ============================================================

def geocode_project(
    project: dict[str, Any],
):

    state = clean_text(
        project.get(
            "state"
        )
    )

    for (
        query,
        accuracy,
        confidence,
    ) in build_queries(
        project
    ):

        results = (
            nominatim_search(
                query
            )
        )

        result = choose_result(
            results,
            state,
        )

        if result is None:
            continue

        return {
            "latitude": float(
                result["lat"]
            ),

            "longitude": float(
                result["lon"]
            ),

            "accuracy":
                accuracy,

            "confidence":
                confidence,

            "query":
                query,

            "display_name":
                clean_text(
                    result.get(
                        "display_name"
                    )
                ),
        }

    return None


# ============================================================
# LOAD UNMAPPED PROJECTS
# ============================================================

def load_unmapped_projects():
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

                "district":
                    project.district,

                "state":
                    project.state,
            }
            for project in rows
        ]

    finally:
        db.close()


# ============================================================
# SAVE RESULT
# ============================================================

def save_result(
    database_id: int,
    result: dict[str, Any],
) -> None:

    db = SessionLocal()

    try:
        project = db.get(
            Project,
            database_id,
        )

        if project is None:
            return

        # Do not overwrite an existing
        # valid manually-reviewed coordinate.

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

        project.gis_status = (
            "MAPPED"
        )

        project.location_accuracy = (
            result[
                "accuracy"
            ]
        )

        project.location_source = (
            "OpenStreetMap Nominatim"
        )

        project.geocode_confidence = (
            result[
                "confidence"
            ]
        )

        db.commit()

    except Exception:
        db.rollback()
        raise

    finally:
        db.close()


def mark_unresolved(
    database_id: int,
) -> None:

    db = SessionLocal()

    try:
        project = db.get(
            Project,
            database_id,
        )

        if project is None:
            return

        project.gis_status = (
            "UNRESOLVED"
        )

        db.commit()

    except Exception:
        db.rollback()

    finally:
        db.close()


# ============================================================
# MAIN
# ============================================================

def main() -> None:

    parser = argparse.ArgumentParser()

    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help=(
            "Maximum projects to process. "
            "0 means all unmapped projects."
        ),
    )

    args = parser.parse_args()

    projects = (
        load_unmapped_projects()
    )

    if args.limit > 0:
        projects = projects[
            :args.limit
        ]

    total = len(
        projects
    )

    print("=" * 72)
    print(
        "ACQUITWIN GIS RECOVERY"
    )
    print("=" * 72)

    print(
        f"Projects to process: {total}"
    )

    print(
        f"Cache: {CACHE_FILE}"
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
            f"    {project['project_name']}"
        )

        result = geocode_project(
            project
        )

        if result is None:

            unresolved += 1

            mark_unresolved(
                project["id"]
            )

            print(
                "    UNRESOLVED"
            )

            print()

            continue

        save_result(
            project["id"],
            result,
        )

        mapped += 1

        accuracy = (
            result[
                "accuracy"
            ]
        )

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
            "    MAPPED"
        )

        print(
            f"    LAT : "
            f"{result['latitude']}"
        )

        print(
            f"    LNG : "
            f"{result['longitude']}"
        )

        print(
            f"    TYPE: "
            f"{accuracy}"
        )

        print(
            f"    -> "
            f"{result['display_name']}"
        )

        print()

    print("=" * 72)
    print(
        "GEOCODING COMPLETE"
    )
    print("=" * 72)

    print(
        f"Processed  : {total}"
    )

    print(
        f"Mapped     : {mapped}"
    )

    print(
        f"Unresolved : {unresolved}"
    )

    print()

    print(
        "Accuracy breakdown:"
    )

    for (
        accuracy,
        count,
    ) in sorted(
        accuracy_counts.items()
    ):
        print(
            f"  {accuracy:<22} "
            f"{count}"
        )


if __name__ == "__main__":
    main()