import { useEffect, useRef, useState } from "react";
import {
  getInterventionCandidates,
  getInterventionHistory,
  saveIntervention,
  type InterventionCandidate,
  type InterventionResponse,
  type SavedIntervention,
} from "../services/projectsApi";

interface InterventionPanelProps {
  projectId: number;
  projectName: string;
  sourcePredictionId: number;
}

function formatNumber(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function formatDelta(value: number): string {
  return `${value > 0 ? "+" : ""}${formatNumber(value)}`;
}

function formatFeatureName(name: string): string {
  return name.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function InterventionPanel({
  projectId,
  projectName,
  sourcePredictionId,
}: InterventionPanelProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<InterventionResponse | null>(null);
  const [history, setHistory] = useState<SavedIntervention[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [savingCandidateId, setSavingCandidateId] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState("");
  const requestVersion = useRef(0);

  useEffect(() => {
    let active = true;
    let historyVersion = 0;
    requestVersion.current += 1;
    setResult(null);
    setError("");
    setLoading(false);
    setHistory([]);
    setHistoryError("");
    setHistoryLoading(true);
    setSavingCandidateId(null);
    setSaveNotice("");

    function refreshHistory() {
      const currentHistoryVersion = ++historyVersion;
      setHistoryLoading(true);
      void getInterventionHistory(projectId)
        .then((response) => {
          if (active && currentHistoryVersion === historyVersion) {
            setHistory(response.interventions);
            setHistoryError("");
          }
        })
        .catch((err: unknown) => {
          if (active && currentHistoryVersion === historyVersion) setHistoryError(
            err instanceof Error ? err.message : "Unable to load intervention history."
          );
        })
        .finally(() => {
          if (active && currentHistoryVersion === historyVersion) setHistoryLoading(false);
        });
    }

    function onSaved(event: Event) {
      if ((event as CustomEvent<{ projectId: number }>).detail?.projectId === projectId) {
        refreshHistory();
      }
    }

    window.addEventListener("acquitwin:intervention-saved", onSaved);
    refreshHistory();

    return () => {
      active = false;
      window.removeEventListener("acquitwin:intervention-saved", onSaved);
      requestVersion.current += 1;
    };
  }, [projectId, sourcePredictionId]);

  async function handleGenerate() {
    if (loading || savingCandidateId !== null) return;
    const currentRequest = ++requestVersion.current;
    setLoading(true);
    setError("");
    setResult(null);
    setSaveNotice("");
    try {
      const response = await getInterventionCandidates(projectId);
      if (currentRequest !== requestVersion.current) return;
      if (response.source_prediction_id !== sourcePredictionId) {
        throw new Error("The saved baseline changed. Refresh before generating scenarios.");
      }
      setResult(response);
    } catch (err) {
      if (currentRequest === requestVersion.current) {
        setError(err instanceof Error ? err.message : "Unable to generate scenarios.");
      }
    } finally {
      if (currentRequest === requestVersion.current) setLoading(false);
    }
  }

  async function handleSave(candidate: InterventionCandidate) {
    if (!result || savingCandidateId !== null) return;
    const currentRequest = requestVersion.current;
    setSavingCandidateId(candidate.candidate_id);
    setError("");
    setSaveNotice("");
    try {
      const saved = await saveIntervention({
        project_db_id: projectId,
        source_prediction_id: result.source_prediction_id,
        candidate_id: candidate.candidate_id,
      });
      if (currentRequest !== requestVersion.current) return;
      setHistory((previous) => [saved, ...previous]);
      window.dispatchEvent(new CustomEvent("acquitwin:intervention-saved", {
        detail: { projectId },
      }));
      setSaveNotice(`Saved ${candidate.title} as proposed intervention #${saved.id}.`);
    } catch (err) {
      if (currentRequest === requestVersion.current) {
        setError(err instanceof Error ? err.message : "Unable to save the proposal.");
      }
    } finally {
      if (currentRequest === requestVersion.current) setSavingCandidateId(null);
    }
  }

  function wasSaved(candidateId: string): boolean {
    return history.some((item) =>
      item.details?.candidate_id === candidateId &&
      item.details?.source_prediction_id === sourcePredictionId
    );
  }

  return (
    <div className="intervention-panel">
      <div className="panel-heading">
        <div>
          <h2>Intervention Scenario Engine</h2>
          <p>Explore candidate conditions for {projectName}.</p>
        </div>
        <span className="count-badge">Scenario Analysis</span>
      </div>

      <div className="prediction-actions">
        <button type="button" className="refresh-button"
          onClick={() => void handleGenerate()}
          disabled={loading || savingCandidateId !== null}>
          {loading ? "Evaluating Scenarios..." : "◈ Generate Intervention Scenarios"}
        </button>
      </div>

      {error && <div className="error-box" role="alert">{error}</div>}
      {saveNotice && <p role="status">{saveNotice}</p>}
      {loading && <p className="loading">Evaluating candidate scenarios using the ML models...</p>}

      {result && (
        <div className="intervention-results">
          <div className="intervention-summary">
            <h3>Generated Scenarios</h3>
            <span className="count-badge">{result.total_candidates}</span>
          </div>
          {result.candidates.length === 0 ? (
            <p className="empty-state">No applicable scenario changes were generated from this project's latest snapshot.</p>
          ) : (
            <div className="intervention-grid">
              {result.candidates.map((candidate) => (
                <article className="intervention-card" key={candidate.candidate_id}>
                  <div className="intervention-card-header">
                    <span className="simulation-card-label">HYPOTHETICAL SCENARIO</span>
                    <h3>{candidate.title}</h3>
                    <p>{candidate.description}</p>
                  </div>

                  <div className="intervention-changes">
                    <h4>Assumed changes</h4>
                    {Object.entries(candidate.changes).map(([feature, value]) => (
                      <div className="intervention-change" key={feature}>
                        <span>{formatFeatureName(feature)}</span>
                        <strong>{feature === "legal_dispute" ? value === 1 ? "Yes" : "No" : formatNumber(value)}</strong>
                      </div>
                    ))}
                  </div>

                  <div className="intervention-metrics">
                    <div><span>Baseline Risk</span><strong>{formatNumber(candidate.baseline.risk_score)}/100</strong></div>
                    <div><span>Scenario Risk</span><strong>{formatNumber(candidate.scenario.risk_score)}/100</strong></div>
                    <div><span>Baseline Expected Delay</span><strong>{formatNumber(candidate.baseline.expected_delay_days)} days</strong></div>
                    <div><span>Scenario Expected Delay</span><strong>{formatNumber(candidate.scenario.expected_delay_days)} days</strong></div>
                  </div>

                  <div className="intervention-deltas">
                    <div><span>Risk Score Change</span><strong>{formatDelta(candidate.comparison.risk_score_delta)} points</strong></div>
                    <div><span>Expected Delay Change</span><strong>{formatDelta(candidate.comparison.expected_delay_days_delta)} days</strong></div>
                  </div>

                  <div className="prediction-actions">
                    <button type="button" className="refresh-button"
                      onClick={() => void handleSave(candidate)}
                      disabled={savingCandidateId !== null || wasSaved(candidate.candidate_id)}>
                      {savingCandidateId === candidate.candidate_id
                        ? "Saving Proposal..."
                        : wasSaved(candidate.candidate_id) ? "Proposal Saved" : "Save Proposed Intervention"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
          <div className="simulation-notice">{result.note}</div>
          <div className="simulation-unsaved">Scenario calculations do not create prediction records. Saved proposals appear in the history below.</div>
        </div>
      )}

      <section className="intervention-results" aria-label="Saved intervention history">
        <div className="intervention-summary">
          <h3>Saved Intervention History</h3>
          <span className="count-badge">{history.length}</span>
        </div>
        {historyLoading ? <p className="loading">Loading saved proposals...</p> :
          historyError ? <div className="error-box" role="alert">{historyError}</div> :
          history.length === 0 ? <p className="empty-state">No proposed interventions saved for this project.</p> : (
            <div className="intervention-grid">
              {history.map((item) => (
                <article className="intervention-card" key={item.id}>
                  <div className="intervention-card-header">
                    <span className="simulation-card-label">{item.status} · #{item.id}</span>
                    <h3>{item.details?.title ?? formatFeatureName(item.intervention_type)}</h3>
                    <p>Source prediction #{item.details?.source_prediction_id ?? "—"} · {new Date(item.created_at).toLocaleString("en-IN")}</p>
                  </div>
                  <div className="intervention-metrics">
                    <div><span>Baseline Risk</span><strong>{formatNumber(item.original_risk)}/100</strong></div>
                    <div><span>Scenario Risk</span><strong>{formatNumber(item.simulated_risk)}/100</strong></div>
                  </div>
                  <div className="intervention-changes">
                    <h4>Assumed changes</h4>
                    {Object.entries(item.details?.changed_features ?? {}).map(([feature, value]) => (
                      <div className="intervention-change" key={feature}>
                        <span>{formatFeatureName(feature)}</span>
                        <strong>{feature === "legal_dispute" ? value === 1 ? "Yes" : "No" : formatNumber(value)}</strong>
                      </div>
                    ))}
                  </div>
                  <p className="simulation-notice">Model sensitivity from synthetic data; proposal is not a confirmed operational action.</p>
                </article>
              ))}
            </div>
          )}
      </section>
    </div>
  );
}
