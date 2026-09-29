import { useEffect, useState, type FormEvent } from "react";

import {
  createStageEvent,
  getStageEvents,
  type StageEvent,
  type StageEventPayload,
  type StageStatus,
} from "../services/stageEventsApi";

interface Props {
  projectId: number;
  projectName: string;
  onEventSaved?: () => void;
}

interface FormState {
  stage_name: string;
  stage_status: StageStatus;
  progress_percentage: string;
  actual_start_date: string;
  planned_end_date: string;
  actual_completion_date: string;
  notes: string;
}

const INITIAL_FORM: FormState = {
  stage_name: "",
  stage_status: "planned",
  progress_percentage: "0",
  actual_start_date: "",
  planned_end_date: "",
  actual_completion_date: "",
  notes: "",
};

function formatStatus(status: string): string {
  return status
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string | null): string {
  return value || "Not recorded";
}

function formatTimestamp(value: string): string {
  // Backend timestamps do not include a timezone; show their original wall time.
  return value ? value.replace("T", " ").slice(0, 19) : "Unavailable";
}

export default function StageEventsPanel({
  projectId,
  projectName,
  onEventSaved,
}: Props) {
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [events, setEvents] = useState<StageEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      setLoading(true);
      setError("");
      setEvents([]);

      try {
        const response = await getStageEvents(projectId);
        if (!cancelled) setEvents(response.events);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load stage events.",
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
  }, [projectId]);

  function updateField<K extends keyof FormState>(
    key: K,
    value: FormState[K],
  ): void {
    setForm((previous) => ({ ...previous, [key]: value }));
    setError("");
    setMessage("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (saving) return;

    setError("");
    setMessage("");

    const progress = Number(form.progress_percentage);
    if (
      form.progress_percentage.trim() === "" ||
      !Number.isFinite(progress) ||
      progress < 0 ||
      progress > 100
    ) {
      setError("Progress must be between 0 and 100.");
      return;
    }

    if (form.stage_status === "completed" && !form.actual_completion_date) {
      setError("A completed stage requires an actual completion date.");
      return;
    }

    if (form.stage_status !== "completed" && form.actual_completion_date) {
      setError("Only completed stages can have an actual completion date.");
      return;
    }

    if (
      form.actual_start_date &&
      form.actual_completion_date &&
      form.actual_completion_date < form.actual_start_date
    ) {
      setError("Completion date cannot precede start date.");
      return;
    }

    const payload: StageEventPayload = {
      stage_name: form.stage_name.trim(),
      stage_status: form.stage_status,
      progress_percentage: progress,
      actual_start_date: form.actual_start_date || null,
      planned_end_date: form.planned_end_date || null,
      actual_completion_date: form.actual_completion_date || null,
      notes: form.notes.trim() || null,
    };

    if (!payload.stage_name) {
      setError("Stage name is required.");
      return;
    }

    setSaving(true);
    try {
      const response = await createStageEvent(projectId, payload);
      if (!response.saved) {
        throw new Error("The server did not confirm that the event was saved.");
      }

      // Notify the read-only bottleneck panel only after a confirmed DB write.
      onEventSaved?.();
      setForm({ ...INITIAL_FORM });
      setMessage(`Stage event #${response.event.id} saved successfully.`);

      // This refresh is separate: a read failure must not imply the write failed.
      try {
        const refreshed = await getStageEvents(projectId);
        setEvents(refreshed.events);
      } catch (refreshError) {
        const detail =
          refreshError instanceof Error
            ? refreshError.message
            : "Unable to refresh the event list.";
        setError(`Event was saved, but the list could not refresh: ${detail}`);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to save stage event.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="stage-events-panel">
      <div className="panel-heading">
        <div>
          <h2>Stage Event Management</h2>
          <p>Recorded stage information for {projectName}</p>
        </div>
        <span className="count-badge">{events.length} events</span>
      </div>

      <div className="stage-events-notice">
        Enter only stage information supported by authorized project records.
        Unknown dates can be left empty. Manually entered events are not
        independently verified by this application.
      </div>

      <form className="stage-events-form" onSubmit={(event) => void handleSubmit(event)}>
        <h3>Record a Stage Event</h3>
        <div className="stage-events-grid">
          <label>
            <span>Stage Name</span>
            <input
              required
              maxLength={100}
              value={form.stage_name}
              onChange={(event) => updateField("stage_name", event.target.value)}
              placeholder="Official stage name"
            />
          </label>

          <label>
            <span>Stage Status</span>
            <select
              value={form.stage_status}
              onChange={(event) => {
                const status = event.target.value as StageStatus;
                setForm((previous) => ({
                  ...previous,
                  stage_status: status,
                  actual_completion_date:
                    status === "completed" ? previous.actual_completion_date : "",
                }));
                setError("");
                setMessage("");
              }}
            >
              <option value="planned">Planned</option>
              <option value="in_progress">In Progress</option>
              <option value="on_hold">On Hold</option>
              <option value="completed">Completed</option>
            </select>
          </label>

          <label>
            <span>Progress (%)</span>
            <input
              type="number"
              min={0}
              max={100}
              step="any"
              required
              value={form.progress_percentage}
              onChange={(event) =>
                updateField("progress_percentage", event.target.value)
              }
            />
          </label>

          <label>
            <span>Actual Start Date</span>
            <input
              type="date"
              value={form.actual_start_date}
              onChange={(event) =>
                updateField("actual_start_date", event.target.value)
              }
            />
          </label>

          <label>
            <span>Planned End Date</span>
            <input
              type="date"
              value={form.planned_end_date}
              onChange={(event) =>
                updateField("planned_end_date", event.target.value)
              }
            />
          </label>

          <label>
            <span>Actual Completion Date</span>
            <input
              type="date"
              disabled={form.stage_status !== "completed"}
              value={form.actual_completion_date}
              onChange={(event) =>
                updateField("actual_completion_date", event.target.value)
              }
            />
          </label>
        </div>

        <label className="stage-events-notes">
          <span>Supporting Notes</span>
          <textarea
            rows={3}
            value={form.notes}
            onChange={(event) => updateField("notes", event.target.value)}
            placeholder="Source or supporting context"
          />
        </label>

        <div className="stage-events-actions">
          <button type="submit" className="refresh-button" disabled={saving}>
            {saving ? "Saving Stage Event..." : "Save Stage Event"}
          </button>
        </div>
      </form>

      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
      {message && (
        <div className="stage-events-success" role="status">
          {message}
        </div>
      )}

      <div className="stage-events-history">
        <h3>Recorded Stage Timeline</h3>
        {loading ? (
          <p className="loading">Loading stage events...</p>
        ) : events.length === 0 ? (
          <p className="empty-state">No stage events have been recorded.</p>
        ) : (
          <div className="stage-events-list">
            {events.map((stageEvent) => (
              <article className="stage-event-card" key={stageEvent.id}>
                <div className="stage-event-card-top">
                  <h4>{stageEvent.stage_name}</h4>
                  <span className="count-badge">
                    {formatStatus(stageEvent.stage_status)}
                  </span>
                </div>
                <div className="stage-event-info">
                  <div>
                    <span>Actual Start</span>
                    <strong>{formatDate(stageEvent.actual_start_date)}</strong>
                  </div>
                  <div>
                    <span>Planned End</span>
                    <strong>{formatDate(stageEvent.planned_end_date)}</strong>
                  </div>
                  <div>
                    <span>Actual Completion</span>
                    <strong>{formatDate(stageEvent.actual_completion_date)}</strong>
                  </div>
                  <div>
                    <span>Progress</span>
                    <strong>{stageEvent.progress_percentage}%</strong>
                  </div>
                </div>
                {stageEvent.notes && (
                  <p className="stage-event-notes">{stageEvent.notes}</p>
                )}
                <small className="stage-event-recorded">
                  Database entry #{stageEvent.id} · Recorded at {" "}
                  {formatTimestamp(stageEvent.recorded_at)}
                </small>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
