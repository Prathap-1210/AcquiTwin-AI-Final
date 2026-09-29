const RAW_API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.trim() ||
  "http://127.0.0.1:8000";

const API_BASE_URL = RAW_API_BASE_URL
  .replace(/\/+$/, "")
  .replace(/\/api$/i, "");

export type DocumentRiskLevel =
  | "LOW"
  | "MEDIUM"
  | "HIGH"
  | "UNKNOWN";

export interface DocumentRiskSignals {
  readiness_score: number;
  risk_level: DocumentRiskLevel;
  missing_fields: string[];
  detected_risks: string[];
  signals: string[];
}

export interface DocumentExtractedData {
  survey_number?: string | null;
  village?: string | null;
  district?: string | null;
  owner_name?: string | null;
  land_area?: string | null;
  compensation_amount?: string | null;
  case_number?: string | null;
  extraction_method?: string | null;
  text_length?: number;
  [key: string]: unknown;
}

export interface DocumentRecord {
  id: number;
  project_id?: number;
  file_name: string;
  document_type: string;
  processing_status: string;
  extracted_text?: string | null;
  extracted_data: DocumentExtractedData | null;
  risk_signals: DocumentRiskSignals | null;
  uploaded_at: string | null;
}

export interface DocumentListResponse {
  success: boolean;
  project_id: number;
  total_documents: number;
  documents: DocumentRecord[];
}

export interface DocumentAnalysisResponse {
  success: boolean;
  document: DocumentRecord;
}

async function parseError(response: Response): Promise<string> {
  try {
    const data = await response.json();

    if (typeof data?.detail === "string") {
      return data.detail;
    }

    return JSON.stringify(data);
  } catch {
    return `Request failed with status ${response.status}`;
  }
}

export async function getProjectDocuments(
  projectId: number,
): Promise<DocumentListResponse> {
  const response = await fetch(
    `${API_BASE_URL}/api/v1/documents/projects/${projectId}`,
  );

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return response.json();
}

export async function analyzeDocument(
  projectId: number,
  file: File,
): Promise<DocumentAnalysisResponse> {
  const formData = new FormData();

  formData.append("project_id", String(projectId));
  formData.append("file", file);

  const response = await fetch(
    `${API_BASE_URL}/api/v1/documents/analyze`,
    {
      method: "POST",
      body: formData,
    },
  );

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return response.json();
}

export async function getDocument(
  documentId: number,
): Promise<DocumentAnalysisResponse> {
  const response = await fetch(
    `${API_BASE_URL}/api/v1/documents/${documentId}`,
  );

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return response.json();
}