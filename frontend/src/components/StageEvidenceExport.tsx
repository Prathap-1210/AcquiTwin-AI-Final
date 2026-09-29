import { useState } from "react";

import { getStageEvents } from "../services/stageEventsApi";
import { getStageReadiness } from "../services/stageReadinessApi";
import { getStageBottlenecks } from "../services/stageBottlenecksApi";
import { downloadStageEvidenceReportPdf } from "../utils/stageEvidenceReportPdf";

interface Props {
  projectId: number;
  projectName: string;
}

export default function StageEvidenceExport({
  projectId,
  projectName,
}: Props) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function exportEvidence(): Promise<void> {
    if (working) return;

    setWorking(true);
    setError("");
    setMessage("");

    try {
      // Fetch all three current evidence sources before exporting.
      // If one source fails, stop export rather than silently producing
      // a partial evidence report.
      const [events, readiness, bottlenecks] = await Promise.all([
        getStageEvents(projectId),
        getStageReadiness(projectId),
        getStageBottlenecks(projectId),
      ]);

      await downloadStageEvidenceReportPdf({
        projectId,
        projectName,
        events,
        readiness,
        bottlenecks,
      });

      setMessage(
        "Stage Evidence Report generated. Check your browser's Downloads list.",
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to generate Stage Evidence Report.",
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="stage-evidence-export">
      <div className="panel-heading">
        <div>
          <h2>Stage Evidence Report</h2>
          <p>
            Generate the AcquiTwin stage-record, readiness and bottleneck evidence
            report for {projectName}.
          </p>
        </div>

        <button
          type="button"
          className="refresh-button"
          onClick={() => void exportEvidence()}
          disabled={working}
        >
          {working
            ? "Generating PDF..."
            : "Generate Stage Evidence Report"}
        </button>
      </div>

      <p className="explanation-note">
        Read-only export. It uses the latest stage APIs and does not create or
        modify stage records, predictions, readiness results, or bottleneck
        findings.
      </p>

      {error && (
        <div className="error-box" role="alert">
          Stage report export failed: {error}
        </div>
      )}

      {message && (
        <p className="explanation-note" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
