from pydantic import BaseModel, Field
from typing import Optional


class ProjectCreate(BaseModel):
    project_id: str = Field(..., min_length=1, max_length=100)
    project_name: str = Field(..., min_length=1, max_length=300)

    project_type: Optional[str] = None
    implementing_agency: Optional[str] = None

    state: Optional[str] = None
    district: Optional[str] = None

    latitude: Optional[float] = None
    longitude: Optional[float] = None

    total_land_area: float
    acquired_land_area: float = 0

    current_stage: Optional[str] = "Planning"

    notes: Optional[str] = None