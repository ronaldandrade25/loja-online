// Impressora térmica (Bluetooth BLE ou porta serial) e avisos de novos pedidos do site.
// - Impressão: comandos ESC/POS enviados direto pelo navegador (Web Bluetooth / Web Serial).
// - Avisos: escuta os pedidos "novo" em tempo real enquanto o painel está aberto.
window.Admin.modulos.push((A) => {
  const { $, toast } = A;
  const { moeda, esc } = DB;

  // ============================================================
  // Impressora
  // ============================================================
  // Serviços BLE mais comuns em impressoras térmicas (a lista precisa ser declarada para o navegador permitir o acesso)
  const SERVICOS_BLE = [
    "000018f0-0000-1000-8000-00805f9b34fb", "0000ffe0-0000-1000-8000-00805f9b34fb", "0000ff00-0000-1000-8000-00805f9b34fb",
    "49535343-fe7d-4ae5-8fa9-9fafd205e455", "e7810a71-73ae-499d-8c15-faa9aef0c3f2", "0000fee7-0000-1000-8000-00805f9b34fb",
    "0000ae30-0000-1000-8000-00805f9b34fb", "0000fff0-0000-1000-8000-00805f9b34fb", "00001101-0000-1000-8000-00805f9b34fb",
  ];
  let conexao = null; // { tipo: "ble" | "serial", nome, aberta(), escrever(bytes), fechar(), reabrir() }
  const ouvintes = new Set();
  const mudou = () => ouvintes.forEach((f) => { try { f(); } catch { /* ignorado */ } });
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  const lembrar = (tipo, nome) => { try { localStorage.setItem("lo_impressora", tipo || ""); localStorage.setItem("lo_impressora_nome", nome || ""); } catch { /* ignorado */ } };

  // Texto simples: impressoras térmicas variam de página de código, então usamos só ASCII (sem acentos)
  const semAcento = (s) => String(s ?? "")
    .replace(/ /g, " ").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, "-").replace(/[^\x20-\x7e\n]/g, "?");
  const quebrar = (texto, n) => {
    const saida = [];
    String(semAcento(texto)).split("\n").forEach((par) => {
      let atual = "";
      par.split(" ").forEach((palavra) => {
        while (palavra.length > n) { if (atual) { saida.push(atual); atual = ""; } saida.push(palavra.slice(0, n)); palavra = palavra.slice(n); }
        if (!atual) atual = palavra;
        else if ((atual + " " + palavra).length <= n) atual += " " + palavra;
        else { saida.push(atual); atual = palavra; }
      });
      saida.push(atual);
    });
    return saida;
  };

  const novoTicket = (colunas) => {
    const b = [];
    const raw = (s) => { for (const ch of s) b.push(ch.charCodeAt(0)); b.push(0x0a); };
    const t = {
      iniciar() { b.push(0x1b, 0x40); return t; },                       // ESC @  (reinicia)
      alinhar(n) { b.push(0x1b, 0x61, n); return t; },                    // 0 esquerda, 1 centro, 2 direita
      negrito(on) { b.push(0x1b, 0x45, on ? 1 : 0); return t; },          // ESC E
      dobro(on) { b.push(0x1d, 0x21, on ? 0x11 : 0x00); return t; },      // GS ! (largura e altura dobradas)
      linha(s = "") { quebrar(s, colunas).forEach(raw); return t; },
      titulo(s) { t.dobro(true); quebrar(s, Math.max(8, Math.floor(colunas / 2))).forEach(raw); t.dobro(false); return t; },
      separador(c = "-") { raw(c.repeat(colunas)); return t; },
      duas(esq, dir) {
        const d = semAcento(dir), partes = quebrar(esq, Math.max(8, colunas - d.length - 1));
        partes.forEach((p, i) => raw(i === partes.length - 1 ? p.padEnd(Math.max(p.length, colunas - d.length)) + d : p));
        return t;
      },
      cortar() { b.push(0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x42, 0x00); return t; }, // avança o papel e corta
      bytes() { return Uint8Array.from(b); },
    };
    return t;
  };

  const dataHora = (iso) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  const rotuloPagto = (p) => p.forma + (p.parcelas > 1 ? ` ${p.parcelas}x` : "");
  const nomeItem = (i) => `${i.nome}${i.variante ? ` (${i.variante})` : ""}`;
  const larguraAtual = () => (Number((A.config || {}).impressoraLargura) === 48 ? 48 : 32);

  const ticketVenda = (v, cfg) => {
    const t = novoTicket(larguraAtual()).iniciar().alinhar(1).negrito(true).linha(cfg.nomeLoja).negrito(false);
    if (cfg.endereco) t.linha(cfg.endereco);
    t.separador("=").alinhar(0).negrito(true).linha(`VENDA No ${v.numero}${v.status === "cancelada" ? " (CANCELADA)" : ""}`).negrito(false).linha(dataHora(v.criadoEm));
    if (v.cliente) t.linha(`Cliente: ${v.cliente}`);
    t.separador();
    v.itens.forEach((i) => t.duas(`${i.qtd}x ${nomeItem(i)}`, moeda(i.preco * i.qtd)));
    t.separador().duas("Subtotal", moeda(v.subtotal));
    if (v.desconto) t.duas("Desconto", "- " + moeda(v.desconto));
    t.negrito(true).duas("TOTAL", moeda(v.total)).negrito(false);
    v.pagamentos.forEach((p) => {
      t.duas(rotuloPagto(p), moeda(p.valor));
      (p.parcelasLista || []).forEach((pc) => t.duas(`  ${pc.n}/${p.parcelas} venc. ${pc.venc.split("-").reverse().join("/")}`, moeda(pc.valor)));
    });
    if (v.troco) t.duas("Troco", moeda(v.troco));
    return t.separador().alinhar(1).linha("Obrigado pela preferencia!").cortar().bytes();
  };

  const ticketPedido = (p, cfg) => {
    const t = novoTicket(larguraAtual()).iniciar().alinhar(1).negrito(true).linha(cfg.nomeLoja).negrito(false).linha("PEDIDO PELO SITE").separador("=");
    t.titulo(p.tipo === "entrega" ? "ENTREGA" : "RETIRADA").alinhar(0).negrito(true).linha(`Codigo: ${p.codigo}`).negrito(false).linha(dataHora(p.criadoEm)).separador();
    t.linha(`Cliente: ${p.cliente.nome}`).linha(`Fone: ${p.cliente.telefone}`);
    if (p.cliente.email) t.linha(`E-mail: ${p.cliente.email}`);
    if (p.cliente.cpf) t.linha(`CPF/CNPJ: ${p.cliente.cpf}`);
    if (p.tipo === "entrega") { t.linha(`Endereco: ${p.endereco}`); if (p.regiao) t.linha(`Regiao: ${p.regiao}`); }
    else t.linha(`Retirada: ${(p.retirada || "").split(" ").map((x, i) => (i === 0 ? x.split("-").reverse().join("/") : x)).join(" as ")}`);
    t.separador();
    p.itens.forEach((i) => t.duas(`${i.qtd}x ${nomeItem(i)}`, moeda(i.preco * i.qtd)));
    t.separador().duas("Subtotal", moeda(p.subtotal));
    if (p.desconto) t.duas(`Desconto${p.cupom ? " " + p.cupom : ""}`, "- " + moeda(p.desconto));
    t.duas("Frete", p.frete ? moeda(p.frete) : p.tipo === "entrega" ? "Gratis" : "-");
    t.negrito(true).duas("TOTAL", moeda(p.total)).negrito(false);
    t.linha(`Pagamento: ${p.pagamento}${p.troco ? ` (troco p/ ${moeda(p.troco)})` : ""}`);
    if (p.obs) t.separador().linha(`Obs: ${p.obs}`);
    return t.separador().cortar().bytes();
  };

  // ---- conexões ----
  const abrirBle = async (dispositivo) => {
    const servidor = await dispositivo.gatt.connect();
    let caracteristica = null;
    for (const s of await servidor.getPrimaryServices()) {
      const cs = await s.getCharacteristics();
      caracteristica = cs.find((c) => c.properties.write || c.properties.writeWithoutResponse);
      if (caracteristica) break;
    }
    if (!caracteristica) {
      try { servidor.disconnect(); } catch { /* ignorado */ }
      throw new Error("Não encontrei a porta de impressão neste aparelho. Se for uma impressora Bluetooth clássica, use o botão de porta serial.");
    }
    return caracteristica;
  };
  const criarConexaoBle = async (dispositivo) => {
    let caracteristica = await abrirBle(dispositivo);
    const c = {
      tipo: "ble", nome: dispositivo.name || "Impressora Bluetooth",
      aberta: () => !!(dispositivo.gatt && dispositivo.gatt.connected),
      async reabrir() { caracteristica = await abrirBle(dispositivo); },
      async escrever(bytes) {
        const semResposta = !caracteristica.properties.write && caracteristica.properties.writeWithoutResponse;
        for (let i = 0; i < bytes.length; i += 20) { // 20 bytes: tamanho aceito por qualquer impressora BLE
          const parte = bytes.slice(i, i + 20);
          if (semResposta) { await (caracteristica.writeValueWithoutResponse || caracteristica.writeValue).call(caracteristica, parte); await espera(20); }
          else await caracteristica.writeValue(parte);
        }
      },
      async fechar() { try { dispositivo.gatt.disconnect(); } catch { /* ignorado */ } },
    };
    dispositivo.addEventListener("gattserverdisconnected", () => mudou());
    return c;
  };
  const criarConexaoSerial = async (porta) => {
    if (!porta.readable && !porta.writable) await porta.open({ baudRate: 9600 });
    const info = (porta.getInfo && porta.getInfo()) || {};
    return {
      tipo: "serial", nome: info.usbVendorId ? `Porta serial (USB ${info.usbVendorId.toString(16)})` : "Porta serial / Bluetooth pareado",
      aberta: () => !!porta.writable,
      async reabrir() { if (!porta.writable) await porta.open({ baudRate: 9600 }); },
      async escrever(bytes) {
        const w = porta.writable.getWriter();
        try { await w.write(bytes); } finally { w.releaseLock(); }
      },
      async fechar() { try { await porta.close(); } catch { /* ignorado */ } },
    };
  };

  const suporte = () => ({ ble: !!navigator.bluetooth, serial: !!navigator.serial });
  const impressora = {
    suporte,
    conectada: () => !!(conexao && conexao.aberta()),
    nome: () => (conexao ? conexao.nome : ""),
    tipo: () => (conexao ? conexao.tipo : ""),
    aoMudar: (f) => { ouvintes.add(f); return () => ouvintes.delete(f); },
    async conectarBle() {
      if (!navigator.bluetooth) throw new Error("Este navegador não suporta Bluetooth. Use o Chrome ou o Edge (no iPhone não é possível).");
      const dispositivo = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: SERVICOS_BLE });
      conexao = await criarConexaoBle(dispositivo);
      lembrar("ble", conexao.nome); mudou();
    },
    async conectarSerial() {
      if (!navigator.serial) throw new Error("Este navegador não suporta porta serial. Use o Chrome ou o Edge no computador.");
      const porta = await navigator.serial.requestPort();
      conexao = await criarConexaoSerial(porta);
      lembrar("serial", conexao.nome); mudou();
    },
    async desconectar() { if (conexao) await conexao.fechar(); conexao = null; lembrar("", ""); mudou(); },
    async imprimir(bytes) {
      if (!conexao) throw new Error("Impressora não conectada. Conecte em Configurações.");
      if (!conexao.aberta()) await conexao.reabrir();
      await conexao.escrever(bytes);
    },
    async cfg() { return A.config || (A.config = await DB.config.obter()); },
    async cupomVenda(v) { return impressora.imprimir(ticketVenda(v, await impressora.cfg())); },
    async pedidoSite(p) { return impressora.imprimir(ticketPedido(p, await impressora.cfg())); },
    async testar() {
      const cfg = await impressora.cfg();
      const t = novoTicket(larguraAtual()).iniciar().alinhar(1).negrito(true).linha(cfg.nomeLoja).negrito(false).linha("TESTE DE IMPRESSAO").separador()
        .alinhar(0).linha("Se voce esta lendo isto, a impressora esta funcionando.").linha(`Largura: ${larguraAtual()} colunas`).linha(dataHora(new Date().toISOString())).separador().cortar();
      return impressora.imprimir(t.bytes());
    },
    // texto exposto para testes
    _ticketVenda: ticketVenda, _ticketPedido: ticketPedido,
  };
  A.impressora = impressora;

  // Reconecta sozinho à última impressora (porta serial já autorizada; BLE quando o navegador permitir)
  const reconectar = async () => {
    let tipo = "";
    try { tipo = localStorage.getItem("lo_impressora") || ""; } catch { /* ignorado */ }
    if (!tipo || impressora.conectada()) return;
    try {
      if (tipo === "serial" && navigator.serial && navigator.serial.getPorts) {
        const portas = await navigator.serial.getPorts();
        if (portas.length) { conexao = await criarConexaoSerial(portas[0]); mudou(); }
      } else if (tipo === "ble" && navigator.bluetooth && navigator.bluetooth.getDevices) {
        const nome = localStorage.getItem("lo_impressora_nome");
        const d = (await navigator.bluetooth.getDevices()).find((x) => !nome || x.name === nome);
        if (d) { conexao = await criarConexaoBle(d); mudou(); }
      }
    } catch { /* sem permissão ou impressora desligada: o usuário reconecta pela tela de Configurações */ }
  };

  // ============================================================
  // Avisos de novo pedido do site
  // ============================================================
  const area = document.createElement("div");
  area.id = "avisos-pedido"; area.className = "avisos-pedido"; area.setAttribute("aria-live", "assertive");
  document.body.appendChild(area);
  const titulo0 = document.title;
  let naoVistos = 0, pararEscuta = null, primeiraLeitura = true;
  const vistos = new Set();

  const bip = () => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      [[880, 0], [660, 0.22], [880, 0.44]].forEach(([f, at]) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = f; o.type = "sine"; o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0.0001, ctx.currentTime + at);
        g.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + at + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.18);
        o.start(ctx.currentTime + at); o.stop(ctx.currentTime + at + 0.2);
      });
      setTimeout(() => ctx.close && ctx.close(), 900);
    } catch { /* navegador bloqueou o som */ }
  };
  const restaurarTitulo = () => { naoVistos = 0; document.title = titulo0; };
  document.addEventListener("visibilitychange", () => { if (!document.hidden) restaurarTitulo(); });
  window.addEventListener("focus", restaurarTitulo);

  const mostrarBanner = (p) => {
    const el = document.createElement("div");
    el.className = "aviso-pedido";
    el.innerHTML = `
      <i class="fa-solid fa-bell"></i>
      <div class="ap-texto"><strong>Novo pedido pelo site!</strong>
        <span>#${esc(p.codigo)} · ${esc(p.cliente.nome)} · ${p.tipo === "entrega" ? "Entrega" : "Retirada"} · <b>${moeda(p.total)}</b></span></div>
      <div class="ap-acoes"><button type="button" class="btn peq" data-ap="ver">Ver pedido</button>
        <button type="button" class="btn sec peq" data-ap="imprimir"><i class="fa-solid fa-print"></i></button>
        <button type="button" class="ap-fechar" data-ap="fechar" aria-label="Fechar aviso">&times;</button></div>`;
    el.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-ap]");
      if (!b) return;
      if (b.dataset.ap === "ver") { el.remove(); await A.abrirTab("pedidos"); if (A.verPedido) A.verPedido(p.id); }
      if (b.dataset.ap === "imprimir") {
        if (!impressora.conectada()) return toast("Conecte a impressora em Configurações para imprimir.");
        try { await impressora.pedidoSite(p); toast("Pedido enviado para a impressora"); } catch (err) { toast("Não foi possível imprimir: " + (err.message || "erro")); }
      }
      if (b.dataset.ap === "fechar") el.remove();
    });
    area.prepend(el);
    while (area.children.length > 4) area.lastChild.remove(); // no máximo 4 avisos empilhados
  };

  const novoPedido = async (p, opcoes = {}) => {
    const cfg = A.config || {};
    if (cfg.avisoPedidoSite !== false) {
      mostrarBanner(p);
      if (cfg.avisoSom !== false) bip();
      naoVistos++;
      if (document.hidden) document.title = `🔔 (${naoVistos}) Novo pedido! — ${titulo0}`;
      if ("Notification" in window && Notification.permission === "granted" && document.hidden) {
        try {
          const n = new Notification("Novo pedido pelo site", { body: `#${p.codigo} · ${p.cliente.nome} · ${moeda(p.total)}`, tag: "pedido-" + p.id, requireInteraction: true });
          n.onclick = () => { window.focus(); A.abrirTab("pedidos"); if (A.verPedido) A.verPedido(p.id); n.close(); };
        } catch { /* ignorado */ }
      }
    }
    if (cfg.impressaoAutoSite && !opcoes.teste) {
      if (!impressora.conectada()) toast("Impressão automática ligada, mas a impressora não está conectada.");
      else { try { await impressora.pedidoSite(p); } catch (err) { toast("Não foi possível imprimir o pedido: " + (err.message || "erro")); } }
    }
  };

  const iniciarEscuta = () => {
    if (pararEscuta) return;
    primeiraLeitura = true;
    pararEscuta = DB.fs.collection("pedidos").where("status", "==", "novo").onSnapshot((snap) => {
      if (primeiraLeitura) {
        primeiraLeitura = false;
        snap.docs.forEach((d) => vistos.add(d.id));
        if (snap.size && (A.config || {}).avisoPedidoSite !== false) toast(`Você tem ${snap.size} pedido(s) novo(s) aguardando`);
        return;
      }
      snap.docChanges().forEach((ch) => {
        if (ch.type !== "added" || vistos.has(ch.doc.id)) return;
        vistos.add(ch.doc.id);
        novoPedido({ ...ch.doc.data(), id: ch.doc.id });
      });
      A.atualizarPill();
      if (A.sincronizarClientes) A.sincronizarClientes();
      if (!$("#tab-pedidos").hidden) A.abrirTab("pedidos"); // lista aberta: atualiza na hora
    }, (err) => console.error("escuta de pedidos:", err));
  };

  // ligações com o restante do painel
  A.aoEntrar = async () => {
    try { A.config = await DB.config.obter(); } catch { A.config = {}; }
    reconectar();
    iniciarEscuta();
  };
  A.aoSair = () => { if (pararEscuta) { pararEscuta(); pararEscuta = null; } vistos.clear(); area.innerHTML = ""; restaurarTitulo(); };
  A.configMudou = (c) => { A.config = { ...(A.config || {}), ...c }; };
  A.avisoTeste = () => novoPedido({
    id: "teste", codigo: "TESTE123", criadoEm: new Date().toISOString(), tipo: "entrega", cliente: { nome: "Cliente de teste", telefone: "(00) 00000-0000" },
    endereco: "Rua de exemplo, 123", regiao: "Centro", itens: [{ nome: "Produto de exemplo", qtd: 1, preco: 10 }], subtotal: 10, desconto: 0, frete: 0, total: 10, pagamento: "PIX",
  }, { teste: true });
});
