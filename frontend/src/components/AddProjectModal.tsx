import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { createProject, type CreateProjectPayload, type Project } from "../services/projectsApi";
import "./AddProjectModal.css";

async function updateProject(id: Project["id"], payload: CreateProjectPayload): Promise<{ project: Project }> {
  const response = await fetch(`/api/projects/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.detail || data?.message || "Could not update the project.");
  }
  return data;
}

type Props = { onClose: () => void; onCreated: (project: Project) => void; project?: Project; onUpdated?: (project: Project) => void };
type FormValues = {
  project_id: string; project_name: string; project_type: string;
  implementing_agency: string; state: string; district: string;
  latitude: string; longitude: string; total_land_area: string;
  acquired_land_area: string; current_stage: string; notes: string;
};

// All 28 states and 8 union territories (India's National Portal list).
export const STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh",
  "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka",
  "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram",
  "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu",
  "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
] as const;
export const UNION_TERRITORIES = [
  "Andaman and Nicobar Islands", "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Jammu and Kashmir",
  "Ladakh", "Lakshadweep", "Puducherry",
] as const;
const STAGES = [
  "Planning", "Notification", "Administrative Approval", "Land Verification",
  "Compensation", "Legal Resolution", "Rehabilitation & Resettlement",
  "Possession", "Completion",
] as const;
const INITIAL: FormValues = {
  project_id: "", project_name: "", project_type: "", implementing_agency: "",
  state: "", district: "", latitude: "", longitude: "",
  total_land_area: "", acquired_land_area: "0", current_stage: "Planning", notes: "",
};

function optionalNumber(value: string): number | null {
  return value.trim() === "" ? null : Number(value);
}

export default function AddProjectModal({ onClose, onCreated, project, onUpdated }: Props) {
  const editing = project !== undefined;
  const [form, setForm] = useState<FormValues>(() => project ? {
    project_id: project.project_id,
    project_name: project.project_name ?? "",
    project_type: project.project_type ?? "",
    implementing_agency: project.implementing_agency ?? "",
    state: project.state ?? "",
    district: project.district ?? "",
    latitude: project.latitude == null ? "" : String(project.latitude),
    longitude: project.longitude == null ? "" : String(project.longitude),
    total_land_area: project.total_land_area == null ? "" : String(project.total_land_area),
    acquired_land_area: project.acquired_land_area == null ? "0" : String(project.acquired_land_area),
    current_stage: project.current_stage ?? "Planning",
    notes: "", // GET project does not expose notes: do not claim to preload them.
  } : INITIAL);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const firstInput = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    firstInput.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      previousFocus.current?.focus();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
      if (event.key !== "Tab") return;
      const items = dialog.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)'
      );
      if (!items?.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [saving, onClose]);

  function update(field: keyof FormValues, value: string) {
    setForm(prev => ({ ...prev, [field]: value }));
    setError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const id = form.project_id.trim();
    const name = form.project_name.trim();
    const total = Number(form.total_land_area);
    const acquired = Number(form.acquired_land_area);
    const latitude = optionalNumber(form.latitude);
    const longitude = optionalNumber(form.longitude);
    if (!id || !name) return setError("Project ID and project name are required.");
    if (id.length > 100 || name.length > 300) return setError("Project ID or project name is too long.");
    if (!form.state) return setError("Please select a state or union territory.");
    if (!Number.isFinite(total) || total <= 0 || !form.total_land_area.trim())
      return setError("Total land area must be greater than zero.");
    if (!Number.isFinite(acquired) || acquired < 0 || acquired > total)
      return setError("Acquired land area must be between zero and the total land area.");
    if (latitude !== null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90))
      return setError("Latitude must be between -90 and 90.");
    if (longitude !== null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180))
      return setError("Longitude must be between -180 and 180.");
    const payload: CreateProjectPayload = {
      project_id: id, project_name: name,
      project_type: form.project_type.trim(), implementing_agency: form.implementing_agency.trim(),
      state: form.state, district: form.district.trim(), latitude, longitude,
      total_land_area: total, acquired_land_area: acquired,
      current_stage: form.current_stage, notes: editing ? undefined : form.notes.trim(),
    };
    setSaving(true);
    setError("");
    try {
      if (project) {
        const result = await updateProject(project.id, payload);
        onUpdated?.(result.project);
      } else {
        const result = await createProject(payload);
        onCreated(result.project);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the project.");
    } finally {
      setSaving(false);
    }
  }

  const textField = (title: string, key: keyof FormValues, required = false, maxLength?: number) => (
    <label className="lap-field" key={key}>
      <span>{title}{required && <em aria-hidden="true"> *</em>}</span>
      <input ref={key === "project_id" ? firstInput : undefined}
        value={form[key]} onChange={event => update(key, event.target.value)}
        required={required} maxLength={maxLength} disabled={saving || (editing && key === "project_id")}
        placeholder={`Enter ${title.toLowerCase()}`} />
    </label>
  );
  const numberField = (title: string, key: keyof FormValues, min?: number, max?: number, required = false) => (
    <label className="lap-field" key={key}>
      <span>{title}{required && <em aria-hidden="true"> *</em>}</span>
      <input type="number" step="any" min={min} max={max} value={form[key]}
        onChange={event => update(key, event.target.value)} required={required}
        disabled={saving} placeholder="0.00" />
    </label>
  );

  const total = Number(form.total_land_area);
  const acquired = Number(form.acquired_land_area);
  const remaining = form.total_land_area.trim() !== "" && Number.isFinite(total) && total > 0
    && Number.isFinite(acquired) && acquired >= 0 && acquired <= total
    ? `${(total - acquired).toLocaleString("en-IN", { maximumFractionDigits: 4 })} ha` : "—";

  // Rendering into document.body avoids fixed-position dialogs being trapped by transformed dashboard containers.
  return createPortal(
    <div className="lap-overlay" onMouseDown={event => {
      if (event.target === event.currentTarget && !saving) onClose();
    }}>
      <div ref={dialog} className="lap-dialog" role="dialog" aria-modal="true"
        aria-labelledby="lap-title" aria-describedby="lap-description">
        <header className="lap-header">
          <div className="lap-heading">
            <span className="lap-eyebrow"><span className="lap-eyebrow-dot" /> {editing ? "PROJECT UPDATE" : "PROJECT REGISTRATION"}</span>
            <h2 id="lap-title">{editing ? "Edit project" : "Create a new project"}</h2>
            <p id="lap-description">{editing ? "Update project details. The project ID and prediction history stay unchanged." : "Register project details for monitoring and delay analysis."}</p>
          </div>
          <button type="button" className="lap-close" aria-label="Close form" disabled={saving} onClick={onClose}>×</button>
        </header>
        <form className="lap-form" onSubmit={event => void submit(event)}>
          <section className="lap-section" aria-labelledby="lap-basic">
            <div className="lap-section-heading"><span className="lap-step">01</span><div><h3 id="lap-basic">Project information</h3><p>Identify the project and implementing authority.</p></div></div>
            <div className="lap-grid">
              {textField("Project ID", "project_id", true, 100)}
              {textField("Project name", "project_name", true, 300)}
              {textField("Project type", "project_type", false, 100)}
              {textField("Implementing agency", "implementing_agency", false, 200)}
            </div>
          </section>
          <section className="lap-section" aria-labelledby="lap-location">
            <div className="lap-section-heading"><span className="lap-step">02</span><div><h3 id="lap-location">Location details</h3><p>Select an Indian state or union territory and enter the district.</p></div></div>
            <div className="lap-grid">
              <label className="lap-field"><span>State / Union territory <em aria-hidden="true">*</em></span>
                <select value={form.state} onChange={event => update("state", event.target.value)} required disabled={saving}>
                  <option value="" disabled>Select state or union territory</option>
                  <optgroup label="States (28)">{STATES.map(state => <option value={state} key={state}>{state}</option>)}</optgroup>
                  <optgroup label="Union territories (8)">{UNION_TERRITORIES.map(territory => <option value={territory} key={territory}>{territory}</option>)}</optgroup>
                </select>
              </label>
              {textField("District", "district", false, 100)}
              {numberField("Latitude (optional)", "latitude", -90, 90)}
              {numberField("Longitude (optional)", "longitude", -180, 180)}
            </div>
          </section>
          <section className="lap-section" aria-labelledby="lap-land">
            <div className="lap-section-heading"><span className="lap-step">03</span><div><h3 id="lap-land">Acquisition details</h3><p>Enter land measurements in hectares.</p></div></div>
            <div className="lap-grid">
              {numberField("Total land area (ha)", "total_land_area", 0, undefined, true)}
              {numberField("Acquired land area (ha)", "acquired_land_area", 0, undefined, true)}
              <label className="lap-field"><span>Current stage</span>
                <select value={form.current_stage} onChange={event => update("current_stage", event.target.value)} disabled={saving}>
                  {STAGES.map(stage => <option value={stage} key={stage}>{stage}</option>)}
                </select>
              </label>
              <div className="lap-remaining"><span>Remaining land area</span><strong>{remaining}</strong><small>Calculated automatically on save</small></div>
              {!editing && <label className="lap-field lap-full"><span>Notes (optional)</span>
                <textarea rows={3} maxLength={5000} value={form.notes} onChange={event => update("notes", event.target.value)}
                  disabled={saving} placeholder="Add relevant project information..." />
              </label>}
            </div>
          </section>
          {error && <p className="lap-error" role="alert">{error}</p>}
          <footer className="lap-footer">
            <p><span aria-hidden="true">●</span> Required fields are marked with an asterisk.</p>
            <div className="lap-actions">
              <button type="button" className="lap-cancel" disabled={saving} onClick={onClose}>Cancel</button>
              <button type="submit" className="lap-save" disabled={saving}>{saving ? "Saving project…" : editing ? "Save changes" : "+ Create project"}</button>
            </div>
          </footer>
        </form>
      </div>
    </div>,
    document.body
  );
}
