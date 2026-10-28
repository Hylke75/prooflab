export default function Loading() {
  return (
    <main className="main" aria-busy="true">
      <div className="workspace">
        <div className="skeleton" style={{ height: 22, width: 160, marginBottom: 14 }} />
        <div className="skeleton" style={{ height: 46, width: "55%", marginBottom: 24 }} />
        <div className="grid-3">
          <div className="skeleton" style={{ height: 120 }} />
          <div className="skeleton" style={{ height: 120 }} />
          <div className="skeleton" style={{ height: 120 }} />
        </div>
        <div className="skeleton" style={{ height: 260, marginTop: 20 }} />
      </div>
    </main>
  );
}
