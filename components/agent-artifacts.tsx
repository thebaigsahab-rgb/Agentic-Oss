"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Camera, FileText, Trash2, ExternalLink, RefreshCw, Loader2 } from "lucide-react";
import type { ArtifactInfo } from "@/lib/computer-use-types";
import styles from "./agent-cockpit.module.css";

export type AgentArtifactsProps = {
  refreshSignal?: number;
};

function formatBytes(bytes: number): string {
  if (bytes > 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes > 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function AgentArtifacts({ refreshSignal }: AgentArtifactsProps) {
  const [screenshots, setScreenshots] = useState<ArtifactInfo[]>([]);
  const [pdfs, setPdfs] = useState<ArtifactInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [hostReady, setHostReady] = useState(true);

  const fetchArtifacts = useCallback(async () => {
    try {
      const res = await fetch("/api/system");
      if (res.ok) {
        const data = (await res.json()) as { snapshot?: { hostReady?: boolean }; artifacts?: { screenshots?: ArtifactInfo[]; pdf?: ArtifactInfo[] } };
        setScreenshots(data.artifacts?.screenshots || []);
        setPdfs(data.artifacts?.pdf || []);
        setHostReady(data.snapshot?.hostReady !== false);
      }
    } catch {
      // keep previous lists
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const kickoff = setTimeout(fetchArtifacts, 0);
    return () => clearTimeout(kickoff);
  }, [fetchArtifacts, refreshSignal]);

  const removeArtifact = async (kind: "screenshots" | "pdf", name: string) => {
    try {
      await fetch("/api/system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_artifact", kind, name }),
      });
      void fetchArtifacts();
    } catch {}
  };

  return (
    <div className={styles.artifactRoot}>
      <div className={styles.artifactToolbar}>
        <span className={styles.artifactTitle}>
          <Camera size={14} /> Screenshot vault <span className={styles.artifactCount}>{screenshots.length}</span>
        </span>
        <button type="button" className={styles.refreshBtn} onClick={() => void fetchArtifacts()} aria-label="Refresh artifacts">
          {loading ? <Loader2 size={14} className={styles.spin} /> : <RefreshCw size={14} />}
        </button>
      </div>

      {!hostReady && (
        <p className={styles.emptyNote}>The device bridge is offline — capture and PDF tools resume when it reconnects.</p>
      )}

      {screenshots.length === 0 ? (
        <p className={styles.emptyNote}>No screenshots yet. Say &quot;screenshot&quot; to J.A.R.V.I.S., run it from the command deck, or let a mission capture one.</p>
      ) : (
        <div className={styles.artifactGrid}>
          {screenshots.map((shot) => (
            <figure key={shot.name} className={styles.artifactCard}>
              <a href={shot.url} target="_blank" rel="noopener noreferrer" className={styles.thumbLink} title={shot.name}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={shot.url} alt={shot.name} className={styles.thumb} loading="lazy" />
              </a>
              <figcaption className={styles.artifactMeta}>
                <span className={styles.artifactName} title={shot.name}>{shot.name}</span>
                <span className={styles.artifactSize}>{formatBytes(shot.bytes)}</span>
                <span className={styles.artifactActions}>
                  <a href={shot.url} target="_blank" rel="noopener noreferrer" className={styles.artifactAction} title="Open full size">
                    <ExternalLink size={13} />
                  </a>
                  <button type="button" className={styles.artifactAction} title="Delete" onClick={() => void removeArtifact("screenshots", shot.name)}>
                    <Trash2 size={13} />
                  </button>
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      )}

      <div className={`${styles.artifactToolbar} ${styles.pdfDivider}`}>
        <span className={styles.artifactTitle}>
          <FileText size={14} /> PDF vault <span className={styles.artifactCount}>{pdfs.length}</span>
        </span>
      </div>

      {pdfs.length === 0 ? (
        <p className={styles.emptyNote}>No PDFs yet. Ask J.A.R.V.I.S. to &quot;save https://… as pdf&quot; or use the command deck.</p>
      ) : (
        <div className={styles.pdfList}>
          {pdfs.map((doc) => (
            <div key={doc.name} className={styles.pdfRow}>
              <FileText size={15} />
              <a href={doc.url} target="_blank" rel="noopener noreferrer" className={styles.pdfName} title={doc.name}>
                {doc.name}
              </a>
              <span className={styles.artifactSize}>{formatBytes(doc.bytes)}</span>
              <span className={styles.artifactSize}>{new Date(doc.modifiedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
              <span className={styles.artifactActions}>
                <a href={doc.url} target="_blank" rel="noopener noreferrer" className={styles.artifactAction} title="Open PDF">
                  <ExternalLink size={13} />
                </a>
                <button type="button" className={styles.artifactAction} title="Delete" onClick={() => void removeArtifact("pdf", doc.name)}>
                  <Trash2 size={13} />
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
