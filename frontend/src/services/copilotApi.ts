const RAW_API_URL =
  import.meta.env.VITE_API_BASE_URL?.trim() ||
  "http://127.0.0.1:8000";

const API_URL = RAW_API_URL
  .replace(/\/+$/, "")
  .replace(/\/api$/i, "");


// ============================================================
// TYPES
// ============================================================

export type CopilotRole =
  | "user"
  | "assistant";


export interface CopilotConversationMessage {
  role: CopilotRole;
  content: string;
}


export interface CopilotChatRequest {
  question: string;
  project_id: number | null;
  conversation?: CopilotConversationMessage[];
}


export interface CopilotChatResponse {
  success: boolean;
  answer: string;
  selected_project_id: number | null;
  tools_used: string[];
  grounded: boolean;
  warnings: string[];
}


// ============================================================
// ASK COPILOT
// ============================================================

export async function askCopilot(
  payload: CopilotChatRequest
): Promise<CopilotChatResponse> {

  const response = await fetch(
    `${API_URL}/api/v1/copilot/chat`,
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },

      body: JSON.stringify(payload),
    }
  );


  // ==========================================================
  // HANDLE API ERROR
  // ==========================================================

  if (!response.ok) {

    let message =
      `Copilot API error ${response.status}`;

    try {

      const errorData: {
        detail?: unknown;
      } = await response.json();

      if (
        typeof errorData.detail === "string"
      ) {
        message = errorData.detail;
      }

    } catch {

      // Keep the HTTP status error.

    }

    throw new Error(message);
  }


  // ==========================================================
  // READ RESPONSE
  // ==========================================================

  const data: CopilotChatResponse =
    await response.json();


  // ==========================================================
  // VALIDATE RESPONSE
  // ==========================================================

  if (
    data.success !== true ||
    typeof data.answer !== "string"
  ) {
    throw new Error(
      "Invalid Copilot API response."
    );
  }


  return data;
}