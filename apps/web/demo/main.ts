// T024 lands the full prep flow (passkey ceremony + one-time key server
// fetch + vault wrap). This entry exists from T002 so the production build
// input resolves; until wired it is honest about being inert: the page does
// nothing without the laptop's one-time key server (scripts/demo/prep-serve.ts).
const $root = document.getElementById("root");
if ($root) {
  const p = document.createElement("p");
  p.style.color = "#64748b";
  p.textContent =
    "Halaman ini belum aktif. Jalankan scripts/demo/prep-serve.ts di laptop (Demo Tool) dan ikuti petunjuknya.";
  $root.appendChild(p);
}
