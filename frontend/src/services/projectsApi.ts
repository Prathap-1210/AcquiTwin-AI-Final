// ============================================================
// LAND ACQUISITION AI — API SERVICE
// ============================================================

// ============================================================
// API BASE URL
// ============================================================

const RAW_API_URL =
  import.meta.env.VITE_API_BASE_URL?.trim() ||
  "http://127.0.0.1:8000";

// Existing API functions already append paths such as:
// /api/v1/projects
//
// Therefore, if VITE_API_BASE_URL ends with "/api",
// remove that final "/api" here to avoid:
// /api/api/v1/projects

const API_URL = RAW_API_URL
  .replace(/\/+$/, "")
  .replace(/\/api$/i, "");

// ============================================================
// PROJECT TYPES
// ============================================================

export interface LatestPrediction {
  prediction_id: number;
  delay_probability: number;
  risk_score: number;
  risk_level: string;
  predicted_delay_days: number;
  model_version: string;
  created_at: string | null;
}

export interface Project {
  id: number;
  project_id: string;
  project_name: string;
  project_type: string;
  implementing_agency: string;
  state: string;
  district: string;

  latitude: number | null;
  longitude: number | null;

  total_land_area: number | null;
  acquired_land_area: number | null;
  remaining_land_area: number | null;

  current_stage: string;
  is_active: boolean;

  latest_prediction: LatestPrediction | null;
}

// ============================================================
// RISK FACTOR TYPES
// ============================================================

export interface RiskFactor {
  feature: string;
  value: string | null;
  contribution: number;
  rank: number;
  direction: string;
}

// ============================================================
// PREDICTION HISTORY TYPES
// ============================================================

export interface HistoryEntry extends LatestPrediction {
  project_id: number;

  input_snapshot: Record<string, unknown> | null;

  risk_factors: RiskFactor[];
}

// ============================================================
// PROJECT API RESPONSE TYPES
// ============================================================

export interface ProjectsResponse {
  success: boolean;
  total_projects: number;
  count: number;
  projects: Project[];
}

export interface SingleProjectResponse {
  success: boolean;
  project: Project;
}

export interface HistoryResponse {
  success: boolean;
  project_id: number;
  total_predictions: number;
  history: HistoryEntry[];
}

// ============================================================
// PREDICTION REQUEST TYPES
// ============================================================

export type PredictionPayload = {
  project_db_id: number;

  [key: string]: string | number;
};

// ============================================================
// PREDICTION RESULT TYPES
// ============================================================

export interface PredictionResult {
  delay_probability: number;
  delay_probability_percent: number;

  predicted_delay_status: number;
  predicted_delay: boolean;

  risk_score: number;
  risk_level: string;

  conditional_delay_days: number;
  expected_delay_days: number;
}

export interface PredictionExplanation {
  method: string;

  top_factors: Array<Record<string, unknown>>;

  risk_increasing_factors?: Array<Record<string, unknown>>;

  risk_reducing_factors?: Array<Record<string, unknown>>;

  note?: string;
}

export interface PredictionModelInfo {
  classifier: string;
  delay_regressor: string;

  classifier_cv_accuracy?: number;
  classifier_cv_roc_auc?: number;

  delay_regressor_mae_days?: number;

  prototype_data: string;
}

export interface RunPredictionResponse {
  success: boolean;
  saved: boolean;

  prediction_id: number | null;
  project_db_id: number | null;

  data: {
    prediction: PredictionResult;

    explanation: PredictionExplanation;

    model: PredictionModelInfo;
  };
}

// ============================================================
// API RESPONSE HANDLER
// ============================================================

async function handleResponse<T>(
  response: Response
): Promise<T> {
  if (!response.ok) {
    let message = response.statusText;

    try {
      const errorData: unknown = await response.json();

      if (
        typeof errorData === "object" &&
        errorData !== null &&
        "detail" in errorData
      ) {
        const detail = errorData.detail;

        message =
          typeof detail === "string"
            ? detail
            : JSON.stringify(detail);
      }
    } catch {
      // Keep the HTTP status message if JSON parsing fails.
    }

    throw new Error(
      `API error ${response.status}: ${message}`
    );
  }

  return (await response.json()) as T;
}

// ============================================================
// GENERIC GET REQUEST
// ============================================================

async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: "GET",

    headers: {
      Accept: "application/json",
    },
  });

  return handleResponse<T>(response);
}

// ============================================================
// GENERIC POST REQUEST
// ============================================================

async function apiPost<T>(
  path: string,
  payload: unknown
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",

    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },

    body: JSON.stringify(payload),
  });

  return handleResponse<T>(response);
}

// ============================================================
// GET ALL PROJECTS
// ============================================================

export async function getProjects(
  limit = 100,
  offset = 0
): Promise<ProjectsResponse> {
  const data = await apiGet<ProjectsResponse>(
    `/api/v1/projects?limit=${limit}&offset=${offset}`
  );

  if (!data.success || !Array.isArray(data.projects)) {
    throw new Error("Invalid projects API response.");
  }

  return data;
}

// ============================================================
// GET SINGLE PROJECT
// ============================================================

export async function getProject(
  projectId: number
): Promise<SingleProjectResponse> {
  return apiGet<SingleProjectResponse>(
    `/api/v1/projects/${projectId}`
  );
}

// ============================================================
// GET PREDICTION HISTORY
// ============================================================

export async function getPredictionHistory(
  projectId: number
): Promise<HistoryResponse> {
  const data = await apiGet<HistoryResponse>(
    `/api/v1/predictions/projects/${projectId}/history`
  );

  if (!data.success || !Array.isArray(data.history)) {
    throw new Error("Invalid prediction history response.");
  }

  return data;
}

// ============================================================
// RUN NEW PREDICTION
// ============================================================

export async function runProjectPrediction(
  payload: PredictionPayload
): Promise<RunPredictionResponse> {
  const data = await apiPost<RunPredictionResponse>(
    "/api/v1/predictions/project-delay",
    payload
  );

  // This endpoint is expected to save an actual
  // prediction record for the selected project.

  if (
    !data.success ||
    data.saved !== true ||
    data.prediction_id === null
  ) {
    throw new Error(
      "The API did not confirm that the prediction was saved."
    );
  }

  return data;
}

// ============================================================
// WHAT-IF SIMULATION — PREDICTION TYPES
// ============================================================

export interface WhatIfPrediction {
  delay_probability: number;
  risk_score: number;
  risk_level: string;

  expected_delay_days: number;

  delay_probability_percent?: number;
  predicted_delay_status?: number;
  predicted_delay?: boolean;
  conditional_delay_days?: number;
}

// ============================================================
// WHAT-IF SIMULATION — EXPLANATION TYPES
// ============================================================

// The simulation backend returns a separate explanation
// for both the baseline and the edited scenario.

export interface WhatIfExplanation {
  method?: string;

  top_factors?: Array<Record<string, unknown>>;

  risk_increasing_factors?: Array<Record<string, unknown>>;

  risk_reducing_factors?: Array<Record<string, unknown>>;

  note?: string;
}

// ============================================================
// WHAT-IF SIMULATION — SCENARIO TYPES
// ============================================================

export interface WhatIfScenario {
  inputs: Record<string, unknown>;

  prediction: WhatIfPrediction;

  explanation?: WhatIfExplanation;
}

// ============================================================
// WHAT-IF SIMULATION — COMPARISON TYPES
// ============================================================

export interface WhatIfComparison {
  risk_score_delta: number;

  expected_delay_days_delta: number;
}

// ============================================================
// WHAT-IF SIMULATION — RESPONSE TYPE
// ============================================================

export interface WhatIfResponse {
  success: boolean;

  // A simulation must not create a prediction record.
  saved: boolean;

  project_db_id: number;

  source_prediction_id: number;

  changed_features: Record<string, number>;

  // Original prediction inputs evaluated using
  // the currently loaded ML models.
  baseline: WhatIfScenario;

  // Modified hypothetical inputs evaluated using
  // the same currently loaded ML models.
  scenario: WhatIfScenario;

  comparison: WhatIfComparison;

  model?: PredictionModelInfo;

  note: string;
}

// ============================================================
// RUN WHAT-IF SIMULATION
// ============================================================

export async function runWhatIfSimulation(
  projectId: number,
  changes: Record<string, number>
): Promise<WhatIfResponse> {
  // ----------------------------------------------------------
  // VALIDATE PROJECT ID
  // ----------------------------------------------------------

  if (
    !Number.isInteger(projectId) ||
    projectId < 1
  ) {
    throw new Error("Invalid project ID.");
  }

  // ----------------------------------------------------------
  // VALIDATE CHANGES
  // ----------------------------------------------------------

  if (Object.keys(changes).length === 0) {
    throw new Error(
      "Change at least one feature before running a simulation."
    );
  }

  for (const [feature, value] of Object.entries(changes)) {
    if (!Number.isFinite(value)) {
      throw new Error(
        `Invalid simulation value for ${feature}.`
      );
    }
  }

  // ----------------------------------------------------------
  // SEND SIMULATION REQUEST
  // ----------------------------------------------------------

  const data = await apiPost<WhatIfResponse>(
    "/api/v1/simulations/what-if",
    {
      project_db_id: projectId,
      changes,
    }
  );

  // ----------------------------------------------------------
  // CONFIRM READ-ONLY SIMULATION
  // ----------------------------------------------------------

  if (!data.success || data.saved !== false) {
    throw new Error(
      "The API did not confirm a read-only simulation."
    );
  }

  // ----------------------------------------------------------
  // VALIDATE RESPONSE STRUCTURE
  // ----------------------------------------------------------

  if (
    !data.baseline?.prediction ||
    !data.scenario?.prediction ||
    !data.comparison
  ) {
    throw new Error(
      "Invalid What-If simulation response."
    );
  }

  return data;
}
// ============================================================
// INTERVENTION SCENARIO ENGINE
// ============================================================

export interface InterventionCandidate {
  candidate_id: string;
  title: string;
  description: string;

  changes: Record<string, number>;

  baseline: WhatIfPrediction;
  scenario: WhatIfPrediction;

  comparison: WhatIfComparison;
}

export interface InterventionResponse {
  success: boolean;
  saved: boolean;

  project_db_id: number;
  source_prediction_id: number;

  total_candidates: number;
  candidates: InterventionCandidate[];

  note: string;
}

// ============================================================
// GET INTERVENTION CANDIDATES
// ============================================================

export async function getInterventionCandidates(
  projectId: number
): Promise<InterventionResponse> {
  if (!Number.isInteger(projectId) || projectId < 1) {
    throw new Error("Invalid project ID.");
  }

  const data = await apiPost<InterventionResponse>(
    "/api/v1/interventions/candidates",
    {
      project_db_id: projectId,
    }
  );

  if (
    data.success !== true ||
    data.saved !== false ||
    !Array.isArray(data.candidates)
  ) {
    throw new Error(
      "Invalid intervention API response."
    );
  }

  return data;
}

export interface SavedIntervention {
  id: number;
  project_db_id: number;
  intervention_type: string;
  target_feature: string | null;
  current_value: number | null;
  proposed_value: number | null;
  original_risk: number | null;
  simulated_risk: number | null;
  estimated_risk_reduction: number | null;
  status: "PROPOSED" | string;
  details: {
    source_prediction_id?: number;
    candidate_id?: string | null;
    title?: string;
    changed_features?: Record<string, number>;
    comparison?: WhatIfComparison;
    source?: string;
  } | null;
  notes: string | null;
  created_at: string;
}

export type SaveInterventionPayload = {
  project_db_id: number;
  source_prediction_id: number;
  notes?: string;
} & (
  | { candidate_id: string; changes?: never }
  | { changes: Record<string, number>; candidate_id?: never }
);

export interface SaveInterventionResponse {
  success: boolean;
  saved: boolean;
  intervention: SavedIntervention;
}

export interface InterventionHistoryResponse {
  success: boolean;
  project_db_id: number;
  total: number;
  interventions: SavedIntervention[];
}

export async function saveIntervention(
  payload: SaveInterventionPayload
): Promise<SavedIntervention> {
  const data = await apiPost<SaveInterventionResponse>(
    "/api/v1/interventions/save",
    payload
  );
  if (!data.success || !data.saved || !data.intervention?.id) {
    throw new Error("The API did not confirm that the intervention was saved.");
  }
  return data.intervention;
}

export async function getInterventionHistory(
  projectId: number
): Promise<InterventionHistoryResponse> {
  if (!Number.isInteger(projectId) || projectId < 1) {
    throw new Error("Invalid project ID.");
  }
  const data = await apiGet<InterventionHistoryResponse>(
    `/api/v1/interventions/projects/${projectId}`
  );
  if (!data.success || !Array.isArray(data.interventions)) {
    throw new Error("Invalid intervention history response.");
  }
  return data;
}

// Create Project — retain this function if your local file already defines it; do not duplicate.
export interface CreateProjectPayload {
  project_id: string;
  project_name: string;
  project_type?: string;
  implementing_agency?: string;
  state?: string;
  district?: string;
  latitude?: number | null;
  longitude?: number | null;
  total_land_area: number;
  acquired_land_area: number;
  current_stage?: string;
  notes?: string;
}
export interface CreateProjectResponse {
  success: boolean;
  message: string;
  project: Project;
}
export async function createProject(payload: CreateProjectPayload): Promise<CreateProjectResponse> {
  const result = await apiPost<CreateProjectResponse>("/api/v1/projects", payload);
  if (!result.success || !result.project?.id) throw new Error("Project creation was not confirmed.");
  return result;
}

// Edit Project — PUT modifies the existing numeric database ID.
export async function updateProject(id: number, payload: CreateProjectPayload): Promise<CreateProjectResponse> {
  if (!Number.isInteger(id) || id < 1) throw new Error("Invalid project database ID.");
  const response = await fetch(`${API_URL}/api/v1/projects/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await handleResponse<CreateProjectResponse>(response);
  if (!result.success || result.project?.id !== id) throw new Error("Project update was not confirmed.");
  return result;
}
