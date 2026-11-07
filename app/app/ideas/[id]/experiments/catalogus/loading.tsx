// Laadstatus van de experimentencatalogus: zoekbalk, filters en kaarten als skelet; het coachpaneel laadt mee.
export default function CatalogLoading() {
  return (
    <>
      <main className="main" aria-busy="true">
        <div className="workspace">
          <p className="sr-only" role="status">
            De experimentencatalogus wordt geladen…
          </p>
          <div className="skeleton" style={{ height: 40, width: "60%", marginBottom: 18 }} />
          <div className="skeleton" style={{ height: 44, width: "70%", marginBottom: 28 }} />
          <div className="skeleton" style={{ height: 170, marginBottom: 24 }} />
          <div className="grid-3">
            <div className="skeleton" style={{ height: 180 }} />
            <div className="skeleton" style={{ height: 180 }} />
            <div className="skeleton" style={{ height: 180 }} />
          </div>
        </div>
      </main>
      <aside className="coach" aria-hidden="true">
        <div className="skeleton" style={{ height: 44, width: 180, marginBottom: 32 }} />
        <div className="skeleton" style={{ height: 56, marginBottom: 14 }} />
        <div className="skeleton" style={{ height: 120 }} />
      </aside>
    </>
  );
}
