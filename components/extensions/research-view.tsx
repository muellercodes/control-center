"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  Bookmark,
  ExternalLink,
  Instagram,
  MapPin,
  Search,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import type { ResearchedBusiness } from "@/lib/extensions/research";
import styles from "./research-view.module.css";
import { PageHeading, Panel } from "./shared";

type ShortlistEntry = {
  id: string;
  name: string;
  town: string;
  status: "candidate" | "visiting" | "posted" | "passed";
  note: string;
  payload: unknown;
  addedAt: string;
};

type RunResult = {
  ranAt: string;
  provider: string;
  model: string;
  businesses: ResearchedBusiness[];
  errors: string[];
};

const STATUSES: ShortlistEntry["status"][] = [
  "candidate",
  "visiting",
  "posted",
  "passed",
];

function presenceLabel(business: ResearchedBusiness) {
  const { verdict } = business.presence;
  if (verdict === "unknown") return "No site found";
  if (verdict === "blocked") return "Not checkable";
  if (verdict === "unreachable") return "Site down";
  if (verdict === "needs-work") return "Dated site";
  return "Solid site";
}

/** Only a verified problem gets the attention colour; a maybe stays neutral. */
function pillClass(business: ResearchedBusiness) {
  const { verdict } = business.presence;
  if (verdict === "needs-work" || verdict === "unreachable") return styles.pillGap;
  if (verdict === "unknown" || verdict === "blocked") return styles.pillUnknown;
  return styles.pillSolid;
}

export function ResearchView() {
  const [towns, setTowns] = useState("Bangor, Orono");
  const [category, setCategory] = useState("");
  const [criteria, setCriteria] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState("");
  const [shortlist, setShortlist] = useState<ShortlistEntry[]>([]);

  useEffect(() => {
    void fetch("/api/extensions/shortlist", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => payload && setShortlist(payload.entries))
      .catch(() => undefined);
  }, []);

  const run = async (event: FormEvent) => {
    event.preventDefault();
    setRunning(true);
    setError("");
    try {
      const response = await fetch("/api/live/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          towns: towns.split(",").map((town) => town.trim()).filter(Boolean),
          category,
          criteria,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "The run failed.");
      setResult(payload as RunResult);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "The run failed.");
    } finally {
      setRunning(false);
    }
  };

  const save = async (business: ResearchedBusiness) => {
    const response = await fetch("/api/extensions/shortlist", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: business.id,
        name: business.name,
        town: business.town,
        status: "candidate",
        note: business.note,
        payload: business,
      }),
    });
    if (response.ok) setShortlist((await response.json()).entries);
  };

  const setStatus = async (entry: ShortlistEntry, status: ShortlistEntry["status"]) => {
    const response = await fetch("/api/extensions/shortlist", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...entry, status }),
    });
    if (response.ok) setShortlist((await response.json()).entries);
  };

  const remove = async (id: string) => {
    const response = await fetch(
      `/api/extensions/shortlist?id=${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
    if (response.ok) setShortlist((await response.json()).entries);
  };

  const saved = new Set(shortlist.map((entry) => entry.id));

  return (
    <div className="view">
      <PageHeading
        eyebrow="Extension"
        title="Research"
        description="Find independent businesses worth visiting and featuring. Every result is re-checked by fetching the real site, so nothing here rests on the model's word."
      />

      <Panel className="settings-panel reveal">
        <form onSubmit={run}>
          <div className="settings-field">
            <label htmlFor="research-towns">Towns</label>
            <input
              id="research-towns"
              value={towns}
              onChange={(event) => setTowns(event.target.value)}
              placeholder="Bangor, Orono, Old Town"
            />
            <p className="fine-print">Comma separated.</p>
          </div>
          <div className="settings-field">
            <label htmlFor="research-category">Kind of business</label>
            <input
              id="research-category"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              placeholder="cafes, makers, outfitters — leave empty for anything independent"
            />
          </div>
          <div className="settings-field">
            <label htmlFor="research-criteria">Anything else</label>
            <textarea
              id="research-criteria"
              rows={2}
              value={criteria}
              onChange={(event) => setCriteria(event.target.value)}
              placeholder="owner-operated, open weekends, somewhere with good natural light"
            />
          </div>
          {error && <p className="error-notice">{error}</p>}
          <button className="button button-primary" disabled={running}>
            <Search size={15} /> {running ? "Researching…" : "Find businesses"}
          </button>
          {running && (
            <p className="fine-print">
              Searching the web, then fetching each site to check it. This takes
              a minute.
            </p>
          )}
        </form>
      </Panel>

      {result && (
        <>
          <p className={styles.runMeta}>
            {result.businesses.length} found via {result.provider} ·{" "}
            {result.model} · sorted by how much their web presence could be
            improved
          </p>
          {result.errors.map((message) => (
            <p className="error-notice" key={message}>
              {message}
            </p>
          ))}

          <div className={styles.grid}>
            {result.businesses.map((business) => (
              <article className={styles.card} key={business.id}>
                <div className={styles.cardHead}>
                  <div>
                    <h3>{business.name}</h3>
                    <p className={styles.where}>
                      <MapPin size={11} />
                      {[business.category, business.town]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <span className={pillClass(business)}>
                    {presenceLabel(business)}
                  </span>
                </div>

                {business.note && <p className={styles.note}>{business.note}</p>}

                <ul className={styles.reasons}>
                  {business.presence.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>

                <div className={styles.links}>
                  {business.website ? (
                    <a href={business.website} target="_blank" rel="noreferrer">
                      <ExternalLink size={12} /> Website
                    </a>
                  ) : (
                    <span className={styles.noLink}>No website</span>
                  )}
                  {business.instagram && (
                    <a
                      href={`https://www.instagram.com/${business.instagram}/`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Instagram size={12} /> @{business.instagram}
                    </a>
                  )}
                  <button
                    type="button"
                    className={styles.save}
                    disabled={saved.has(business.id)}
                    onClick={() => void save(business)}
                  >
                    <Bookmark size={12} />
                    {saved.has(business.id) ? "Shortlisted" : "Shortlist"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      <Panel className={`${styles.shortlist} reveal`}>
        <p className="eyebrow">Shortlist · {shortlist.length}</p>
        <p className={styles.shortlistHint}>
          <TriangleAlert size={11} /> A spotlight is a gift, not a pitch. The
          site notes are here so you know where you could genuinely help — not
          as a reason to sell to anyone.
        </p>
        {shortlist.length ? (
          <ul className={styles.entries}>
            {shortlist.map((entry) => (
              <li key={entry.id}>
                <div>
                  <b>{entry.name}</b>
                  {entry.town && <small> · {entry.town}</small>}
                </div>
                <select
                  value={entry.status}
                  aria-label={`Status for ${entry.name}`}
                  onChange={(event) =>
                    void setStatus(
                      entry,
                      event.target.value as ShortlistEntry["status"],
                    )
                  }
                >
                  {STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  title={`Remove ${entry.name}`}
                  onClick={() => void remove(entry.id)}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.empty}>
            Nothing shortlisted yet. Run a search and save the places worth a
            visit.
          </p>
        )}
      </Panel>
    </div>
  );
}
