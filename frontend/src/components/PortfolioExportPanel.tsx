import type { Project } from "../services/projectsApi";

interface Props {
  projects: Project[];
  totalProjects: number;
}

function safeText(value: string | null | undefined): string {
  const text = value ?? "";

  // Prevent spreadsheet applications from treating
  // exported text as a formula.
  return /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
}

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return '""';
  }

  let text: string;

  if (typeof value === "number") {
    text = Number.isFinite(value) ? String(value) : "";
  } else {
    text = safeText(value);
  }

  return `"${text.replace(/"/g, '""')}"`;
}

function formatDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function PortfolioExportPanel({
  projects,
  totalProjects,
}: Props) {
  const partialPortfolio = totalProjects > projects.length;

  function downloadPortfolio(): void {
    if (projects.length === 0) return;

    const headers = [
      "Project ID",
      "Project Name",
      "Project Type",
      "Implementing Agency",
      "State",
      "District",
      "Current Stage",
      "Total Land (ha)",
      "Acquired Land (ha)",
      "Remaining Land (ha)",
      "Risk Level",
      "Risk Score (0-100)",
      "Delay Probability (%)",
      "Predicted Delay (days)",
      "Model Version",
      "Latest Prediction Timestamp",
    ];

    const rows = projects.map((project) => {
      const prediction = project.latest_prediction;

      return [
        project.project_id,
        project.project_name,
        project.project_type,
        project.implementing_agency,
        project.state,
        project.district,
        project.current_stage,
        project.total_land_area,
        project.acquired_land_area,
        project.remaining_land_area,
        prediction?.risk_level ?? "NOT PREDICTED",
        prediction?.risk_score ?? null,
        prediction
          ? prediction.delay_probability * 100
          : null,
        prediction?.predicted_delay_days ?? null,
        prediction?.model_version ?? "",
        prediction?.created_at ?? "",
      ];
    });

    const csv = [
      headers.map(csvCell).join(","),
      ...rows.map((row) => row.map(csvCell).join(",")),
    ].join("\r\n");

    // UTF-8 BOM improves compatibility with Excel.
    const blob = new Blob(["\uFEFF", csv], {
      type: "text/csv;charset=utf-8",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `land-acquisition-portfolio-${formatDate()}.csv`;

    document.body.appendChild(link);
    link.click();
    link.remove();

    window.setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  return (
    <div className="portfolio-export-panel">
      <div className="panel-heading">
        <div>
          <h2>Portfolio Report Export</h2>
          <p>
            Export project details and latest saved
            prediction results as CSV.
          </p>
        </div>

        <span className="count-badge">
          {projects.length} loaded
        </span>
      </div>



      <p className="explanation-note">
        Export coverage: {projects.length} of{" "}
        {totalProjects} projects reported by the API.
      </p>

      {partialPortfolio && (
        <div className="project-filter-notice" role="status">
          The report will contain only the projects
          currently loaded into the dashboard. It is
          not a complete portfolio export.
        </div>
      )}

      <button
        type="button"
        className="refresh-button"
        onClick={downloadPortfolio}
        disabled={projects.length === 0}
      >
        ↓ Download Portfolio Report (CSV)
      </button>

      <p className="explanation-note">
        The file is generated locally in your browser.
        It does not modify the database. Handle exported
        project information according to your team's
        data-sharing requirements.
      </p>
    </div>
  );
}