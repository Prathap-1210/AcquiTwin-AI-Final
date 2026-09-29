const RAW_API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.trim() ||
  "http://127.0.0.1:8000";

const API_BASE_URL = RAW_API_BASE_URL
  .replace(/\/+$/, "")
  .replace(/\/api$/i, "");

export interface StageQualityIssue {
  stage_event_id: number;
  stage_name: string;
  field: string;
  issue: string;
}

export interface StageReadinessResponse {
  success: boolean;
  saved: boolean;
  project_db_id: number;
  readiness_status: string;
  total_records: number;
  recorded_stages: number;
  date_coverage: {
    actual_start_date: number;
    planned_end_date: number;
    actual_completion_date: number;
  };
  quality_issues: StageQualityIssue[];
  note: string;
}

export async function getStageReadiness(
  projectId: number
): Promise<StageReadinessResponse> {
  const response = await fetch(
    `${API_BASE_URL}/api/v1/stage-readiness/projects/${projectId}`
  );

  if (!response.ok) {
    throw new Error(
      `Stage readiness request failed: HTTP ${response.status}`
    );
  }

  const data: StageReadinessResponse = await response.json();

  if (!data.success) {
    throw new Error("Stage readiness analysis failed.");
  }

  return data;
}