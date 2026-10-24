document.addEventListener("DOMContentLoaded", async () => {
  if (!DB.configurado) return;
  const { moeda, esc } = DB;
  const $ = (s) => document.querySelector(s);
  let parar = null;

  DB.config.obter().then((c) => {
    DB.aplicarTema(c);
    $("#logo-nome").textContent = c.nomeLoja;
    document.title = "Acompanhar pedido — " + c.nomeLoja;
    if (c.logoUrl) { const img = new Image(); img.className = "logo-img"; img.alt = ""; img.src = c.logoUrl; const ico = document.querySelector(".logo > i, .logo > span:first-child"); if (ico) ico.replaceWith(img); }
  }).catch(() => {});

  const etapas = (tipo) => [
    ["novo", "Pedido recebido", "Aguardando confirmação da loja"],
    ["confirmado", "Pedido confirmado", "Estamos preparando seu pedido"],
    ["enviado", tipo === "entrega" ? "Saiu para entrega" : "Pronto para retirada", tipo === "entrega" ? "Seu pedido está a caminho" : "Pode vir buscar na loja"],
    ["entregue", tipo === "entrega" ? "Entregue" : "Retirado", "Pedido finalizado. Obrigado!"],
  ];
  const dataBR = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "");

  const render = (p) => {
    if (!p) {
      $("#msg").textContent = "Pedido não encontrado. Confira o código.";
      $("#resultado").innerHTML = "";
      return;
    }
    $("#msg").textContent = "";
    const lista = etapas(p.tipo);
    const idx = lista.findIndex(([k]) => k === p.status);
    $("#resultado").innerHTML = `
      <div class="caixa">
        <h3>Pedido #${esc(p.codigo)}${p.nome ? " — " + esc(p.nome) : ""}</h3>
        ${p.status === "cancelado"
          ? `<p class="cancelado-box"><i class="fa-solid fa-circle-xmark"></i> Pedido cancelado. Entre em contato com a loja em caso de dúvidas.</p>`
          : `<ol class="linha-tempo">${lista.map(([, titulo, desc], i) => `
              <li class="${i <= idx ? "feito" : ""} ${i === idx ? "atual" : ""}">
                <span class="bolinha">${i <= idx ? '<i class="fa-solid fa-check"></i>' : ""}</span>
                <strong>${titulo}</strong>${i === idx ? `<small>${desc}${p.atualizadoEm ? " · " + dataBR(p.atualizadoEm) : ""}</small>` : ""}
              </li>`).join("")}</ol>`}
      </div>
      <div class="caixa">
        <h3>Itens</h3>
        <ul>${(p.itens || []).map((i) => `<li><span>${i.qtd}x ${esc(i.nome)}</span></li>`).join("")}
          <li><strong>Total</strong><strong>${moeda(p.total)}</strong></li></ul>
        <p style="margin-top:10px;font-size:.85rem;color:var(--suave)">Feito em ${dataBR(p.criadoEm)}</p>
      </div>
      <button class="btn-sec no-print" onclick="window.print()" style="justify-self:start"><i class="fa-solid fa-print"></i> Imprimir / salvar PDF</button>`;
  };

  const consultar = (codigo) => {
    if (parar) parar();
    $("#resultado").innerHTML = "";
    $("#msg").textContent = "";
    // atualiza em tempo real quando a loja muda o status
    parar = DB.acompanhar(codigo, render, () => { $("#msg").textContent = "Não foi possível consultar agora. Tente novamente."; });
    history.replaceState(null, "", "?c=" + codigo);
  };

  $("#busca-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const c = $("#codigo").value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (c.length < 6) return ($("#msg").textContent = "Informe o código completo do pedido.");
    consultar(c);
  });

  let inicial = (new URLSearchParams(location.search).get("c") || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!inicial) { try { inicial = localStorage.getItem("lo_ultimo_pedido") || ""; } catch { /* ignorado */ } }
  if (inicial) { $("#codigo").value = inicial; consultar(inicial); }
});
