// Tela de abertura (loja e acompanhar pedido): carrega a logo, mostra o efeito e só então abre a página.
window.Splash = (() => {
  const el = () => document.getElementById("splash");
  const fechar = () => { const s = el(); if (!s) return; s.classList.add("saindo"); setTimeout(() => s.remove(), 600); };
  const abrir = async (config) => {
    const s = el();
    if (!s) return;
    const t0 = Date.now();
    const logo = s.querySelector(".sp-logo");
    if (config && config.logoUrl) {
      await new Promise((ok) => { const img = new Image(); img.alt = ""; img.onload = () => { logo.replaceChildren(img); ok(); }; img.onerror = ok; img.src = config.logoUrl; setTimeout(ok, 4000); });
    }
    s.querySelector(".sp-nome").textContent = (config && config.nomeLoja) || "";
    s.classList.add("pronto");
    await new Promise((ok) => setTimeout(ok, Math.max(0, 1100 - (Date.now() - t0))));
  };
  return { abrir, fechar };
})();
