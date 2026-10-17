import { useState } from "react";

const exampleTasks = [
  ["01", "Reproduce the login bug", "15 MIN · BLOCKER REMOVAL", "READY"],
  ["02", "Fix and verify login", "25 MIN · DEPENDS ON 01", "QUEUED"],
  ["03", "Deploy portfolio", "30 MIN · DEPENDS ON 02", "QUEUED"]
];

export default function App() {
  const [brainDump, setBrainDump] = useState("");
  const [minutes, setMinutes] = useState(120);
  const [apiState, setApiState] = useState("idle");
  const [apiMessage, setApiMessage] = useState("Backend connection has not been checked.");

  async function checkApi() {
    setApiState("loading");
    setApiMessage("Checking the Express health endpoint…");
    try {
      const response = await fetch("/api/health", { headers: { Accept: "application/json" } });
      const payload = await response.json();
      if (!response.ok || payload.status !== "ok") throw new Error("Unexpected health response");
      setApiState("success");
      setApiMessage("Backend reachable · " + payload.service);
    } catch {
      setApiState("error");
      setApiMessage("Backend unavailable from this preview. AI planning is not enabled.");
    }
  }

  return <main className="app-shell">
    <header className="topbar">
      <a className="brand" href="/" aria-label="Flow Compiler home"><span className="brand-mark" aria-hidden="true"><i/><i/><i/></span><span className="brand-copy"><strong>FLOW<span> / COMPILER</span></strong><small>PERSONAL EXECUTION ENGINE</small></span></a>
      <div className="header-right"><span className="version-chip">BUILD 0.3.0 · PHASE 3</span><div className="system-status"><i/> UI ONLINE</div></div>
    </header>
    <section className="hero" aria-labelledby="hero-title">
      <div className="eyebrow"><i/> RAW THOUGHTS <span>/</span> STRUCTURE <span>/</span> EXECUTION</div>
      <div className="hero-layout"><div><h1 id="hero-title">Turn chaos into<br/><em>clear momentum.</em></h1><p>A personal command center for turning scattered thoughts into focused, dependency-aware work.</p></div><div className="hero-orbit" aria-hidden="true"><div>FC<span>↗</span></div><small>THINK IN FLOWS</small></div></div>
    </section>
    <section className="workspace" aria-label="Workflow compiler workspace">
      <article className="panel input-panel">
        <div className="panel-topline"><b>01</b><span>INPUT // RAW THOUGHTS</span><small>INGEST</small></div>
        <h2>Get it out of your head.</h2><p className="description">Dump the tasks, loose ends, and blockers. Structure comes next.</p>
        <label className="field-label" htmlFor="brain-dump">YOUR INPUT</label>
        <textarea id="brain-dump" value={brainDump} onChange={e=>setBrainDump(e.target.value)} maxLength={5000} placeholder="I need to finish my portfolio, fix a login bug, learn React Query, and apply for internships…"/>
        <div className="input-footer"><span>{brainDump.length.toLocaleString()} / 5,000 CHARACTERS</span><button className="text-button" onClick={()=>setBrainDump("Finish my portfolio, fix the login bug, learn React Query, and apply for internships. The login bug blocks deployment.")}>LOAD EXAMPLE ↗</button></div>
        <div className="rule"/>
        <div className="time-heading"><label className="field-label">EXECUTION WINDOW</label><strong>{minutes} <small>MIN</small></strong></div>
        <input className="time-slider" aria-label="Available time in minutes" type="range" min="15" max="240" step="15" value={minutes} onChange={e=>setMinutes(Number(e.target.value))}/>
        <div className="range-labels"><span>15 MIN</span><span>4 HOURS</span></div>
        <div className="time-presets">{[30,60,120,180,240].map(v=><button key={v} className={minutes===v?"preset active":"preset"} onClick={()=>setMinutes(v)}>{v>=60?v/60+"H":v+"M"}</button>)}</div>
        <button className="compile-button" disabled title="AI planning will be enabled in a later milestone"><span className="compile-glyph">⌘</span><span>COMPILE WORKFLOW<small>PLANNING ENGINE NOT CONNECTED YET</small></span><b>↗</b></button>
        <p className="honesty-note"><i>i</i> Interface foundation only. AI plan generation is not enabled in this build.</p>
      </article>
      <article className="panel output-panel">
        <div className="panel-topline"><b>02</b><span>COMPILATION OUTPUT</span><small>FLOW / GRAPH</small></div>
        <div className="output-title"><div><h2>Execution graph</h2><p className="description">Tasks become a sequence, not another list.</p></div><span className="preview-badge">● CONCEPT PREVIEW</span></div>
        <div className="graph-banner"><span className="graph-icon">⌁</span><div><small>WORKFLOW STATUS</small><strong>Awaiting first compilation</strong><p>Illustrative nodes show the intended visual language.</p></div><span className="idle">IDLE</span></div>
        <div className="stats"><div><small>TIME WINDOW</small><strong>{minutes} <i>MIN</i></strong><p>Available focus time</p></div><div><small>ACTION NODES</small><strong>03<sup>*</sup></strong><p>Illustrative only</p></div><div><small>DEPENDENCIES</small><strong>02</strong><p>Example connections</p></div></div>
        <div className="task-graph"><div className="rail" aria-hidden="true"><i/><i/><i/></div>{exampleTasks.map((t,i)=><div className={"task-node node-"+i} key={t[0]}><span className="task-number">{t[0]}</span><div><small>{t[2]}</small><strong>{t[1]}</strong></div><span className={"task-state state-"+i}>{t[3]}</span></div>)}</div>
        <p className="graph-footnote">* Example workflow only — no AI-generated result is displayed.</p>
        <div className="api-card"><div className="api-heading"><i className={"api-dot "+apiState}/><div><small>BACKEND CONNECTIVITY</small><strong>{apiState==="success"?"Connection verified":apiState==="loading"?"Checking connection":apiState==="error"?"Backend not reachable":"Not checked yet"}</strong></div><button onClick={checkApi} disabled={apiState==="loading"}>{apiState==="loading"?"CHECKING…":"CHECK API ↗"}</button></div><p role="status" aria-live="polite">{apiMessage}</p></div>
      </article>
    </section>
    <footer><span><b>FLOW / COMPILER</b> · PHASE 3 UI FOUNDATION</span><span><i/> BUILT FOR FOCUSED WORK <em>/</em> AI PLANNING NOT YET ACTIVE</span></footer>
  </main>;
}