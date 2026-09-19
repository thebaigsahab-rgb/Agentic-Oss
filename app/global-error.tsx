"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Agentic OS] Global error:", error);
  }, [error]);

  return (
    <html lang="en" data-theme="dark">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#080c14",
          color: "#f8fafc",
          fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          padding: "20px",
        }}
      >
        <div
          style={{
            maxWidth: "460px",
            width: "100%",
            background: "linear-gradient(135deg, #0e1726 0%, #0b1120 100%)",
            border: "1px solid rgba(56, 189, 248, 0.25)",
            borderRadius: "16px",
            padding: "32px 24px",
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
              marginBottom: "16px",
              color: "#38bdf8",
            }}
          >
            <AlertTriangle size={26} />
          </div>
          <h2 style={{ fontSize: "19px", fontWeight: 700, margin: "0 0 8px 0", color: "#ffffff" }}>
            Control Center Session Restored
          </h2>
          <p style={{ fontSize: "12.5px", color: "#94a3b8", margin: "0 0 22px 0", lineHeight: 1.5 }}>
            A client session transition occurred. Click Reload to resume your session with synchronized state.
          </p>
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
              padding: "10px 20px",
              background: "linear-gradient(135deg, #38bdf8 0%, #2563eb 100%)",
              color: "#ffffff",
              border: "none",
              borderRadius: "8px",
              fontWeight: 600,
              fontSize: "13px",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <RefreshCw size={14} /> Reload Interface
          </button>
        </div>
      </body>
    </html>
  );
}
