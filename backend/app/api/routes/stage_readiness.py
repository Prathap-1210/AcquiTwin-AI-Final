from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from app.database.session import SessionLocal
from app.model.project import Project
from app.model.project_stage_history import ProjectStageHistory


router = APIRouter(
    prefix="/api/v1/stage-readiness",
    tags=["Stage Data Readiness"],
)


@router.get("/projects/{project_id}")
def get_stage_readiness(project_id: int):

    if project_id < 1:
        raise HTTPException(
            status_code=422,
            detail="Invalid project ID.",
        )

    with SessionLocal() as session:

        project = session.get(Project, project_id)

        if project is None:
            raise HTTPException(
                status_code=404,
                detail="Project not found.",
            )

        records = session.scalars(
            select(ProjectStageHistory)
            .where(
                ProjectStageHistory.project_id == project_id
            )
            .order_by(
                ProjectStageHistory.recorded_at.desc(),
                ProjectStageHistory.id.desc(),
            )
        ).all()

        if not records:
            return {
                "success": True,
                "saved": False,
                "project_db_id": project_id,
                "readiness_status": "no_stage_records",
                "total_records": 0,
                "recorded_stages": 0,
                "date_coverage": {
                    "actual_start_date": 0,
                    "planned_end_date": 0,
                    "actual_completion_date": 0,
                },
                "quality_issues": [],
                "note": (
                    "No stage events are recorded. "
                    "Data readiness cannot be assessed."
                ),
            }

        # Use the newest record for each recorded stage.
        latest_by_stage = {}

        for record in records:
            key = record.stage_name.strip().casefold()

            if key not in latest_by_stage:
                latest_by_stage[key] = record

        stages = list(latest_by_stage.values())

        date_coverage = {
            "actual_start_date": 0,
            "planned_end_date": 0,
            "actual_completion_date": 0,
        }

        quality_issues = []

        for stage in stages:

            if stage.actual_start_date is not None:
                date_coverage["actual_start_date"] += 1

            if stage.planned_end_date is not None:
                date_coverage["planned_end_date"] += 1

            if stage.actual_completion_date is not None:
                date_coverage["actual_completion_date"] += 1

            if stage.planned_end_date is None:
                quality_issues.append({
                    "stage_event_id": stage.id,
                    "stage_name": stage.stage_name,
                    "field": "planned_end_date",
                    "issue": "Planned end date is missing.",
                })

            if (
                stage.stage_status == "completed"
                and stage.actual_completion_date is None
            ):
                quality_issues.append({
                    "stage_event_id": stage.id,
                    "stage_name": stage.stage_name,
                    "field": "actual_completion_date",
                    "issue": (
                        "The stage is marked completed "
                        "but its completion date is missing."
                    ),
                })

            if (
                stage.actual_start_date is not None
                and stage.actual_completion_date is not None
                and stage.actual_completion_date
                < stage.actual_start_date
            ):
                quality_issues.append({
                    "stage_event_id": stage.id,
                    "stage_name": stage.stage_name,
                    "field": "actual_completion_date",
                    "issue": (
                        "Completion date precedes start date."
                    ),
                })

        readiness_status = (
            "quality_issues_identified"
            if quality_issues
            else "available_records_checked"
        )

        return {
            "success": True,
            "saved": False,
            "project_db_id": project_id,
            "readiness_status": readiness_status,
            "total_records": len(records),
            "recorded_stages": len(stages),
            "date_coverage": date_coverage,
            "quality_issues": quality_issues,
            "note": (
                "Checks cover only the latest manually "
                "entered record for each recorded stage. "
                "This is not independent verification, "
                "and it does not establish completeness "
                "of the full acquisition lifecycle."
            ),
        }