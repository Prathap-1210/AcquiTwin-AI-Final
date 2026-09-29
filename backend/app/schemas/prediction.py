from pydantic import BaseModel, Field


class ProjectDelayPredictionRequest(BaseModel):
    project_db_id: int | None = Field(
        default=None,
        ge=1,
    )

    # Administrative
    project_type: str
    state: str
    district: str
    implementing_agency: str
    current_stage: str

    # Legal / dispute
    dispute_severity: float = Field(ge=0)
    rehabilitation_required: int = Field(ge=0, le=1)
    legal_dispute: int = Field(ge=0, le=1)
    stay_order: int = Field(ge=0, le=1)
    ownership_conflict: int = Field(ge=0, le=1)

    # Land / population
    total_land_area: float = Field(gt=0)
    number_of_parcels: int = Field(ge=0)
    number_of_landowners: int = Field(ge=0)
    affected_families: int = Field(ge=0)
    displaced_families: int = Field(ge=0)

    # Time / progress
    days_elapsed: int = Field(ge=0)
    approval_pending_days: int = Field(ge=0)
    documentation_completion_percentage: float = Field(
        ge=0,
        le=100,
    )

    land_acquisition_percentage: float = Field(
        ge=0,
        le=100,
    )

    # Compensation
    compensation_percentage: float = Field(
        ge=0,
        le=100,
    )

    compensation_pending_families: int = Field(
        ge=0
    )

    # Legal cases
    number_of_cases: int = Field(ge=0)

    # Rehabilitation / possession
    rehabilitation_percentage: float = Field(
        ge=0,
        le=100,
    )

    resettlement_percentage: float = Field(
        ge=0,
        le=100,
    )

    possession_percentage: float = Field(
        ge=0,
        le=100,
    )

    # Stakeholder / coordination
    stakeholder_responsiveness: float = Field(
        ge=0,
        le=100,
    )

    number_of_pending_responses: int = Field(
        ge=0
    )

    department_coordination_score: float = Field(
        ge=0,
        le=100,
    )

    # Historical indicators
    district_historical_delay_rate: float = Field(
        ge=0
    )

    agency_historical_delay_rate: float = Field(
        ge=0
    )

    similar_project_delay_rate: float = Field(
        ge=0
    )