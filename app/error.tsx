"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, RefreshCw, Home, ChevronDown, ChevronUp } from "lucide-react";

export default function GlobalErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    console.error("[Agentic OS] Error boundary caught error:", error);
    try {
      fetch("/api/client-error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: error?.message || "Unknown error",
          stack: error?.stack || "",
          digest: error?.digest || "",
          name: error?.name || "",
          url: typeof window !== "undefined" ? window.location.href : "",
          userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
        }),
      }).catch(() => {});
    } catch {}

    // Auto-heal chunk load error resulting from background rebuilds
    if (
      error?.message?.includes("ChunkLoadError") ||
      error?.message?.includes("Loading chunk") ||
      error?.message?.includes("Failed to fetch dynamically imported module")
    ) {
      window.location.reload();
    }
  }, [error]);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#080c14",
        color: "#f8fafc",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        padding: "16px",
      }}
    >
      <div
        style={{
          maxWidth: "460px",
          width: "100%",
          background: "linear-gradient(135deg, #0e1726 0%, #0b1120 100%)",
          border: "1px solid rgba(56, 189, 248, 0.25)",
          borderRadius: "16px",
          padding: "28px 20px",
          textAlign: "center",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.8)",
        }}
      >
        <div
          style={{
            width: "52px",
            height: "52px",
            borderRadius: "50%",
            background: "rgba(56, 189, 248, 0.12)",
            border: "1px solid rgba(56, 189, 248, 0.3)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: "14px",
            color: "#38bdf8",
          }}
        >
          <AlertTriangle size={26} />
        </div>
        <h2 style={{ fontSize: "18px", fontWeight: 700, margin: "0 0 6px 0", color: "#ffffff" }}>
          Control Center Session Restored
        </h2>
        <p style={{ fontSize: "12px", color: "#94a3b8", margin: "0 0 16px 0", lineHeight: 1.5 }}>
          The desktop interface encountered a client session transition. Click Reload to resume your session with synchronized state.
        </p>

        {error?.message && (
          <div
            style={{
              background: "rgba(239, 68, 68, 0.08)",
              border: "1px solid rgba(239, 68, 68, 0.2)",
              borderRadius: "8px",
              padding: "10px 12px",
              marginBottom: "16px",
              textAlign: "left",
              fontSize: "11px",
              color: "#fca5a5",
              wordBreak: "break-word",
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: "4px" }}>
              Diagnostic: {error.name || "Error"}: {error.message}
            </div>
            {error.stack && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowDetails((p) => !p)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#38bdf8",
                    fontSize: "10px",
                    cursor: "pointer",
                    padding: 0,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "3px",
                  }}
                >
                  {showDetails ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                  <span>{showDetails ? "Hide stack" : "View stack trace"}</span>
                </button>
                {showDetails && (
                  <pre
                    style={{
                      marginTop: "6px",
                      fontSize: "9px",
                      color: "#94a3b8",
                      overflowX: "auto",
                      maxHeight: "120px",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {error.stack}
                  </pre>
                )}
              </div>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: "10px", justifyContent: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => {
              try {
                window.location.reload();
              } catch {
                reset();
              }
            }}
            style={{
              padding: "9px 18px",
              background: "linear-gradient(135deg, #38bdf8 0%, #2563eb 100%)",
              color: "#ffffff",
              border: "none",
              borderRadius: "8px",
              fontWeight: 600,
              fontSize: "12.5px",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <RefreshCw size={14} /> Reload Interface
          </button>
          <button
            type="button"
            onClick={() => {
              try {
                localStorage.removeItem("control-center-sidebar-collapsed");
                window.location.href = "/?tab=today";
              } catch {
                reset();
              }
            }}
            style={{
              padding: "9px 18px",
              background: "rgba(255, 255, 255, 0.06)",
              color: "#cbd5e1",
              border: "1px solid rgba(255, 255, 255, 0.12)",
              borderRadius: "8px",
              fontWeight: 600,
              fontSize: "12.5px",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <Home size={14} /> Return to Home
          </button>
        </div>
      </div>
    </div>
  );
}
