import {
  useCallback,
  useEffect,
  useState,
  type ChangeEvent,
} from "react";

import {
  analyzeDocument,
  getProjectDocuments,
  type DocumentRecord,
} from "../services/documentAiApi";

interface DocumentIntelligencePanelProps {
  projectId: number;
  projectName: string;
}

function formatDate(value: string | null): string {
  if (!value) {
    return "—";
  }

  return value.replace("T", " ").slice(0, 19);
}

function humanize(value: string): string {
  return value
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function DocumentIntelligencePanel({
  projectId,
  projectName,
}: DocumentIntelligencePanelProps) {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [selectedDocument, setSelectedDocument] =
    useState<DocumentRecord | null>(null);

  const [selectedFile, setSelectedFile] =
    useState<File | null>(null);

  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await getProjectDocuments(projectId);

      setDocuments(response.documents);

      setSelectedDocument((previous) => {
        if (
          previous &&
          response.documents.some(
            (document) => document.id === previous.id,
          )
        ) {
          return response.documents.find(
            (document) => document.id === previous.id,
          ) ?? null;
        }

        return response.documents[0] ?? null;
      });
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load project documents.",
      );
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    setSelectedFile(null);
    setSelectedDocument(null);
    setSuccessMessage("");

    void loadDocuments();
  }, [loadDocuments]);

  function handleFileChange(
    event: ChangeEvent<HTMLInputElement>,
  ): void {
    const file =
      event.target.files?.[0] ?? null;

    setSelectedFile(file);
    setSuccessMessage("");
    setError("");
  }

  async function handleUpload(): Promise<void> {
    if (!selectedFile) {
      setError("Select a document before starting analysis.");
      return;
    }

    setUploading(true);
    setError("");
    setSuccessMessage("");

    try {
      const response = await analyzeDocument(
        projectId,
        selectedFile,
      );

      setSelectedDocument(response.document);

      setSuccessMessage(
        `${response.document.file_name} analysed successfully.`,
      );

      setSelectedFile(null);

      await loadDocuments();

      setSelectedDocument(response.document);
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Document analysis failed.",
      );
    } finally {
      setUploading(false);
    }
  }

  const extracted =
    selectedDocument?.extracted_data ?? null;

  const risks =
    selectedDocument?.risk_signals ?? null;

  return (
    <div className="document-ai-page">

      <section className="document-ai-header">
        <div>
          <span className="simulation-card-label">
            AI DOCUMENT INTELLIGENCE
          </span>

          <h2>Document Intelligence</h2>

          <p>
            Scan, extract and review land-acquisition
            documents for {projectName}.
          </p>
        </div>

        <span className="count-badge">
          {documents.length}
        </span>
      </section>

      <section className="document-upload-card">
        <div>
          <h3>Upload Document</h3>

          <p>
            Supported formats: PDF, JPG, JPEG, PNG and TXT.
          </p>
        </div>

        <label className="document-file-picker">
          <span>
            {selectedFile
              ? selectedFile.name
              : "Choose document"}
          </span>

          <input
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.txt"
            onChange={handleFileChange}
          />
        </label>

        <button
          type="button"
          className="refresh-button"
          disabled={!selectedFile || uploading}
          onClick={() => void handleUpload()}
        >
          {uploading
            ? "Analysing..."
            : "Scan & Analyse"}
        </button>
      </section>

      {successMessage && (
        <div
          className="add-project-success"
          role="status"
        >
          {successMessage}
        </div>
      )}

      {error && (
        <div
          className="error-box"
          role="alert"
        >
          {error}
        </div>
      )}

      <div className="document-ai-grid">

        <section className="document-list-panel">
          <div className="panel-heading">
            <div>
              <h3>Project Documents</h3>
              <p>
                Documents saved for the selected project.
              </p>
            </div>

            <span className="count-badge">
              {documents.length}
            </span>
          </div>

          {loading ? (
            <p className="loading">
              Loading documents...
            </p>
          ) : documents.length === 0 ? (
            <p className="empty-state">
              No documents have been uploaded for this
              project.
            </p>
          ) : (
            <div className="document-record-list">
              {documents.map((document) => (
                <button
                  key={document.id}
                  type="button"
                  className={
                    selectedDocument?.id === document.id
                      ? "document-record active"
                      : "document-record"
                  }
                  onClick={() =>
                    setSelectedDocument(document)
                  }
                >
                  <div className="document-record-top">
                    <strong>
                      {document.file_name}
                    </strong>

                    <span
                      className={`risk-badge ${
                        document.risk_signals?.risk_level
                          ?.toLowerCase() ?? "unknown"
                      }`}
                    >
                      {document.risk_signals
                        ?.risk_level ?? "UNKNOWN"}
                    </span>
                  </div>

                  <span>
                    {humanize(
                      document.document_type,
                    )}
                  </span>

                  <small>
                    {formatDate(
                      document.uploaded_at,
                    )}
                  </small>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="document-analysis-panel">
          {!selectedDocument ? (
            <p className="empty-state">
              Select a document to inspect its analysis.
            </p>
          ) : (
            <>
              <div className="panel-heading">
                <div>
                  <span className="simulation-card-label">
                    DOCUMENT ANALYSIS
                  </span>

                  <h3>
                    {selectedDocument.file_name}
                  </h3>

                  <p>
                    Automated extraction. Review important
                    values against the source document.
                  </p>
                </div>
              </div>

              <div className="document-summary-grid">

                <div>
                  <span>Document Type</span>
                  <strong>
                    {humanize(
                      selectedDocument.document_type,
                    )}
                  </strong>
                </div>

                <div>
                  <span>Processing</span>
                  <strong>
                    {humanize(
                      selectedDocument.processing_status,
                    )}
                  </strong>
                </div>

                <div>
                  <span>Extraction</span>
                  <strong>
                    {String(
                      extracted?.extraction_method ??
                        "—",
                    )}
                  </strong>
                </div>

                <div>
                  <span>Readiness</span>
                  <strong>
                    {risks
                      ? `${risks.readiness_score}%`
                      : "—"}
                  </strong>
                </div>

              </div>

              {selectedDocument.processing_status ===
                "INSUFFICIENT_INFORMATION" && (
                <div className="document-warning">
                  <strong>
                    Insufficient Information
                  </strong>

                  <p>
                    AcquiTwin could not reliably extract
                    enough information from this document.
                    Do not use extracted values for
                    decision-making until the document is
                    reviewed.
                  </p>
                </div>
              )}

              <h3>Extracted Information</h3>

              {!extracted ? (
                <p className="empty-state">
                  No extracted information is available.
                </p>
              ) : (
                <div className="document-fields">

                  <div>
                    <span>Survey Number</span>
                    <strong>
                      {String(
                        extracted.survey_number ??
                          "Not detected",
                      )}
                    </strong>
                  </div>

                  <div>
                    <span>Owner Name</span>
                    <strong>
                      {String(
                        extracted.owner_name ??
                          "Not detected",
                      )}
                    </strong>
                  </div>

                  <div>
                    <span>Village</span>
                    <strong>
                      {String(
                        extracted.village ??
                          "Not detected",
                      )}
                    </strong>
                  </div>

                  <div>
                    <span>District</span>
                    <strong>
                      {String(
                        extracted.district ??
                          "Not detected",
                      )}
                    </strong>
                  </div>

                  <div>
                    <span>Land Area</span>
                    <strong>
                      {String(
                        extracted.land_area ??
                          "Not detected",
                      )}
                    </strong>
                  </div>

                  <div>
                    <span>Compensation</span>
                    <strong>
                      {String(
                        extracted.compensation_amount ??
                          "Not detected",
                      )}
                    </strong>
                  </div>

                  <div>
                    <span>Case Number</span>
                    <strong>
                      {String(
                        extracted.case_number ??
                          "Not detected",
                      )}
                    </strong>
                  </div>

                </div>
              )}

              <h3>Missing Information</h3>

              {risks?.missing_fields?.length ? (
                <ul className="document-risk-list">
                  {risks.missing_fields.map(
                    (field) => (
                      <li key={field}>
                        {humanize(field)}
                      </li>
                    ),
                  )}
                </ul>
              ) : (
                <p className="empty-state">
                  No required fields are currently marked
                  missing.
                </p>
              )}

              <h3>Detected Risk Signals</h3>

              {risks?.detected_risks?.length ? (
                <ul className="document-risk-list">
                  {risks.detected_risks.map(
                    (risk) => (
                      <li key={risk}>
                        {humanize(risk)}
                      </li>
                    ),
                  )}
                </ul>
              ) : (
                <p className="empty-state">
                  No explicit configured risk phrases were
                  detected.
                </p>
              )}

              <p className="explanation-note">
                Document classification and extracted
                values are automated prototype outputs,
                not independent verification of the source
                record.
              </p>
            </>
          )}
        </section>

      </div>
    </div>
  );
}

export default DocumentIntelligencePanel;