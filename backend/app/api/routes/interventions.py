from __future__ import annotations

from math import isfinite

from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select

from app.database.session import SessionLocal
from app.model.intervention import Intervention
from app.model.prediction import Prediction

from app.api.routes.what_if import (
    WhatIfRequest,
    run_what_if,
)


# ============================================================
# ROUTER
# ============================================================

router = APIRouter(
    prefix="/api/v1/interventions",
    tags=["Intervention Scenarios"],
)


# ============================================================
# REQUEST
# ============================================================

class InterventionRequest(BaseModel):
    project_db_id: int = Field(ge=1)


class SaveInterventionRequest(BaseModel):
    project_db_id: int = Field(ge=1)
    source_prediction_id: int = Field(ge=1)
    candidate_id: str | None = Field(default=None, min_length=1, max_length=150)
    changes: dict[str, Any] | None = Field(default=None, min_length=1, max_length=31)
    notes: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def select_one_scenario(self):
        if (self.candidate_id is None) == (self.changes is None):
            raise ValueError("Provide either candidate_id or changes.")
        return self


# ============================================================
# HELPERS
# ============================================================

def get_numeric(snapshot: dict, feature: str):
    value = snapshot.get(feature)

    if value is None:
        return None

    try:
        number = float(value)
    except (TypeError, ValueError):
        return None

    if not isfinite(number):
        return None

    return number


def add_candidate(
    candidates: list,
    candidate_id: str,
    title: str,
    description: str,
    changes: dict,
):
    if not changes:
        return

    candidates.append({
        "candidate_id": candidate_id,
        "title": title,
        "description": description,
        "changes": changes,
    })


# ============================================================
# GENERATE CANDIDATE SCENARIOS
# ============================================================

def generate_candidates(snapshot: dict) -> list:
    candidates = []

    # --------------------------------------------------------
    # 1. APPROVAL PROCESS SCENARIO
    # --------------------------------------------------------

    approval_days = get_numeric(
        snapshot,
        "approval_pending_days",
    )

    if approval_days is not None and approval_days > 0:
        proposed = max(
            0,
            int(approval_days) - 15,
        )

        if proposed != approval_days:
            add_candidate(
                candidates,
                "approval_processing",
                "Shorter approval processing",
                (
                    "Hypothetical reduction of pending approval "
                    "time by up to 15 days."
                ),
                {
                    "approval_pending_days": proposed,
                },
            )

    # --------------------------------------------------------
    # 2. COMPENSATION SCENARIO
    # --------------------------------------------------------

    compensation = get_numeric(
        snapshot,
        "compensation_percentage",
    )

    if (
        compensation is not None
        and 0 <= compensation < 100
    ):
        proposed = round(
            min(100, compensation + 15),
            2,
        )

        if proposed != compensation:
            add_candidate(
                candidates,
                "compensation_progress",
                "Higher compensation completion",
                (
                    "Hypothetical increase of compensation "
                    "completion by up to 15 percentage points."
                ),
                {
                    "compensation_percentage": proposed,
                },
            )

    # --------------------------------------------------------
    # 3. DOCUMENTATION SCENARIO
    # --------------------------------------------------------

    documentation = get_numeric(
        snapshot,
        "documentation_completion_percentage",
    )

    if (
        documentation is not None
        and 0 <= documentation < 100
    ):
        proposed = round(
            min(100, documentation + 15),
            2,
        )

        if proposed != documentation:
            add_candidate(
                candidates,
                "documentation_progress",
                "Higher documentation completion",
                (
                    "Hypothetical increase of documentation "
                    "completion by up to 15 percentage points."
                ),
                {
                    "documentation_completion_percentage": proposed,
                },
            )

    # --------------------------------------------------------
    # 4. POSSESSION SCENARIO
    # --------------------------------------------------------

    possession = get_numeric(
        snapshot,
        "possession_percentage",
    )

    if (
        possession is not None
        and 0 <= possession < 100
    ):
        proposed = round(
            min(100, possession + 5),
            2,
        )

        if proposed != possession:
            add_candidate(
                candidates,
                "possession_progress",
                "Higher possession completion",
                (
                    "Hypothetical increase of possession "
                    "completion by up to 5 percentage points."
                ),
                {
                    "possession_percentage": proposed,
                },
            )

    # --------------------------------------------------------
    # 5. LEGAL CASE SCENARIO
    # --------------------------------------------------------

    cases = get_numeric(
        snapshot,
        "number_of_cases",
    )

    if cases is not None and cases > 0:
        proposed = max(
            0,
            int(cases) - 2,
        )

        if proposed != cases:
            add_candidate(
                candidates,
                "legal_case_resolution",
                "Fewer pending legal cases",
                (
                    "Hypothetical resolution of up to "
                    "two legal cases."
                ),
                {
                    "number_of_cases": proposed,
                },
            )

    # --------------------------------------------------------
    # 6. COMBINED LEGAL RESOLUTION
    # --------------------------------------------------------

    legal_dispute = get_numeric(
        snapshot,
        "legal_dispute",
    )

    if legal_dispute == 1 and cases is not None:
        add_candidate(
            candidates,
            "combined_legal_resolution",
            "Resolved legal disputes and cases",
            (
                "Hypothetical scenario in which the legal "
                "dispute is resolved and all associated "
                "recorded cases are closed. This is an "
                "assumption, not a confirmed action."
            ),
            {
                "legal_dispute": 0,
                "number_of_cases": 0,
            },
        )

    return candidates


def intervention_response(record: Intervention) -> dict:
    return {
        "id": record.id,
        "project_db_id": record.project_id,
        "intervention_type": record.intervention_type,
        "target_feature": record.target_feature,
        "current_value": record.current_value,
        "proposed_value": record.proposed_value,
        "original_risk": record.original_risk,
        "simulated_risk": record.simulated_risk,
        "estimated_risk_reduction": record.estimated_risk_reduction,
        "status": record.status,
        "details": record.details,
        "notes": record.notes,
        "created_at": record.created_at.isoformat(),
    }


# ============================================================
# INTERVENTION SCENARIO ENDPOINT
# ============================================================

@router.post("/candidates")
def evaluate_intervention_candidates(
    request: InterventionRequest,
):
    # --------------------------------------------------------
    # 1. READ LATEST SAVED SNAPSHOT
    # --------------------------------------------------------

    with SessionLocal() as db:
        latest = db.scalar(
            select(Prediction)
            .where(
                Prediction.project_id == request.project_db_id
            )
            .order_by(Prediction.id.desc())
            .limit(1)
        )

        if latest is None:
            raise HTTPException(
                status_code=404,
                detail="No saved prediction found for this project.",
            )

        if not isinstance(latest.input_snapshot, dict):
            raise HTTPException(
                status_code=409,
                detail="Latest prediction has no valid input snapshot.",
            )

        source_prediction_id = latest.id
        snapshot = dict(latest.input_snapshot)

    # --------------------------------------------------------
    # 2. GENERATE CANDIDATE SCENARIOS
    # --------------------------------------------------------

    candidates = generate_candidates(snapshot)

    # --------------------------------------------------------
    # 3. EVALUATE EACH CANDIDATE
    # --------------------------------------------------------

    evaluated = []

    for candidate in candidates:
        simulation = run_what_if(
            WhatIfRequest(
                project_db_id=request.project_db_id,
                changes=candidate["changes"],
            )
        )

        # Ensure all candidates use the same saved baseline.
        if (
            simulation["source_prediction_id"]
            != source_prediction_id
        ):
            raise HTTPException(
                status_code=409,
                detail=(
                    "The latest prediction changed during "
                    "evaluation. Refresh and try again."
                ),
            )

        evaluated.append({
            "candidate_id": candidate["candidate_id"],
            "title": candidate["title"],
            "description": candidate["description"],
            "changes": candidate["changes"],
            "baseline": simulation["baseline"]["prediction"],
            "scenario": simulation["scenario"]["prediction"],
            "comparison": simulation["comparison"],
        })

    # --------------------------------------------------------
    # 4. RETURN READ-ONLY RESULTS
    # --------------------------------------------------------

    return {
        "success": True,
        "saved": False,
        "project_db_id": request.project_db_id,
        "source_prediction_id": source_prediction_id,
        "total_candidates": len(evaluated),
        "candidates": evaluated,
        "note": (
            "These are hypothetical model-input scenarios, "
            "not validated intervention recommendations. "
            "Results are model sensitivities, not proven "
            "causal effects. The model is trained on "
            "synthetic data. No prediction records "
            "were saved."
        ),
    }


@router.post("/save", status_code=201)
def save_intervention(request: SaveInterventionRequest):
    """Save a selected candidate or custom what-if result as a proposal."""
    with SessionLocal() as db:
        latest = db.scalar(
            select(Prediction)
            .where(Prediction.project_id == request.project_db_id)
            .order_by(Prediction.id.desc())
            .limit(1)
        )
        if latest is None:
            raise HTTPException(404, "No saved prediction found for this project.")
        if latest.id != request.source_prediction_id:
            raise HTTPException(409, "Prediction changed. Run the scenario again.")
        if not isinstance(latest.input_snapshot, dict):
            raise HTTPException(409, "Latest prediction has no valid input snapshot.")

        if request.candidate_id is not None:
            candidate = next(
                (item for item in generate_candidates(latest.input_snapshot)
                 if item["candidate_id"] == request.candidate_id),
                None,
            )
            if candidate is None:
                raise HTTPException(422, "Candidate is unavailable for this prediction.")
            changes = candidate["changes"]
            intervention_type = candidate["candidate_id"]
            title = candidate["title"]
            description = candidate["description"]
        else:
            changes = request.changes
            intervention_type = "custom_what_if"
            title = "Custom what-if scenario"
            description = "Officer-selected hypothetical input changes."

    # Recompute on the server. Do not trust risk scores supplied by the client.
    simulation = run_what_if(
        WhatIfRequest(project_db_id=request.project_db_id, changes=changes)
    )
    if simulation["source_prediction_id"] != request.source_prediction_id:
        raise HTTPException(409, "Prediction changed. Run the scenario again.")

    baseline_risk = float(simulation["baseline"]["prediction"]["risk_score"])
    simulated_risk = float(simulation["scenario"]["prediction"]["risk_score"])
    baseline_inputs = simulation["baseline"]["inputs"]
    changed_features = simulation["changed_features"]
    feature = next(iter(changed_features)) if len(changed_features) == 1 else None

    record = Intervention(
        project_id=request.project_db_id,
        intervention_type=intervention_type,
        target_feature=feature,
        current_value=get_numeric(baseline_inputs, feature) if feature else None,
        proposed_value=get_numeric(changed_features, feature) if feature else None,
        original_risk=baseline_risk,
        simulated_risk=simulated_risk,
        estimated_risk_reduction=round(baseline_risk - simulated_risk, 2),
        status="PROPOSED",
        details=jsonable_encoder({
            "source_prediction_id": request.source_prediction_id,
            "candidate_id": request.candidate_id,
            "title": title,
            "description": description,
            "changed_features": changed_features,
            "baseline_prediction": simulation["baseline"]["prediction"],
            "scenario_prediction": simulation["scenario"]["prediction"],
            "comparison": simulation["comparison"],
            "model": simulation["model"],
            "source": "synthetic_model_scenario_unverified",
        }),
        notes=request.notes,
    )

    with SessionLocal() as db:
        # Recheck before writing in case another prediction was saved during ML work.
        current_id = db.scalar(
            select(Prediction.id)
            .where(Prediction.project_id == request.project_db_id)
            .order_by(Prediction.id.desc())
            .limit(1)
        )
        if current_id != request.source_prediction_id:
            raise HTTPException(409, "Prediction changed. Run the scenario again.")
        db.add(record)
        db.commit()
        db.refresh(record)
        return {"success": True, "saved": True, "intervention": intervention_response(record)}


@router.get("/projects/{project_id}")
def get_intervention_history(project_id: int):
    if project_id < 1:
        raise HTTPException(422, "project_id must be positive.")
    with SessionLocal() as db:
        records = db.scalars(
            select(Intervention)
            .where(Intervention.project_id == project_id)
            .order_by(Intervention.id.desc())
        ).all()
        return {
            "success": True,
            "project_db_id": project_id,
            "total": len(records),
            "interventions": [intervention_response(item) for item in records],
        }
