import Link from "next/link";
import { ArrowLeft, Compass } from "lucide-react";

export default function NotFound() {
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
        padding: "20px",
      }}
    >
      <div
        style={{
          maxWidth: "440px",
          width: "100%",
          background: "linear-gradient(135deg, #0e1726 0%, #0b1120 100%)",
          border: "1px solid rgba(56, 189, 248, 0.25)",
          borderRadius: "16px",
          padding: "36px 24px",
          textAlign: "center",
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
          <Compass size={26} />
        </div>
        <h2 style={{ fontSize: "20px", fontWeight: 700, margin: "0 0 8px 0" }}>Page Not Found</h2>
        <p style={{ fontSize: "13px", color: "#94a3b8", margin: "0 0 24px 0", lineHeight: 1.5 }}>
          The requested path was not found in Agentic OS. Return to the Control Center to continue.
        </p>
        <Link
          href="/"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            padding: "10px 20px",
            background: "linear-gradient(135deg, #38bdf8 0%, #2563eb 100%)",
            color: "#ffffff",
            borderRadius: "8px",
            fontWeight: 600,
            fontSize: "13px",
            textDecoration: "none",
          }}
        >
          <ArrowLeft size={15} /> Return to Control Center
        </Link>
      </div>
    </div>
  );
}
