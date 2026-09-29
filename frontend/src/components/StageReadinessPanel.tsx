import { useEffect, useState } from "react";

import {
  getStageReadiness,
  type StageReadinessResponse,
} from "../services/stageReadinessApi";

interface Props {
  projectId: number;
  refreshToken?: number;
}

function formatLabel(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function StageReadinessPanel({
  projectId,
  refreshToken,
}: Props) {
  const [result, setResult] =
    useState<StageReadinessResponse | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      setResult(null);

      try {
        const response = await getStageReadiness(projectId);

        if (!cancelled) {
          setResult(response);
        }
      } catch (caughtError) {
        if (!cancelled) {
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : "Unable to load stage readiness."
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [projectId, refreshToken, revision]);

  return (
    <div className="stage-readiness-panel">
      <div className="panel-heading">
        <div>
          <h2>Stage Data Readiness</h2>
          <p>Database record completeness and quality checks.</p>
        </div>

        <button
          type="button"
          className="refresh-button"
          disabled={loading}
          onClick={() =>
            setRevision((previous) => previous + 1)
          }
        >
          {loading ? "Checking..." : "↻ Refresh"}
        </button>
      </div>

      {loading && (
        <p className="loading">Checking recorded stage data...</p>
      )}

      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}

      {result && (
        <>
          <div className="stage-events-notice">
            <strong>
              {formatLabel(result.readiness_status)}
            </strong>

            <p>{result.note}</p>
          </div>

          <div className="bottleneck-stats">
            <div>
              <span>Total Records</span>
              <strong>{result.total_records}</strong>
            </div>

            <div>
              <span>Recorded Stages</span>
              <strong>{result.recorded_stages}</strong>
            </div>

            <div>
              <span>Start Dates Available</span>
              <strong>
                {result.date_coverage.actual_start_date}
              </strong>
            </div>

            <div>
              <span>Planned End Dates Available</span>
              <strong>
                {result.date_coverage.planned_end_date}
              </strong>
            </div>
          </div>

          {result.readiness_status === "no_stage_records" ? (
            <p className="empty-state">
              No stage events have been recorded.
              Readiness cannot yet be assessed.
            </p>
          ) : (
            <>
              <h3>Additional Date Coverage</h3>

              <p className="explanation-note">
                Actual completion dates available:{" "}
                {result.date_coverage.actual_completion_date}
                {" / "}
                {result.recorded_stages} recorded stages.
              </p>

              <h3>Data Quality Issues</h3>

              {result.quality_issues.length === 0 ? (
                <p className="empty-state">
                  No issues were identified by the implemented
                  checks. This does not verify the records or
                  establish full lifecycle completeness.
                </p>
              ) : (
                <div className="bottleneck-stage-list">
                  {result.quality_issues.map((issue, index) => (
                    <div
                      className="bottleneck-finding"
                      key={`${issue.stage_event_id}-${issue.field}-${index}`}
                    >
                      <strong>{issue.stage_name}</strong>

                      <p>{issue.issue}</p>

                      <small>
                        Field: {formatLabel(issue.field)}
                      </small>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}