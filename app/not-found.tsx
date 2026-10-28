import Link from "next/link";

export default function NotFound() {
  return (
    <div className="tp">
      <main className="tp-main">
        <div className="tp-card">
          <div className="eyebrow">404</div>
          <h1 style={{ fontSize: 38 }}>Deze pagina bestaat niet.</h1>
          <p>Of je hebt er geen toegang toe.</p>
          <Link className="btn primary" href="/app">Naar het overzicht</Link>
        </div>
      </main>
    </div>
  );
}
