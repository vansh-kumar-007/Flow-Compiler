import { useState } from "react";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").trim();

export default function App() {
  const [apiState, setApiState] = useState("idle");
  const [apiMessage, setApiMessage] = useState("API status has not been checked.");

  async function checkApi() {
    setApiState("loading");
    setApiMessage("Checking the backend health endpoint…");

    try {
      const response = await fetch(API_BASE_URL + "/api/health", {
        headers: { Accept: "application/json" }
      });
      const payload = await response.json();

      if (!response.ok || payload.status !== "ok") {
        throw new Error("The backend returned an unexpected response.");
      }

      setApiState("success");
      setApiMessage("Backend reachable · " + payload.service);
    } catch {
      setApiState("error");
      setApiMessage("Could not reach the API. Start the backend on port 8787 and retry.");
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Flow Compiler home">
          <span className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span className="brand-copy">
            <span className="brand-name">FLOW<span className="brand-accent"> COMPILER</span></span>
            <span className="brand-subtitle">PERSONAL EXECUTION ENGINE</span>
          </span>
        </a>
        <div className="system-status"><span className="status-light" /> FOUNDATION ONLINE</div>
      </header>

      <section className="hero" aria-labelledby="hero-title">
        <div className="eyebrow"><span className="eyebrow-line" /> INPUT <span className="arrow">/</span> STRUCTURE <span className="arrow">/</span> EXECUTION</div>
        <h1 id="hero-title">Make room for<br /><span>what moves you forward.</span></h1>
        <p className="hero-copy">
          A calmer way to turn scattered thoughts into a sequence of concrete next actions.
          The foundation is taking shape; AI planning is the next implementation phase.
        </p>
      </section>

      <section className="workspace" aria-label="System foundation status">
        <article className="panel connection-panel">
          <div className="panel-topline">
            <span className="panel-index">01</span>
            <span className="panel-label">SYSTEM CHECK</span>
            <span className="panel-decoration" aria-hidden="true">FC / 001</span>
          </div>
          <h2>Connection status</h2>
          <p className="panel-description">Verify that the React interface can reach the separate Express backend.</p>

          <div className={"connection-readout " + apiState} role="status" aria-live="polite">
            <span className="readout-dot" />
            <div>
              <strong>{apiState === "success" ? "API CONNECTED" : apiState === "loading" ? "CHECK IN PROGRESS" : apiState === "error" ? "API UNREACHABLE" : "AWAITING CHECK"}</strong>
              <span>{apiMessage}</span>
            </div>
          </div>

          <button className="primary-button" type="button" onClick={checkApi} disabled={apiState === "loading"}>
            <span>{apiState === "loading" ? "CHECKING CONNECTION" : "TEST API CONNECTION"}</span>
            <span className="button-arrow" aria-hidden="true">↗</span>
          </button>
        </article>

        <article className="panel roadmap-panel">
          <div className="panel-topline">
            <span className="panel-index">02</span>
            <span className="panel-label">BUILD STATUS</span>
            <span className="panel-decoration" aria-hidden="true">PHASE 01</span>
          </div>
          <h2>The compiler is being assembled.</h2>
          <p className="panel-description">Each layer is verified before the next one is added.</p>

          <ol className="build-steps">
            <li className="build-step complete">
              <span className="step-glyph" aria-hidden="true">✓</span>
              <span><strong>Application foundation</strong><small>React · Vite · Express · health endpoint</small></span>
              <span className="step-state">READY</span>
            </li>
            <li className="build-step active">
              <span className="step-glyph" aria-hidden="true">02</span>
              <span><strong>Secure AI planning API</strong><small>Validated tasks · Nemotron · dependencies</small></span>
              <span className="step-state">NEXT</span>
            </li>
            <li className="build-step">
              <span className="step-glyph" aria-hidden="true">03</span>
              <span><strong>Workflow execution</strong><small>Graph · completion · focus · recompilation</small></span>
              <span className="step-state">QUEUED</span>
            </li>
          </ol>
          <p className="honesty-note"><span aria-hidden="true">i</span> Workflow generation is not available yet. This screen is a working foundation, not a simulated AI demo.</p>
        </article>
      </section>

      <footer className="footer">
        <span>FLOW COMPILER <span className="footer-muted">/ ENGINEERING BUILD</span></span>
        <span>LOCAL-FIRST · SECRET-SAFE BY DESIGN</span>
      </footer>
    </main>
  );
}
