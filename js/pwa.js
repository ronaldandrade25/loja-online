// Registro do service worker e botão "Instalar app"
(function () {
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }

  let evento = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    evento = e;
    const b = document.getElementById("instalar");
    if (b) b.hidden = false;
  });
  document.addEventListener("click", async (e) => {
    if (!e.target.closest("#instalar") || !evento) return;
    evento.prompt();
    await evento.userChoice.catch(() => {});
    evento = null;
    document.getElementById("instalar").hidden = true;
  });
  window.addEventListener("appinstalled", () => {
    const b = document.getElementById("instalar");
    if (b) b.hidden = true;
  });
})();
