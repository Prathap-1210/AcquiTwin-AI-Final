const API_BASE_URL = "http://127.0.0.1:8000";

export interface BottleneckFinding {
  code: string;
  title: string;
  evidence: string;
  finding_type: string;
  days_past_planned_end?: number;
  days_after_planned_end?: number;
}

export interface BottleneckStage {
  stage_event_id: number;
  stage_name: string;
  stage_status: string;
  progress_percentage: number;

  actual_start_date: string | null;
  planned_end_date: string | null;
  actual_completion_date: string | null;
  recorded_at: string | null;

  findings: BottleneckFinding[];
  finding_count: number;
  missing_information: string[];

  source: string;
}

export type BottleneckAnalysisStatus =
  | "insufficient_evidence"
  | "limited_evidence"
  | "conditions_identified";

export interface BottleneckResponse {
  success: boolean;
  saved: boolean;

  project_db_id: number;
  project_name: string;
  analysis_date: string;
  analysis_status: BottleneckAnalysisStatus;

  total_stage_records: number;
  stages_analyzed: number;
  stages_with_findings: number;
  total_findings: number;

  stages: BottleneckStage[];
  note: string;
}

export async function getStageBottlenecks(
  projectId: number
): Promise<BottleneckResponse> {
  if (!Number.isInteger(projectId) || projectId < 1) {
    throw new Error("Invalid project ID.");
  }

  const response = await fetch(
    `${API_BASE_URL}/api/v1/stage-bottlenecks/projects/${projectId}`
  );

  if (!response.ok) {
    const message = await response.text();

    throw new Error(
      `Bottleneck API error (${response.status}): ${message}`
    );
  }

  const result: BottleneckResponse = await response.json();

  if (
    result.success !== true ||
    result.saved !== false ||
    !Array.isArray(result.stages)
  ) {
    throw new Error("Invalid bottleneck API response.");
  }

  return result;
}