"use client";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="main">
      <div className="workspace">
        <div className="empty-state" role="alert">
          <h3>Er ging iets mis.</h3>
          <p>{error.message.includes("leesrechten") ? error.message : "Je werk is niet verloren. Probeer het opnieuw; blijft het misgaan, laad de pagina dan opnieuw."}</p>
          <button className="btn primary" onClick={reset}>Opnieuw proberen</button>
        </div>
      </div>
    </main>
  );
}
