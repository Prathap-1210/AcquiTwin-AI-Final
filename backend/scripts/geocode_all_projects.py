from __future__ import annotations

import sys
from pathlib import Path


# ============================================================
# MAKE BACKEND ROOT IMPORTABLE
# ============================================================

BACKEND_DIR = Path(__file__).resolve().parents[1]

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


# ============================================================
# NORMAL IMPORTS
# ============================================================

import csv
import re
import time
from typing import Any, Optional

import requests
from sqlalchemy.orm import Session

from app.database.session import SessionLocal


# ============================================================
# PROJECT MODEL
# ============================================================

try:
    from app.model.project import Project
except ImportError:
    from app.model.project import Project

# ============================================================
# CONFIGURATION
# ============================================================

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"

HEADERS = {
    "User-Agent": "AcquiTwinAI/1.0 land-acquisition-research"
}

# Public geocoding should NOT be hammered with rapid requests.
REQUEST_DELAY_SECONDS = 1.2

REQUEST_TIMEOUT_SECONDS = 30

MAX_RETRIES = 3

RETRY_WAIT_SECONDS = 5


# ============================================================
# SAFETY SETTINGS
# ============================================================

# IMPORTANT:
#
# First test:
#     DRY_RUN = True
#     MAX_PROJECTS = 100
#
# After checking results:
#     DRY_RUN = False
#     MAX_PROJECTS = 100
#
# Eventually:
#     DRY_RUN = False
#     MAX_PROJECTS = None
# ============================================================

DRY_RUN = False

MAX_PROJECTS: Optional[int] = None


# ============================================================
# OUTPUT LOG
# ============================================================

SCRIPT_DIR = Path(__file__).resolve().parent

RESULTS_FILE = SCRIPT_DIR / "geocode_results.csv"


# ============================================================
# INDIA STATES / UTs
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

    # Union Territories
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
# STATE ALIASES
# ============================================================

STATE_ALIASES = {
    "orissa": "odisha",
    "odisha": "odisha",

    "uttaranchal": "uttarakhand",
    "uttarakhand": "uttarakhand",

    "nct of delhi": "delhi",
    "national capital territory of delhi": "delhi",
    "delhi": "delhi",

    "jammu & kashmir": "jammu and kashmir",
    "jammu and kashmir": "jammu and kashmir",

    "pondicherry": "puducherry",
    "puducherry": "puducherry",
}


# ============================================================
# REQUEST SESSION
# ============================================================

http = requests.Session()

http.headers.update(
    HEADERS
)


# ============================================================
# SIMPLE QUERY CACHE
# ============================================================

geocode_cache: dict[
    str,
    Optional[dict[str, Any]]
] = {}


# ============================================================
# TEXT HELPERS
# ============================================================

def clean_text(
    value: Optional[str],
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
        "not recorded",
        "unknown",
    }:
        return None

    return value


def normalize(
    value: Optional[str],
) -> str:

    if not value:
        return ""

    text = str(value).lower().strip()

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
    ).strip()

    return text


def normalize_state(
    value: Optional[str],
) -> str:

    result = normalize(
        value
    )

    return STATE_ALIASES.get(
        result,
        result,
    )


# ============================================================
# EXTRACT STATE FROM PROJECT NAME
# ============================================================

def extract_state_from_project_name(
    project_name: Optional[str],
) -> Optional[str]:

    if not project_name:
        return None

    normalized_name = normalize(
        project_name
    )

    # Longest states first prevents weaker substring matching.
    states = sorted(
        INDIAN_STATES,
        key=len,
        reverse=True,
    )

    for state in states:

        normalized_state = normalize(
            state
        )

        pattern = (
            r"\b"
            + re.escape(normalized_state)
            + r"\b"
        )

        if re.search(
            pattern,
            normalized_name,
        ):
            return state

    # Historical aliases
    if re.search(
        r"\borissa\b",
        normalized_name,
    ):
        return "Odisha"

    if re.search(
        r"\buttaranchal\b",
        normalized_name,
    ):
        return "Uttarakhand"

    if re.search(
        r"\bpondicherry\b",
        normalized_name,
    ):
        return "Puducherry"

    return None


# ============================================================
# DETERMINE BEST STATE
# ============================================================

def get_project_state(
    project: Project,
) -> tuple[Optional[str], str]:

    database_state = clean_text(
        getattr(
            project,
            "state",
            None,
        )
    )

    if database_state:

        return (
            database_state,
            "database",
        )

    extracted_state = (
        extract_state_from_project_name(
            clean_text(
                getattr(
                    project,
                    "project_name",
                    None,
                )
            )
        )
    )

    if extracted_state:

        return (
            extracted_state,
            "project_name",
        )

    return (
        None,
        "unavailable",
    )


# ============================================================
# QUERY BUILDER
# ============================================================

def build_queries(
    project: Project,
) -> list[dict[str, Any]]:

    queries: list[
        dict[str, Any]
    ] = []

    district = clean_text(
        getattr(
            project,
            "district",
            None,
        )
    )

    state, state_source = (
        get_project_state(
            project
        )
    )

    # ========================================================
    # SAFE PASS
    #
    # We require:
    #
    # district/locality + state
    #
    # We intentionally DO NOT query:
    #
    # NH-15, Rajasthan
    # NH-226, Tamil Nadu
    #
    # because this can place a project at an arbitrary point
    # along a very long road.
    # ========================================================

    if district and state:

        queries.append(
            {
                "query":
                    f"{district}, {state}, India",

                "expected_state":
                    state,

                "expected_district":
                    district,

                "accuracy":
                    "ADMIN_AREA",

                "confidence":
                    0.80,

                "source":
                    (
                        "district_state"
                        if state_source == "database"
                        else
                        "district_state_from_project_name"
                    ),
            }
        )

    return queries


# ============================================================
# GEOCODER
# ============================================================

def geocode(
    query: str,
) -> Optional[dict[str, Any]]:

    if query in geocode_cache:

        return geocode_cache[
            query
        ]

    params = {
        "q": query,
        "format": "jsonv2",
        "limit": 5,
        "countrycodes": "in",
        "addressdetails": 1,
    }

    for attempt in range(
        1,
        MAX_RETRIES + 1,
    ):

        try:

            response = http.get(
                NOMINATIM_URL,
                params=params,
                timeout=REQUEST_TIMEOUT_SECONDS,
            )

            # --------------------------------------------
            # Rate limited
            # --------------------------------------------

            if response.status_code == 429:

                print(
                    "Rate limited by geocoder."
                )

                wait_time = (
                    RETRY_WAIT_SECONDS
                    * attempt
                )

                print(
                    f"Waiting {wait_time} seconds..."
                )

                time.sleep(
                    wait_time
                )

                continue

            # --------------------------------------------
            # Temporary server failure
            # --------------------------------------------

            if response.status_code >= 500:

                wait_time = (
                    RETRY_WAIT_SECONDS
                    * attempt
                )

                print(
                    f"Geocoder server error "
                    f"{response.status_code}. "
                    f"Retrying in {wait_time}s..."
                )

                time.sleep(
                    wait_time
                )

                continue

            response.raise_for_status()

            results = response.json()

            if not results:

                geocode_cache[
                    query
                ] = None

                return None

            # Don't blindly select result 0 here.
            #
            # We return all results so project validation
            # can select the first VALID candidate.

            result = {
                "candidates": results
            }

            geocode_cache[
                query
            ] = result

            return result

        except requests.RequestException as exc:

            print(
                f"Request failed "
                f"(attempt {attempt}/"
                f"{MAX_RETRIES}): {exc}"
            )

            if attempt < MAX_RETRIES:

                time.sleep(
                    RETRY_WAIT_SECONDS
                    * attempt
                )

    geocode_cache[
        query
    ] = None

    return None


# ============================================================
# STATE VALIDATION
# ============================================================

def result_matches_state(
    result: dict[str, Any],
    expected_state: Optional[str],
) -> bool:

    if not expected_state:
        return False

    address = result.get(
        "address",
        {},
    )

    returned_state = clean_text(
        address.get(
            "state"
        )
    )

    if not returned_state:

        return False

    return (
        normalize_state(
            expected_state
        )
        ==
        normalize_state(
            returned_state
        )
    )


# ============================================================
# DISTRICT / LOCALITY VALIDATION
# ============================================================

def result_matches_district(
    result: dict[str, Any],
    expected_district: Optional[str],
) -> bool:

    if not expected_district:
        return False

    expected = normalize(
        expected_district
    )

    if not expected:
        return False

    address = result.get(
        "address",
        {},
    )

    possible_values = [
        address.get("county"),
        address.get("state_district"),
        address.get("district"),
        address.get("city_district"),
        address.get("municipality"),
        address.get("city"),
        address.get("town"),
        address.get("village"),
        address.get("suburb"),
    ]

    for value in possible_values:

        normalized_value = (
            normalize(
                value
            )
        )

        if not normalized_value:
            continue

        if (
            expected
            ==
            normalized_value
        ):
            return True

        if (
            expected
            in normalized_value
        ):
            return True

        if (
            normalized_value
            in expected
            and
            len(
                normalized_value
            ) >= 4
        ):
            return True

    # Nominatim sometimes only includes the locality
    # clearly inside display_name.

    display_name = normalize(
        result.get(
            "display_name"
        )
    )

    if expected in display_name:
        return True

    return False


# ============================================================
# COORDINATE VALIDATION
# ============================================================

def valid_coordinates(
    latitude: Any,
    longitude: Any,
) -> bool:

    try:

        lat = float(
            latitude
        )

        lon = float(
            longitude
        )

    except (
        TypeError,
        ValueError,
    ):

        return False

    return (
        -90 <= lat <= 90
        and
        -180 <= lon <= 180
    )


# ============================================================
# SELECT VALID RESULT
# ============================================================

def select_valid_candidate(
    candidates: list[dict[str, Any]],
    expected_state: str,
    expected_district: str,
) -> Optional[dict[str, Any]]:

    for result in candidates:

        if not result_matches_state(
            result,
            expected_state,
        ):
            continue

        if not result_matches_district(
            result,
            expected_district,
        ):
            continue

        if not valid_coordinates(
            result.get("lat"),
            result.get("lon"),
        ):
            continue

        return result

    return None


# ============================================================
# WRITE CSV LOG
# ============================================================

def log_result(
    *,
    project_id: str,
    status: str,
    query: str = "",
    latitude: str = "",
    longitude: str = "",
    location: str = "",
    reason: str = "",
) -> None:

    file_exists = (
        RESULTS_FILE.exists()
    )

    with RESULTS_FILE.open(
        "a",
        newline="",
        encoding="utf-8",
    ) as file:

        writer = csv.writer(
            file
        )

        if not file_exists:

            writer.writerow(
                [
                    "project_id",
                    "status",
                    "query",
                    "latitude",
                    "longitude",
                    "location",
                    "reason",
                ]
            )

        writer.writerow(
            [
                project_id,
                status,
                query,
                latitude,
                longitude,
                location,
                reason,
            ]
        )


# ============================================================
# SAVE RESULT
# ============================================================

def save_result(
    db: Session,
    project: Project,
    result: dict[str, Any],
    query_info: dict[str, Any],
) -> None:

    latitude = float(
        result["lat"]
    )

    longitude = float(
        result["lon"]
    )

    print(
        f"Resolved coordinates: "
        f"{latitude}, {longitude}"
    )

    if DRY_RUN:

        print(
            "DRY RUN -> database not changed"
        )

        return

    try:

        project.latitude = (
            latitude
        )

        project.longitude = (
            longitude
        )

        # These columns should already exist from
        # the migration performed earlier.

        if hasattr(
            project,
            "location_source",
        ):

            project.location_source = (
                "OpenStreetMap Nominatim | "
                + query_info["source"]
            )

        if hasattr(
            project,
            "location_accuracy",
        ):

            project.location_accuracy = (
                query_info["accuracy"]
            )

        if hasattr(
            project,
            "geocode_confidence",
        ):

            project.geocode_confidence = (
                query_info["confidence"]
            )

        db.add(
            project
        )

        db.commit()

        db.refresh(
            project
        )

        print(
            "Saved to database."
        )

    except Exception:

        db.rollback()

        raise


# ============================================================
# PROCESS ONE PROJECT
# ============================================================

def process_project(
    db: Session,
    project: Project,
) -> str:

    project_id = str(
        getattr(
            project,
            "project_id",
            project.id,
        )
    )

    project_name = clean_text(
        getattr(
            project,
            "project_name",
            None,
        )
    )

    district = clean_text(
        getattr(
            project,
            "district",
            None,
        )
    )

    state, state_source = (
        get_project_state(
            project
        )
    )

    print(
        "\n"
        + "=" * 78
    )

    print(
        f"Project : {project_id}"
    )

    print(
        f"State   : {state}"
    )

    print(
        f"State source : {state_source}"
    )

    print(
        f"District/locality : {district}"
    )

    if project_name:

        short_name = (
            project_name[:180]
        )

        print(
            f"Name    : {short_name}"
        )

    # ========================================================
    # ALREADY HAS VALID COORDINATES
    # ========================================================

    existing_latitude = getattr(
        project,
        "latitude",
        None,
    )

    existing_longitude = getattr(
        project,
        "longitude",
        None,
    )

    if valid_coordinates(
        existing_latitude,
        existing_longitude,
    ):

        print(
            "Already mapped -> skipping."
        )

        log_result(
            project_id=project_id,
            status="SKIPPED_ALREADY_MAPPED",
            latitude=str(
                existing_latitude
            ),
            longitude=str(
                existing_longitude
            ),
        )

        return "skipped"

    # ========================================================
    # CREATE SAFE QUERIES
    # ========================================================

    queries = build_queries(
        project
    )

    if not queries:

        reason = (
            "Requires both district/locality "
            "and state for safe first-pass geocoding."
        )

        print(
            "UNRESOLVED ->",
            reason,
        )

        log_result(
            project_id=project_id,
            status="UNRESOLVED",
            reason=reason,
        )

        return "unresolved"

    # ========================================================
    # TRY QUERIES
    # ========================================================

    for query_info in queries:

        query = (
            query_info[
                "query"
            ]
        )

        expected_state = (
            query_info[
                "expected_state"
            ]
        )

        expected_district = (
            query_info[
                "expected_district"
            ]
        )

        print(
            f"Trying: {query}"
        )

        geocode_result = (
            geocode(
                query
            )
        )

        # Respect public geocoder.
        time.sleep(
            REQUEST_DELAY_SECONDS
        )

        if not geocode_result:

            print(
                "No geocoder result."
            )

            continue

        candidates = (
            geocode_result.get(
                "candidates",
                [],
            )
        )

        result = (
            select_valid_candidate(
                candidates,
                expected_state,
                expected_district,
            )
        )

        if not result:

            print(
                "Rejected all candidates: "
                "state/district validation failed."
            )

            continue

        display_name = str(
            result.get(
                "display_name",
                "",
            )
        )

        latitude = float(
            result["lat"]
        )

        longitude = float(
            result["lon"]
        )

        print(
            "VALID MATCH:"
        )

        print(
            display_name
        )

        print(
            f"Latitude : {latitude}"
        )

        print(
            f"Longitude: {longitude}"
        )

        save_result(
            db,
            project,
            result,
            query_info,
        )

        log_result(
            project_id=project_id,
            status=(
                "DRY_RUN_RESOLVED"
                if DRY_RUN
                else
                "RESOLVED"
            ),
            query=query,
            latitude=str(
                latitude
            ),
            longitude=str(
                longitude
            ),
            location=display_name,
        )

        return "resolved"

    # ========================================================
    # NO VALID RESULT
    # ========================================================

    reason = (
        "No geocoder candidate passed "
        "state and district validation."
    )

    print(
        "UNRESOLVED ->",
        reason,
    )

    log_result(
        project_id=project_id,
        status="UNRESOLVED",
        reason=reason,
    )

    return "unresolved"


# ============================================================
# FETCH UNMAPPED PROJECTS
# ============================================================

def get_unmapped_projects(
    db: Session,
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

    if (
        MAX_PROJECTS
        is not None
    ):

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
        + "=" * 78
    )

    print(
        "ACQUITWIN GIS ENRICHMENT"
    )

    print(
        "=" * 78
    )

    print(
        f"Dry run      : {DRY_RUN}"
    )

    print(
        f"Max projects : {MAX_PROJECTS}"
    )

    print(
        f"Output log   : {RESULTS_FILE}"
    )

    db = SessionLocal()

    try:

        projects = (
            get_unmapped_projects(
                db
            )
        )

        total = len(
            projects
        )

        print(
            f"\nProjects to process: "
            f"{total}"
        )

        if total == 0:

            print(
                "No unmapped projects found."
            )

            return

        resolved = 0

        unresolved = 0

        skipped = 0

        failures = 0

        for index, project in enumerate(
            projects,
            start=1,
        ):

            print(
                f"\n[{index}/{total}]"
            )

            try:

                status = (
                    process_project(
                        db,
                        project,
                    )
                )

                if status == "resolved":

                    resolved += 1

                elif status == "skipped":

                    skipped += 1

                else:

                    unresolved += 1

            except KeyboardInterrupt:

                print(
                    "\nStopped by user."
                )

                break

            except Exception as exc:

                failures += 1

                db.rollback()

                project_id = str(
                    getattr(
                        project,
                        "project_id",
                        project.id,
                    )
                )

                print(
                    "ERROR:",
                    exc,
                )

                log_result(
                    project_id=project_id,
                    status="ERROR",
                    reason=str(
                        exc
                    ),
                )

        # ====================================================
        # FINAL SUMMARY
        # ====================================================

        print(
            "\n"
            + "=" * 78
        )

        print(
            "GIS ENRICHMENT COMPLETE"
        )

        print(
            "=" * 78
        )

        print(
            f"Processed  : "
            f"{resolved + unresolved + skipped + failures}"
        )

        print(
            f"Resolved   : {resolved}"
        )

        print(
            f"Unresolved : {unresolved}"
        )

        print(
            f"Skipped    : {skipped}"
        )

        print(
            f"Errors     : {failures}"
        )

        print(
            f"Dry run    : {DRY_RUN}"
        )

        print(
            f"\nDetailed results:"
        )

        print(
            RESULTS_FILE
        )

        if DRY_RUN:

            print(
                "\nDATABASE WAS NOT MODIFIED."
            )

            print(
                "Review the resolved locations "
                "before setting DRY_RUN = False."
            )

    finally:

        db.close()


if __name__ == "__main__":

    main()