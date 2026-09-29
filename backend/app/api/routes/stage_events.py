from datetime import date

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select

from app.database.session import SessionLocal
from app.model.project_stage_history import ProjectStageHistory
from app.model.project import Project


router = APIRouter(
    prefix="/api/v1/stage-events",
    tags=["Stage Events"],
)


# ============================================================
# REQUEST SCHEMA
# ============================================================

class StageEventCreate(BaseModel):
    stage_name: str = Field(
        min_length=1,
        max_length=100,
    )

    stage_status: str = Field(
        pattern="^(planned|in_progress|on_hold|completed)$"
    )

    progress_percentage: float = Field(
        ge=0,
        le=100,
    )

    actual_start_date: date | None = None
    planned_end_date: date | None = None
    actual_completion_date: date | None = None

    notes: str | None = None

    @model_validator(mode="after")
    def validate_dates(self):
        # Completion date cannot be earlier than start date.
        if (
            self.actual_start_date is not None
            and self.actual_completion_date is not None
            and self.actual_completion_date < self.actual_start_date
        ):
            raise ValueError(
                "Completion date cannot be before start date."
            )

        # Completed stages must have a completion date.
        if (
            self.stage_status == "completed"
            and self.actual_completion_date is None
        ):
            raise ValueError(
                "Completed stages require an actual completion date."
            )

        # Non-completed stages must not have a completion date.
        if (
            self.stage_status != "completed"
            and self.actual_completion_date is not None
        ):
            raise ValueError(
                "Only completed stages may have an actual completion date."
            )

        return self


# ============================================================
# SERIALIZER
# ============================================================

def serialize_event(event: ProjectStageHistory):
    return {
        "id": event.id,
        "project_id": event.project_id,
        "stage_name": event.stage_name,
        "stage_status": event.stage_status,
        "progress_percentage": event.progress_percentage,
        "actual_start_date": event.actual_start_date,
        "planned_end_date": event.planned_end_date,
        "actual_completion_date": event.actual_completion_date,
        "notes": event.notes,
        "recorded_at": event.recorded_at,
        "source": "manual_entry_unverified",
    }


# ============================================================
# GET STAGE EVENTS FOR PROJECT
# ============================================================

@router.get("/projects/{project_id}")
def get_stage_events(project_id: int):
    with SessionLocal() as session:
        project = session.get(
            Project,
            project_id,
        )

        if project is None:
            raise HTTPException(
                status_code=404,
                detail="Project not found.",
            )

        events = session.scalars(
            select(ProjectStageHistory)
            .where(
                ProjectStageHistory.project_id == project_id
            )
            .order_by(
                ProjectStageHistory.recorded_at.desc(),
                ProjectStageHistory.id.desc(),
            )
            .limit(200)
        ).all()

        return {
            "success": True,
            "project_db_id": project_id,
            "total_events": len(events),
            "events": [
                serialize_event(event)
                for event in events
            ],
            "note": (
                "Manually entered stage events are not "
                "independently verified."
            ),
        }


# ============================================================
# CREATE STAGE EVENT
# ============================================================

@router.post(
    "/projects/{project_id}",
    status_code=201,
)
def create_stage_event(
    project_id: int,
    request: StageEventCreate,
):
    with SessionLocal() as session:
        project = session.get(
            Project,
            project_id,
        )

        if project is None:
            raise HTTPException(
                status_code=404,
                detail="Project not found.",
            )

        stage_name = request.stage_name.strip()

        if not stage_name:
            raise HTTPException(
                status_code=422,
                detail="Stage name cannot be empty.",
            )

        event = ProjectStageHistory(
            project_id=project_id,
            stage_name=stage_name,
            stage_status=request.stage_status,
            progress_percentage=request.progress_percentage,
            actual_start_date=request.actual_start_date,
            planned_end_date=request.planned_end_date,
            actual_completion_date=request.actual_completion_date,
            notes=request.notes,
        )

        session.add(event)

        # ----------------------------------------------------
        # SYNCHRONIZE PROJECT CURRENT STAGE
        # ----------------------------------------------------
        #
        # Only an active or paused stage should replace the
        # project's current-stage summary.
        #
        # A "planned" stage may refer to a future stage and
        # therefore should not replace the current stage.
        #
        # A "completed" stage is stored in the stage history,
        # but the backend does not automatically guess which
        # stage comes next.
        # ----------------------------------------------------

        if request.stage_status in {
            "in_progress",
            "on_hold",
        }:
            project.current_stage = stage_name

        session.commit()

        session.refresh(event)
        session.refresh(project)

        return {
            "success": True,
            "saved": True,
            "project_current_stage": project.current_stage,
            "event": serialize_event(event),
        }