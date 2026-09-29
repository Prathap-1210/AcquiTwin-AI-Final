from pydantic import BaseModel, Field


class StageDelayRequest(BaseModel):
    current_stage: str = Field(min_length=1)
    stage_index: int = Field(ge=0)
    state: str = Field(min_length=1)

    paf_count: int = Field(ge=0)
    area: float = Field(ge=0)

    open_litigations: int = Field(ge=0)
    resolved_litigations: int = Field(ge=0)

    compensation_pct: float = Field(ge=0, le=100)
    rehabilitation_progress_pct: float = Field(ge=0, le=100)

    days_in_current_stage: int = Field(ge=0)
    prior_stage_avg_days: float = Field(ge=0)