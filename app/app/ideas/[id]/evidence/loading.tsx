// Laadstatus voor Bewijs & besluit: de inhoud en het coachpaneel laden samen, dus beide kolommen tonen tot dan
// een skelet. Zo verschijnt het coachpaneel niet los van (of eerder dan) de inhoud.
export default function EvidenceLoading() {
  return (
    <>
      <main className="main" aria-busy="true">
        <div className="workspace">
          <p className="sr-only" role="status">
            Bewijs en besluit worden geladen…
          </p>
          <div className="skeleton" style={{ height: 40, width: "70%", marginBottom: 18 }} />
          <div className="skeleton" style={{ height: 44, width: "60%", marginBottom: 28 }} />
          <div className="skeleton" style={{ height: 18, width: 180, marginBottom: 14 }} />
          <div className="skeleton" style={{ height: 46, width: "50%", marginBottom: 24 }} />
          <div className="skeleton" style={{ height: 110, marginBottom: 20 }} />
          <div className="grid-2">
            <div className="skeleton" style={{ height: 280 }} />
            <div className="skeleton" style={{ height: 280 }} />
          </div>
        </div>
      </main>
      <aside className="coach" aria-hidden="true">
        <div className="skeleton" style={{ height: 44, width: 180, marginBottom: 32 }} />
        <div className="skeleton" style={{ height: 14, width: 110, marginBottom: 12 }} />
        <div className="skeleton" style={{ height: 56, marginBottom: 14 }} />
        <div className="skeleton" style={{ height: 120, marginBottom: 20 }} />
        <div className="skeleton" style={{ height: 48, marginBottom: 8 }} />
        <div className="skeleton" style={{ height: 48 }} />
      </aside>
    </>
  );
}
