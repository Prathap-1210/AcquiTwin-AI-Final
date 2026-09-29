from pathlib import Path

import pandas as pd

from app.database.session import SessionLocal
from app.model.project import Project


PROJECT_ROOT = Path(__file__).resolve().parents[2]

DATA_FILE = (
    PROJECT_ROOT
    / "data"
    / "processed"
    / "project_delay"
    / "project_delay_clean.csv"
)


def safe_value(row, column, default=None):

    if column not in row.index:
        return default

    value = row[column]

    if pd.isna(value):
        return default

    return value


def main():

    print("=" * 70)
    print("SEED DEMO PROJECT")
    print("=" * 70)

    if not DATA_FILE.exists():
        raise FileNotFoundError(
            f"Dataset not found:\n{DATA_FILE}"
        )

    df = pd.read_csv(
        DATA_FILE,
        low_memory=False,
    )

    if df.empty:
        raise ValueError(
            "Clean dataset is empty."
        )

    row = df.iloc[0]

    db = SessionLocal()

    try:

        project_code = str(
            safe_value(
                row,
                "project_id",
                "LA-DEMO-001",
            )
        )

        existing = (
            db.query(Project)
            .filter(
                Project.project_id == project_code
            )
            .first()
        )

        if existing:

            print("\nProject already exists.")

            print(
                f"Database ID : {existing.id}"
            )

            print(
                f"Project ID  : {existing.project_id}"
            )

            print(
                f"Project Name: {existing.project_name}"
            )

            return

        total_land = float(
            safe_value(
                row,
                "total_land_area",
                0,
            )
        )

        acquired_land = float(
            safe_value(
                row,
                "acquired_land_area",
                0,
            )
        )

        remaining_land = float(
            safe_value(
                row,
                "remaining_land_area",
                max(
                    total_land - acquired_land,
                    0,
                ),
            )
        )

        latitude = safe_value(
            row,
            "latitude",
            None,
        )

        longitude = safe_value(
            row,
            "longitude",
            None,
        )

        project = Project(

            project_id=project_code,

            project_name=str(
                safe_value(
                    row,
                    "project_name",
                    "Demo Land Acquisition Project",
                )
            ),

            project_type=str(
                safe_value(
                    row,
                    "project_type",
                    "Highway",
                )
            ),

            implementing_agency=str(
                safe_value(
                    row,
                    "implementing_agency",
                    "Demo Agency",
                )
            ),

            state=str(
                safe_value(
                    row,
                    "state",
                    "Tamil Nadu",
                )
            ),

            district=str(
                safe_value(
                    row,
                    "district",
                    "Chennai",
                )
            ),

            latitude=(
                float(latitude)
                if latitude is not None
                else None
            ),

            longitude=(
                float(longitude)
                if longitude is not None
                else None
            ),

            total_land_area=total_land,

            acquired_land_area=acquired_land,

            remaining_land_area=remaining_land,

            current_stage=str(
                safe_value(
                    row,
                    "current_stage",
                    "Notification",
                )
            ),

            risk_score=0.0,

            delay_probability=0.0,

            predicted_delay_days=0,

            is_active=True,

            notes=(
                "Demo project seeded from "
                "prototype synthetic dataset."
            ),
        )

        db.add(project)

        db.commit()

        db.refresh(project)

        print()
        print("=" * 70)
        print("PROJECT CREATED")
        print("=" * 70)

        print(
            f"\nDatabase ID : {project.id}"
        )

        print(
            f"Project ID  : {project.project_id}"
        )

        print(
            f"Project Name: {project.project_name}"
        )

        print(
            f"State       : {project.state}"
        )

        print(
            f"District    : {project.district}"
        )

    except Exception:

        db.rollback()
        raise

    finally:

        db.close()


if __name__ == "__main__":
    main()