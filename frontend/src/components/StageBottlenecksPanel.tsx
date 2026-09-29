import { useCallback, useEffect, useState } from "react";

import {
  getStageBottlenecks,
  type BottleneckResponse,
} from "../services/stageBottlenecksApi";

interface Props {
  projectId: number;
  projectName: string;
  refreshToken?: number;
}

function formatLabel(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string | null): string {
  return value ?? "Not recorded";
}

export default function StageBottlenecksPanel({
  projectId,
  projectName,
  refreshToken,
}: Props) {
  const [result, setResult] = useState<BottleneckResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  const refresh = useCallback(() => {
    setRevision((previous) => previous + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      setLoading(true);
      setError("");
      setResult(null);

      try {
        const response = await getStageBottlenecks(projectId);
        if (!cancelled) setResult(response);
      } catch (caughtError) {
        if (!cancelled) {
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : "Unable to load bottleneck analysis.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [projectId, revision, refreshToken]);

  return (
    <div className="bottleneck-panel">
      <div className="panel-heading">
        <div>
          <h2>Stage Bottleneck Intelligence</h2>
          <p>Recorded stage analysis for {projectName}.</p>
        </div>
        <button
          type="button"
          className="refresh-button"
          onClick={refresh}
          disabled={loading}
        >
          {loading ? "Analyzing..." : "↻ Refresh Analysis"}
        </button>
      </div>

      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
      {loading && <p className="loading">Loading recorded stage information...</p>}

      {result && (
        <>
          <div className="bottleneck-status">
            <span>Analysis Status</span>
            <strong>{formatLabel(result.analysis_status)}</strong>
            <small>Analysis date: {result.analysis_date}</small>
          </div>

          <div className="bottleneck-stats">
            <div>
              <span>Stage Records</span>
              <strong>{result.total_stage_records}</strong>
            </div>
            <div>
              <span>Stages Analyzed</span>
              <strong>{result.stages_analyzed}</strong>
            </div>
            <div>
              <span>Stages With Findings</span>
              <strong>{result.stages_with_findings}</strong>
            </div>
            <div>
              <span>Recorded Conditions</span>
              <strong>{result.total_findings}</strong>
            </div>
          </div>

          {result.analysis_status === "insufficient_evidence" && (
            <div className="bottleneck-empty">
              <h3>Insufficient evidence</h3>
              <p>
                No stage events are available for analysis. Record genuine stage
                information in Stage Event Management; the analysis will refresh
                after a successful save.
              </p>
            </div>
          )}

          {result.stages.length > 0 && (
            <div className="bottleneck-stage-list">
              {result.stages.map((stage) => (
                <article
                  className="bottleneck-stage-card"
                  key={stage.stage_event_id}
                >
                  <div className="bottleneck-stage-header">
                    <div>
                      <span className="simulation-card-label">RECORDED STAGE</span>
                      <h3>{stage.stage_name}</h3>
                    </div>
                    <span className="count-badge">
                      {formatLabel(stage.stage_status)}
                    </span>
                  </div>

                  <div className="bottleneck-stage-details">
                    <div>
                      <span>Actual Start</span>
                      <strong>{formatDate(stage.actual_start_date)}</strong>
                    </div>
                    <div>
                      <span>Planned End</span>
                      <strong>{formatDate(stage.planned_end_date)}</strong>
                    </div>
                    <div>
                      <span>Actual Completion</span>
                      <strong>{formatDate(stage.actual_completion_date)}</strong>
                    </div>
                    <div>
                      <span>Recorded Progress</span>
                      <strong>{stage.progress_percentage}%</strong>
                    </div>
                  </div>

                  {stage.findings.length > 0 ? (
                    <div className="bottleneck-findings">
                      <h4>Identified Conditions ({stage.finding_count})</h4>
                      {stage.findings.map((finding) => (
                        <div className="bottleneck-finding" key={finding.code}>
                          <strong>{finding.title}</strong>
                          <p>{finding.evidence}</p>
                          {finding.days_past_planned_end !== undefined && (
                            <small>
                              Days past planned end: {finding.days_past_planned_end}
                            </small>
                          )}
                          {finding.days_after_planned_end !== undefined && (
                            <small>
                              Completed after planned end: {finding.days_after_planned_end} days
                            </small>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="bottleneck-no-findings">
                      No conditions identified from this stage's available record.
                      This does not establish that the stage has no bottlenecks.
                    </p>
                  )}

                  {stage.missing_information.length > 0 && (
                    <div className="bottleneck-missing">
                      <h4>Missing Information</h4>
                      <p>
                        {stage.missing_information.map(formatLabel).join(", ")}
                      </p>
                    </div>
                  )}

                  <small className="bottleneck-source">
                    Source: manually entered, unverified stage record #{stage.stage_event_id}
                  </small>
                </article>
              ))}
            </div>
          )}

          <div className="stage-events-notice">{result.note}</div>
        </>
      )}
    </div>
  );
}
