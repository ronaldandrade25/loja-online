// Leitor de código de barras / SKU pela câmera do celular ou do computador.
// Usa o BarcodeDetector do navegador (Chrome/Edge/Android) e, onde ele não existe (Safari, Firefox),
// carrega a biblioteca ZXing sob demanda. A câmera só funciona em endereço seguro (https ou localhost).
window.Admin.modulos.push((A) => {
  const { toast } = A;
  const { esc } = DB;
  const ZXING_URL = "https://cdn.jsdelivr.net/npm/@zxing/library@0.20.0/umd/index.min.js";
  const FORMATOS_NATIVOS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "code_93", "codabar", "itf", "qr_code", "data_matrix"];
  let carregandoZxing = null, aberto = null;

  const carregarZxing = () => {
    if (window.ZXing) return Promise.resolve();
    if (!carregandoZxing) {
      carregandoZxing = new Promise((ok, falhou) => {
        const s = document.createElement("script");
        s.src = ZXING_URL; s.onload = ok;
        s.onerror = () => { carregandoZxing = null; falhou(new Error("Não foi possível carregar o leitor de código de barras (verifique a internet).")); };
        document.head.appendChild(s);
      });
    }
    return carregandoZxing;
  };
  const seguro = () => window.isSecureContext !== false || ["localhost", "127.0.0.1"].includes(location.hostname);
  const suportado = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

  const bip = () => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx(), o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "square"; o.frequency.value = 1500; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.15, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
      o.start(); o.stop(ctx.currentTime + 0.13);
      setTimeout(() => ctx.close && ctx.close(), 400);
    } catch { /* navegador bloqueou o som */ }
  };

  // opcoes: { titulo, aoLer(codigo) → { manter, ok, erro, acao: { texto, fn } } (pode ser async) }
  const abrir = (opcoes = {}) => {
    if (aberto) return;
    const raiz = document.createElement("div");
    raiz.className = "scanner"; raiz.setAttribute("role", "dialog"); raiz.setAttribute("aria-modal", "true"); raiz.setAttribute("aria-label", "Leitor de código de barras");
    raiz.innerHTML = `
      <div class="sc-topo"><b>${esc(opcoes.titulo || "Ler código de barras")}</b><button type="button" class="sc-fechar" data-sc="fechar" aria-label="Fechar leitor">&times;</button></div>
      <div class="sc-video"><video playsinline muted autoplay></video><div class="sc-mira" aria-hidden="true"><span></span></div></div>
      <div class="sc-msg" aria-live="polite"><span class="sc-texto">Iniciando a câmera...</span><button type="button" class="link-btn" data-sc="acao" hidden></button></div>
      <div class="sc-acoes"><button type="button" class="btn sec" data-sc="lanterna" hidden><i class="fa-solid fa-lightbulb"></i> Lanterna</button></div>
      <form class="sc-manual" autocomplete="off"><input name="codigo" placeholder="ou digite o código / SKU" aria-label="Digitar código" /><button class="btn">OK</button></form>`;
    document.body.appendChild(raiz);
    document.body.classList.add("no-scroll");

    const q = (s) => raiz.querySelector(s);
    const video = q("video"), texto = q(".sc-texto"), botaoAcao = q('[data-sc="acao"]');
    let stream = null, leitorZxing = null, timer = null, ocupado = false, ultimo = { codigo: "", em: 0 }, acaoAtual = null, faixa = null, lanterna = false, fechado = false;

    const mensagem = (txt, tipo = "") => { texto.textContent = txt; texto.className = "sc-texto " + tipo; botaoAcao.hidden = true; acaoAtual = null; };
    const fechar = () => {
      if (fechado) return;
      fechado = true;
      clearInterval(timer);
      try { if (leitorZxing) leitorZxing.reset(); } catch { /* ignorado */ }
      try { (stream || video.srcObject)?.getTracks().forEach((t) => t.stop()); } catch { /* ignorado */ }
      document.removeEventListener("keydown", aoTeclar, true);
      raiz.remove();
      document.body.classList.remove("no-scroll");
      aberto = null;
    };
    const aoTeclar = (e) => { if (e.key === "Escape") { e.stopPropagation(); fechar(); } };
    document.addEventListener("keydown", aoTeclar, true);

    // trata um código lido (câmera ou digitado)
    const tratar = async (codigo, manual = false) => {
      codigo = String(codigo || "").trim();
      if (!codigo || fechado) return;
      const agora = Date.now();
      if (!manual && codigo === ultimo.codigo && agora - ultimo.em < 1800) return; // evita ler o mesmo item várias vezes seguidas
      ultimo = { codigo, em: agora };
      if (ocupado) return;
      ocupado = true;
      let r = {};
      try { r = (await opcoes.aoLer(codigo)) || {}; } catch (e) { console.error(e); r = { manter: true, erro: "Não foi possível processar o código." }; }
      ocupado = false;
      if (fechado) return;
      if (r.erro) mensagem(r.erro, "erro"); else { bip(); try { navigator.vibrate && navigator.vibrate(60); } catch { /* ignorado */ } mensagem(r.ok || `Código ${codigo} lido`, "ok"); }
      if (r.acao) { botaoAcao.textContent = r.acao.texto; botaoAcao.hidden = false; acaoAtual = r.acao; }
      if (r.manter === false) setTimeout(fechar, r.erro ? 0 : 350);
    };

    raiz.addEventListener("click", (e) => {
      const b = e.target.closest("[data-sc]");
      if (!b) return;
      if (b.dataset.sc === "fechar") fechar();
      if (b.dataset.sc === "acao" && acaoAtual) { const fn = acaoAtual.fn; fechar(); fn(); }
      if (b.dataset.sc === "lanterna" && faixa) {
        lanterna = !lanterna;
        faixa.applyConstraints({ advanced: [{ torch: lanterna }] }).catch(() => { lanterna = false; toast("Esta câmera não permite acender a lanterna"); });
      }
    });
    q(".sc-manual").addEventListener("submit", (e) => { e.preventDefault(); const i = e.target.elements.codigo; tratar(i.value, true); i.value = ""; });

    const falha = (e) => {
      const nome = e && e.name;
      mensagem(nome === "NotAllowedError" || nome === "SecurityError" ? "Permissão da câmera negada. Libere o acesso à câmera nas configurações do navegador."
        : nome === "NotFoundError" || nome === "OverconstrainedError" ? "Nenhuma câmera encontrada neste aparelho."
        : (e && e.message) || "Não foi possível abrir a câmera.", "erro");
      q(".sc-manual input").focus();
    };

    const iniciar = async () => {
      if (!seguro()) return falha(new Error("A câmera só funciona em endereço seguro (https ou localhost)."));
      if (!suportado()) return falha(new Error("Este navegador não permite usar a câmera. Digite o código abaixo."));
      try {
        if (window.BarcodeDetector) {
          const suportados = (BarcodeDetector.getSupportedFormats ? await BarcodeDetector.getSupportedFormats() : FORMATOS_NATIVOS);
          const detector = new BarcodeDetector({ formats: FORMATOS_NATIVOS.filter((f) => !suportados.length || suportados.includes(f)) });
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
          if (fechado) { stream.getTracks().forEach((t) => t.stop()); return; }
          video.srcObject = stream; await video.play();
          faixa = stream.getVideoTracks()[0];
          try { if (faixa.getCapabilities && faixa.getCapabilities().torch) q('[data-sc="lanterna"]').hidden = false; } catch { /* ignorado */ }
          mensagem("Aponte a câmera para o código de barras");
          timer = setInterval(async () => {
            if (ocupado || video.readyState < 2) return;
            try { const achados = await detector.detect(video); if (achados.length) tratar(achados[0].rawValue); } catch { /* quadro sem código */ }
          }, 180);
        } else {
          await carregarZxing();
          if (fechado) return;
          const Z = window.ZXing, dicas = new Map();
          dicas.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E, Z.BarcodeFormat.CODE_128, Z.BarcodeFormat.CODE_39, Z.BarcodeFormat.ITF, Z.BarcodeFormat.QR_CODE]);
          dicas.set(Z.DecodeHintType.TRY_HARDER, true);
          leitorZxing = new Z.BrowserMultiFormatReader(dicas);
          mensagem("Aponte a câmera para o código de barras");
          await leitorZxing.decodeFromConstraints({ video: { facingMode: { ideal: "environment" } }, audio: false }, video, (res) => { if (res) tratar(res.getText()); });
        }
      } catch (e) { falha(e); }
    };
    aberto = { fechar, tratar }; // exposto para testes
    iniciar();
  };

  A.scanner = { abrir, suportado, _atual: () => aberto };
});
