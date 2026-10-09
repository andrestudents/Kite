export default function Home() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.75rem",
        textAlign: "center",
        padding: "2rem",
      }}
    >
      <h1>Kite</h1>
      <p>Dukung petani. Bagi hasil. Selesai.</p>
      <p aria-hidden style={{ opacity: 0.6, fontSize: "0.85rem" }}>
        Placeholder — the product arrives with its feature.
      </p>
    </main>
  );
}
