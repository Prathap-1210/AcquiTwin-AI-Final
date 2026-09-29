import math

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import select, func
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from app.database.session import SessionLocal
from app.model.project import Project
from app.model.prediction import Prediction
from app.schemas.project import ProjectCreate


router = APIRouter(
    prefix="/api/v1/projects",
    tags=["Projects"],
)


# ============================================================
# SERIALIZE PROJECT
# ============================================================

def serialize_project(project, latest_prediction=None):
    latest = None

    if latest_prediction is not None:
        latest = {
            "prediction_id": latest_prediction.id,
            "delay_probability": latest_prediction.delay_probability,
            "risk_score": latest_prediction.risk_score,
            "risk_level": latest_prediction.risk_level,
            "predicted_delay_days": latest_prediction.predicted_delay_days,
            "model_version": latest_prediction.model_version,
            "created_at": (
                latest_prediction.created_at.isoformat()
                if latest_prediction.created_at
                else None
            ),
        }

    return {
        "id": project.id,
        "project_id": project.project_id,
        "project_name": project.project_name,
        "project_type": project.project_type,
        "implementing_agency": project.implementing_agency,
        "state": project.state,
        "district": project.district,
        "latitude": project.latitude,
        "longitude": project.longitude,
        "total_land_area": project.total_land_area,
        "acquired_land_area": project.acquired_land_area,
        "remaining_land_area": project.remaining_land_area,
        "current_stage": project.current_stage,
        "is_active": project.is_active,
        "latest_prediction": latest,
    }


def get_latest_prediction(db, project_id):
    return db.scalars(
        select(Prediction)
        .where(Prediction.project_id == project_id)
        .order_by(Prediction.id.desc())
        .limit(1)
    ).first()


# ============================================================
# GET ALL PROJECTS
# ============================================================

@router.get("")
def list_projects(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    db = SessionLocal()

    try:
        total = db.scalar(
            select(func.count(Project.id))
        )

        projects = db.scalars(
            select(Project)
            .order_by(Project.id)
            .offset(offset)
            .limit(limit)
        ).all()

        results = []

        for project in projects:
            latest = get_latest_prediction(db, project.id)
            results.append(
                serialize_project(project, latest)
            )

        return {
            "success": True,
            "total_projects": total,
            "count": len(results),
            "projects": results,
        }

    finally:
        db.close()


# ============================================================
# CREATE NEW PROJECT
# ============================================================

@router.post("", status_code=status.HTTP_201_CREATED)
def create_project(payload: ProjectCreate):
    # Clean identifiers and required text.
    project_code = payload.project_id.strip()
    project_name = payload.project_name.strip()

    if not project_code:
        raise HTTPException(
            status_code=422,
            detail="Project ID cannot be empty.",
        )

    if not project_name:
        raise HTTPException(
            status_code=422,
            detail="Project name cannot be empty.",
        )

    # Validate land area.
    total_area = payload.total_land_area
    acquired_area = payload.acquired_land_area

    if not math.isfinite(total_area) or total_area <= 0:
        raise HTTPException(
            status_code=422,
            detail="Total land area must be greater than zero.",
        )

    if not math.isfinite(acquired_area) or acquired_area < 0:
        raise HTTPException(
            status_code=422,
            detail="Acquired land area cannot be negative.",
        )

    if acquired_area > total_area:
        raise HTTPException(
            status_code=422,
            detail="Acquired land area cannot exceed total land area.",
        )

    # Validate optional location.
    if payload.latitude is not None:
        if not math.isfinite(payload.latitude) or not -90 <= payload.latitude <= 90:
            raise HTTPException(
                status_code=422,
                detail="Latitude must be between -90 and 90.",
            )

    if payload.longitude is not None:
        if not math.isfinite(payload.longitude) or not -180 <= payload.longitude <= 180:
            raise HTTPException(
                status_code=422,
                detail="Longitude must be between -180 and 180.",
            )

    # Calculate this value on the backend, not the frontend.
    remaining_area = round(total_area - acquired_area, 6)

    db = SessionLocal()

    try:
        # User-friendly duplicate check.
        existing = db.scalar(
            select(Project.id)
            .where(Project.project_id == project_code)
        )

        if existing is not None:
            raise HTTPException(
                status_code=409,
                detail="A project with this Project ID already exists.",
            )

        project = Project(
            project_id=project_code,
            project_name=project_name,
            project_type=payload.project_type,
            implementing_agency=payload.implementing_agency,
            state=payload.state,
            district=payload.district,
            latitude=payload.latitude,
            longitude=payload.longitude,
            total_land_area=total_area,
            acquired_land_area=acquired_area,
            remaining_land_area=remaining_area,
            current_stage=payload.current_stage or "Planning",
            notes=payload.notes,
            is_active=True,
        )

        db.add(project)
        db.commit()
        db.refresh(project)

        return {
            "success": True,
            "message": "Project created successfully.",
            "project": serialize_project(project),
        }

    except IntegrityError:
        # Also handles two requests creating the same ID simultaneously.
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Project ID already exists or violates a database constraint.",
        )

    except HTTPException:
        db.rollback()
        raise

    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Unable to save the project.",
        )

    finally:
        db.close()


# ============================================================
# GET SINGLE PROJECT
# ============================================================

@router.get("/{project_id}")
def get_project(project_id: int):
    db = SessionLocal()

    try:
        project = db.get(Project, project_id)

        if project is None:
            raise HTTPException(
                status_code=404,
                detail="Project not found",
            )

        latest = get_latest_prediction(
            db,
            project.id,
        )

        return {
            "success": True,
            "project": serialize_project(
                project,
                latest,
            ),
        }

    finally:
        db.close()

        # ============================================================
# UPDATE EXISTING PROJECT
# ============================================================

@router.put("/{project_id}")
def update_project(project_id: int, payload: ProjectCreate):
    db = SessionLocal()

    try:
        project = db.get(Project, project_id)

        if project is None:
            raise HTTPException(
                status_code=404,
                detail="Project not found.",
            )

        # The project code is permanent so existing references
        # and project identity remain consistent.
        if payload.project_id.strip() != project.project_id:
            raise HTTPException(
                status_code=422,
                detail="Project ID cannot be changed.",
            )

        name = payload.project_name.strip()

        if not name:
            raise HTTPException(
                status_code=422,
                detail="Project name cannot be empty.",
            )

        total_area = payload.total_land_area
        acquired_area = payload.acquired_land_area

        if not math.isfinite(total_area) or total_area <= 0:
            raise HTTPException(
                status_code=422,
                detail="Total land area must be greater than zero.",
            )

        if not math.isfinite(acquired_area) or acquired_area < 0:
            raise HTTPException(
                status_code=422,
                detail="Acquired land area cannot be negative.",
            )

        if acquired_area > total_area:
            raise HTTPException(
                status_code=422,
                detail="Acquired land area cannot exceed total land area.",
            )

        if payload.latitude is not None:
            if not math.isfinite(payload.latitude) or not -90 <= payload.latitude <= 90:
                raise HTTPException(
                    status_code=422,
                    detail="Latitude must be between -90 and 90.",
                )

        if payload.longitude is not None:
            if not math.isfinite(payload.longitude) or not -180 <= payload.longitude <= 180:
                raise HTTPException(
                    status_code=422,
                    detail="Longitude must be between -180 and 180.",
                )

        # Update the existing record, never create a new one.
        project.project_name = name
        project.project_type = payload.project_type
        project.implementing_agency = payload.implementing_agency
        project.state = payload.state
        project.district = payload.district
        project.latitude = payload.latitude
        project.longitude = payload.longitude
        project.total_land_area = total_area
        project.acquired_land_area = acquired_area
        project.remaining_land_area = round(
            total_area - acquired_area, 6
        )
        project.current_stage = payload.current_stage or "Planning"
        if payload.notes is not None:
         project.notes = payload.notes

        db.commit()
        db.refresh(project)

        latest = get_latest_prediction(db, project.id)

        return {
            "success": True,
            "message": "Project updated successfully.",
            "project": serialize_project(project, latest),
        }

    except HTTPException:
        db.rollback()
        raise

    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Unable to update project.",
        )

    finally:
        db.close()