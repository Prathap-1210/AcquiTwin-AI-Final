from datetime import date

from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from app.database.session import SessionLocal
from app.model.project import Project
from app.model.project_stage_history import ProjectStageHistory


router = APIRouter(
    prefix="/api/v1/stage-bottlenecks",
    tags=["Stage Bottleneck Detection"],
)


# ============================================================
# HELPERS
# ============================================================

def serialize_date(value):
    return value.isoformat() if value is not None else None


def stage_key(stage_name: str) -> str:
    """
    Group repeated observations of the same stage.
    Stage names are treated as identifiers, not as
    evidence of a specific statutory workflow.
    """
    return stage_name.strip().casefold()


def get_latest_stage_records(records):
    """
    Records are already ordered newest first.
    Keep only the latest observation for each stage.
    """
    latest = {}

    for record in records:
        key = stage_key(record.stage_name)

        if key not in latest:
            latest[key] = record

    return list(latest.values())


# ============================================================
# ANALYZE ONE STAGE
# ============================================================

def analyze_stage(stage, today: date):
    findings = []
    missing_information = []

    start_date = stage.actual_start_date
    planned_end = stage.planned_end_date
    actual_completion = stage.actual_completion_date

    status = (stage.stage_status or "").strip().lower()

    # --------------------------------------------------------
    # CONDITION 1 — ON HOLD
    # --------------------------------------------------------

    if status == "on_hold":
        findings.append(
            {
                "code": "stage_on_hold",
                "title": "Stage recorded as on hold",
                "evidence": (
                    "The latest recorded status of this "
                    "stage is on_hold."
                ),
                "finding_type": "recorded_status",
            }
        )

    # --------------------------------------------------------
    # CONDITION 2 — PLANNED END DATE PASSED
    # --------------------------------------------------------

    if (
        status in {"planned", "in_progress", "on_hold"}
        and planned_end is not None
        and planned_end < today
    ):
        findings.append(
            {
                "code": "planned_end_date_passed",
                "title": "Planned end date has passed",
                "evidence": (
                    f"Planned end: {planned_end.isoformat()}. "
                    f"Analysis date: {today.isoformat()}. "
                    f"Latest recorded status: {status}."
                ),
                "finding_type": "date_comparison",
                "days_past_planned_end": (
                    today - planned_end
                ).days,
            }
        )

    # --------------------------------------------------------
    # CONDITION 3 — COMPLETED AFTER PLANNED END
    # --------------------------------------------------------

    if (
        status == "completed"
        and planned_end is not None
        and actual_completion is not None
        and actual_completion > planned_end
    ):
        findings.append(
            {
                "code": "completed_after_planned_end",
                "title": "Recorded completion after planned end",
                "evidence": (
                    f"Planned end: {planned_end.isoformat()}. "
                    "Recorded actual completion: "
                    f"{actual_completion.isoformat()}."
                ),
                "finding_type": "date_comparison",
                "days_after_planned_end": (
                    actual_completion - planned_end
                ).days,
            }
        )

    # --------------------------------------------------------
    # MISSING INFORMATION
    # --------------------------------------------------------

    if start_date is None:
        missing_information.append(
            "actual_start_date"
        )

    if planned_end is None:
        missing_information.append(
            "planned_end_date"
        )

    if (
        status == "completed"
        and actual_completion is None
    ):
        missing_information.append(
            "actual_completion_date"
        )

    # --------------------------------------------------------
    # RESPONSE FOR THIS STAGE
    # --------------------------------------------------------

    return {
        "stage_event_id": stage.id,
        "stage_name": stage.stage_name,
        "stage_status": stage.stage_status,
        "progress_percentage": stage.progress_percentage,
        "actual_start_date": serialize_date(start_date),
        "planned_end_date": serialize_date(planned_end),
        "actual_completion_date": serialize_date(
            actual_completion
        ),
        "recorded_at": (
            stage.recorded_at.isoformat()
            if stage.recorded_at
            else None
        ),
        "findings": findings,
        "finding_count": len(findings),
        "missing_information": missing_information,
        "source": "manual_entry_unverified",
    }


# ============================================================
# GET BOTTLENECK ANALYSIS
# ============================================================

@router.get("/projects/{project_id}")
def get_project_stage_bottlenecks(
    project_id: int,
):
    if project_id < 1:
        raise HTTPException(
            status_code=422,
            detail="Invalid project ID.",
        )

    today = date.today()

    with SessionLocal() as session:
        # ----------------------------------------------------
        # VERIFY PROJECT
        # ----------------------------------------------------

        project = session.get(
            Project,
            project_id,
        )

        if project is None:
            raise HTTPException(
                status_code=404,
                detail="Project not found.",
            )

        # ----------------------------------------------------
        # READ ALL RECORDED STAGE OBSERVATIONS
        # ----------------------------------------------------

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

        # ----------------------------------------------------
        # NO DATA: DO NOT INVENT BOTTLENECKS
        # ----------------------------------------------------

        if not records:
            return {
                "success": True,
                "saved": False,
                "project_db_id": project_id,
                "project_name": project.project_name,
                "analysis_date": today.isoformat(),
                "analysis_status": "insufficient_evidence",
                "total_stage_records": 0,
                "stages_analyzed": 0,
                "stages_with_findings": 0,
                "total_findings": 0,
                "stages": [],
                "note": (
                    "No stage events have been recorded. "
                    "Bottlenecks cannot be assessed from "
                    "the available stage-history data."
                ),
            }

        # ----------------------------------------------------
        # USE LATEST RECORD FOR EACH STAGE
        # ----------------------------------------------------

        latest_records = get_latest_stage_records(
            records
        )

        stages = [
            analyze_stage(stage, today)
            for stage in latest_records
        ]

        stages_with_findings = sum(
            1
            for stage in stages
            if stage["finding_count"] > 0
        )

        total_findings = sum(
            stage["finding_count"]
            for stage in stages
        )

        if total_findings > 0:
            analysis_status = "conditions_identified"
        else:
            analysis_status = "limited_evidence"

        return {
            "success": True,
            "saved": False,
            "project_db_id": project_id,
            "project_name": project.project_name,
            "analysis_date": today.isoformat(),
            "analysis_status": analysis_status,
            "total_stage_records": len(records),
            "stages_analyzed": len(stages),
            "stages_with_findings": stages_with_findings,
            "total_findings": total_findings,
            "stages": stages,
            "note": (
                "This is a rules-based analysis of the "
                "latest manually entered stage records. "
                "Dates and statuses have not been "
                "independently verified. A lack of findings "
                "does not establish that a project has no "
                "bottlenecks. This endpoint does not "
                "provide a causal explanation or an "
                "ML delay-duration prediction."
            ),
        }