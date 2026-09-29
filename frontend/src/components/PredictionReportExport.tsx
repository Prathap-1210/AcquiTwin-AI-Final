import { useState } from "react";

import type {
  HistoryEntry,
  Project,
} from "../services/projectsApi";

import {
  downloadPredictionReportPdf,
  type PredictionReportData,
} from "../utils/predictionReportPdf";

interface PredictionReportExportProps {
  project: Project;
  prediction: HistoryEntry | null;
  loading?: boolean;
  historyError?: string;
}

function PredictionReportExport({
  project,
  prediction,
  loading = false,
  historyError = "",
}: PredictionReportExportProps) {
  const [generating, setGenerating] = useState(false);
  const [reportError, setReportError] = useState("");

  async function handleGenerateReport(): Promise<void> {
    if (!prediction) {
      setReportError(
        "A saved ML prediction is required before a prediction report can be generated.",
      );
      return;
    }

    setGenerating(true);
    setReportError("");

    try {
      const reportData: PredictionReportData = {
        // ----------------------------------------------------
        // PROJECT INFORMATION
        // ----------------------------------------------------
        projectDatabaseId: project.id,
        projectId: project.project_id,
        projectName: project.project_name,

        district: project.district ?? null,
        state: project.state ?? null,
        currentStage: project.current_stage ?? null,
        implementingAgency:
          project.implementing_agency ?? null,

        // ----------------------------------------------------
        // SAVED PREDICTION
        // ----------------------------------------------------
        predictionId: prediction.prediction_id,

        riskScore:
          prediction.risk_score ?? null,

        riskLevel:
          prediction.risk_level ?? null,

        delayProbability:
          prediction.delay_probability ?? null,

        expectedDelayDays:
          prediction.predicted_delay_days ?? null,

        modelVersion:
          prediction.model_version ?? null,

        predictionTimestamp:
          prediction.created_at ?? null,

        // ----------------------------------------------------
        // MODEL EXPLANATION
        // ----------------------------------------------------
        riskFactors:
          prediction.risk_factors.map((factor) => ({
            rank: factor.rank,
            feature: factor.feature,
            value: factor.value,
            contribution: factor.contribution,
            direction: factor.direction ?? null,
          })),

        // ----------------------------------------------------
        // ORIGINAL SAVED INPUTS
        // ----------------------------------------------------
        inputSnapshot:
          prediction.input_snapshot ?? null,
      };

      await downloadPredictionReportPdf(
        reportData,
      );
    } catch (error) {
      console.error(
        "Prediction report generation failed:",
        error,
      );

      setReportError(
        error instanceof Error
          ? error.message
          : "Unable to generate the prediction report.",
      );
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div>
      <div className="panel-heading">
        <div>
          <h2>Prediction Analysis Report</h2>

          <p>
            Generate a structured AcquiTwin AI PDF using
            the selected project's latest saved ML prediction
            and explanation factors.
          </p>
        </div>

        {prediction && (
          <span className="count-badge">
            Prediction #{prediction.prediction_id}
          </span>
        )}
      </div>

      {loading ? (
        <p className="loading">
          Loading latest saved prediction...
        </p>
      ) : historyError ? (
        <div
          className="error-box"
          role="alert"
        >
          Unable to prepare prediction report:{" "}
          {historyError}
        </div>
      ) : !prediction ? (
        <>
          <p className="empty-state">
            This project does not have a saved ML
            prediction yet.
          </p>

          <a
            href="#/predictions"
            className="refresh-button report-link"
          >
            Run Prediction
          </a>
        </>
      ) : (
        <>
          <div className="detail-metrics">
            <div>
              <span>Project</span>
              <strong>
                {project.project_id}
              </strong>
            </div>

            <div>
              <span>Risk Level</span>
              <strong>
                {prediction.risk_level ??
                  "Not recorded"}
              </strong>
            </div>

            <div>
              <span>Risk Score</span>
              <strong>
                {prediction.risk_score != null
                  ? `${prediction.risk_score}/100`
                  : "Not recorded"}
              </strong>
            </div>

            <div>
              <span>Risk Factors</span>
              <strong>
                {prediction.risk_factors.length}
              </strong>
            </div>
          </div>

          <p className="explanation-note">
            The PDF uses only information stored for
            this project and prediction. Missing values
            are shown as unavailable rather than being
            fabricated.
          </p>

          {reportError && (
            <div
              className="error-box"
              role="alert"
            >
              {reportError}
            </div>
          )}

          <button
            type="button"
            className="refresh-button"
            onClick={() =>
              void handleGenerateReport()
            }
            disabled={generating}
          >
            {generating
              ? "Generating PDF..."
              : "Generate Prediction Report"}
          </button>
        </>
      )}
    </div>
  );
}

export default PredictionReportExport;