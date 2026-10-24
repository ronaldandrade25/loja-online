// PDV (frente de caixa): venda, vendas do dia e controle de caixa.
window.Admin.modulos.push((A) => {
  const { $, toast, tentar, abrirModal, fecharModal, carregando, dataBR } = A;
  const { moeda, esc } = DB;

  const FORMAS = ["Dinheiro", "PIX", "Cartão de Débito", "Cartão de Crédito", "A prazo"];
  const ICONE = { Dinheiro: "fa-money-bill-wave", PIX: "fa-qrcode", "Cartão de Débito": "fa-credit-card", "Cartão de Crédito": "fa-credit-card", "A prazo": "fa-calendar-days", Fiado: "fa-calendar-days" };

  let sub = "venda"; // venda | vendas | caixa
  let caixa = null, produtos = [], categorias = [];
  let cart = [];     // { id, vid, nome, variante, preco, custo, qtd }
  let desconto = { tipo: "valor", valor: 0 };
  let cliente = "", clienteId = "", clientes = [];
  let formaRapida = ""; // forma de pagamento escolhida na tela da venda (antes de abrir o recebimento)
  let catAtiva = "all", termo = "";
  let diaVendas = "";

  const pad = (n) => String(n).padStart(2, "0");
  const isoDia = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const arred = (v) => Math.round(v * 100) / 100;
  const temVariantes = (p) => Array.isArray(p.variantes) && p.variantes.length > 0;
  const estoqueDe = (p, vid) => (temVariantes(p) ? (p.variantes.find((v) => v.id === vid)?.estoque ?? 0) : p.estoque);
  const chave = (i) => i.id + "|" + i.vid;
  const nomeItem = A.nomeItem;

  // ---------- Cálculos da venda ----------
  const totais = () => {
    const subtotal = arred(cart.reduce((s, i) => s + i.preco * i.qtd, 0));
    const bruto = desconto.tipo === "percentual" ? subtotal * (desconto.valor || 0) / 100 : desconto.valor || 0;
    const desc = arred(Math.min(subtotal, Math.max(0, bruto)));
    return { subtotal, desconto: desc, total: arred(subtotal - desc) };
  };

  // ---------- Estrutura da tela ----------
  const carregarCaixa = async () => {
    const snap = await DB.fs.collection("caixas").where("status", "==", "aberto").limit(1).get();
    caixa = snap.empty ? null : { ...snap.docs[0].data(), id: snap.docs[0].id };
  };

  A.telas.pdv = async () => {
    carregando("pdv");
    [produtos, categorias, clientes] = await Promise.all([DB.produtos.listar(), DB.categorias.listar(), DB.clientes.listar()]);
    await carregarCaixa();
    desenharBase();
  };

  const desenharBase = () => {
    $("#tab-pdv").innerHTML = `
      <div class="cab"><h1>PDV</h1>
        <div class="seg" id="pdv-sub">
          ${[["venda", "Venda"], ["vendas", "Vendas"], ["caixa", "Caixa"]].map(([k, n]) => `<button type="button" data-sub="${k}" class="${k === sub ? "ativo" : ""}">${n}</button>`).join("")}
        </div>
      </div>
      <div id="pdv-corpo"></div>`;
    $("#pdv-sub").onclick = (e) => {
      const b = e.target.closest("[data-sub]");
      if (!b) return;
      sub = b.dataset.sub;
      document.querySelectorAll("#pdv-sub button").forEach((x) => x.classList.toggle("ativo", x === b));
      desenharSub();
    };
    desenharSub();
  };
  const desenharSub = () => ({ venda: telaVenda, vendas: telaVendas, caixa: telaCaixa })[sub]();

  // ---------- Sub-aba: Venda ----------
  const telaVenda = () => {
    if (!caixa) {
      $("#pdv-corpo").innerHTML = `
        <div class="painel" style="max-width:460px">
          <h3 style="margin-bottom:6px">Caixa fechado</h3>
          <p class="dica" style="margin-bottom:12px">Abra o caixa para começar a vender. As vendas ficam vinculadas a ele para o fechamento.</p>
          <button class="btn" id="ir-caixa"><i class="fa-solid fa-lock-open"></i> Abrir caixa</button>
        </div>`;
      $("#ir-caixa").onclick = () => { sub = "caixa"; document.querySelectorAll("#pdv-sub button").forEach((x) => x.classList.toggle("ativo", x.dataset.sub === "caixa")); desenharSub(); };
      return;
    }
    $("#pdv-corpo").innerHTML = `
      <div class="pdv">
        <div class="pdv-cat">
          <div class="pdv-topo">
            <input id="pdv-busca" placeholder="Buscar produto ou ler código de barras (F2)" autocomplete="off" />
            <button type="button" class="btn" id="pdv-novo-produto" title="Cadastrar um produto agora"><i class="fa-solid fa-box-open"></i> Novo produto</button>
          </div>
          <div class="chips-adm" id="pdv-chips"></div>
          <div class="pdv-grid" id="pdv-produtos"></div>
        </div>
        <aside class="pdv-cart">
          <h3>Venda atual</h3>
          <div class="pdv-cli">
            <input id="pdv-cliente" list="pdv-clientes" placeholder="Cliente (opcional)" value="${esc(cliente)}" autocomplete="off" />
            <datalist id="pdv-clientes">${clientes.map((c) => `<option value="${esc(c.nome)}">`).join("")}</datalist>
            <button type="button" class="btn sec" id="pdv-novo-cliente" title="Cadastrar um cliente agora"><i class="fa-solid fa-user-plus"></i></button>
          </div>
          <small class="dica" id="pdv-cli-info"></small>
          <div class="pdv-itens" id="pdv-itens"></div>
          <div class="pdv-desc"><span>Desconto</span>
            <input id="pdv-desc-valor" type="number" min="0" step="0.01" value="${desconto.valor || ""}" placeholder="0" />
            <select id="pdv-desc-tipo"><option value="valor" ${desconto.tipo === "valor" ? "selected" : ""}>R$</option><option value="percentual" ${desconto.tipo === "percentual" ? "selected" : ""}>%</option></select>
          </div>
          <div class="pdv-totais" id="pdv-totais"></div>
          <div class="pdv-formas" id="pdv-formas">
            <span class="pdv-formas-rot">Forma de pagamento</span>
            <div class="pdv-formas-grade" role="radiogroup" aria-label="Forma de pagamento">
              ${FORMAS.map((f) => `<button type="button" class="pdv-forma ${f === formaRapida ? "ativo" : ""}" data-forma-rapida="${esc(f)}" role="radio" aria-checked="${f === formaRapida}"><i class="fa-solid ${ICONE[f]}"></i> ${esc(f)}</button>`).join("")}
            </div>
          </div>
          <button class="btn grande" id="pdv-receber"><i class="fa-solid fa-sack-dollar"></i> Receber (F4)</button>
          <button class="btn sec" id="pdv-limpar">Limpar venda</button>
        </aside>
      </div>`;

    $("#pdv-busca").value = termo;
    $("#pdv-busca").oninput = (e) => { termo = e.target.value; desenharProdutos(); };
    $("#pdv-busca").onkeydown = (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const t = termo.trim();
      if (!t) return;
      const exato = produtos.find((p) => p.codigo && p.codigo.toLowerCase() === t.toLowerCase());
      const alvo = exato || (filtrados().length === 1 ? filtrados()[0] : null);
      if (!alvo) return toast("Produto não encontrado");
      escolher(alvo);
      termo = ""; e.target.value = ""; desenharProdutos();
    };
    $("#pdv-cliente").oninput = (e) => { cliente = e.target.value; const c = clientes.find((x) => x.nome.toLowerCase() === cliente.trim().toLowerCase()); clienteId = c ? c.id : ""; infoCliente(); };
    $("#pdv-novo-cliente").onclick = () => A.formCliente(null, (novo) => definirCliente(novo), { nome: cliente });
    $("#pdv-novo-produto").onclick = produtoRapido;
    infoCliente();
    $("#pdv-desc-valor").oninput = (e) => { desconto.valor = parseFloat(e.target.value) || 0; desenharTotais(); };
    $("#pdv-desc-tipo").onchange = (e) => { desconto.tipo = e.target.value; desenharTotais(); };
    $("#pdv-receber").onclick = receber;
    $("#pdv-formas").onclick = (e) => {
      const b = e.target.closest("[data-forma-rapida]");
      if (!b) return;
      formaRapida = formaRapida === b.dataset.formaRapida ? "" : b.dataset.formaRapida; // clicar de novo desmarca
      document.querySelectorAll("[data-forma-rapida]").forEach((x) => {
        const on = x.dataset.formaRapida === formaRapida;
        x.classList.toggle("ativo", on); x.setAttribute("aria-checked", String(on));
      });
      desenharTotais();
    };
    $("#pdv-limpar").onclick = () => { if (cart.length && !confirm("Limpar a venda atual?")) return; novaVenda(); telaVenda(); };
    $("#pdv-chips").onclick = (e) => { const b = e.target.closest("[data-cat]"); if (b) { catAtiva = b.dataset.cat; desenharChips(); desenharProdutos(); } };
    $("#pdv-produtos").onclick = (e) => { const b = e.target.closest("[data-pid]"); if (b) escolher(produtos.find((p) => p.id === b.dataset.pid)); };
    $("#pdv-itens").onclick = (e) => {
      const m = e.target.closest("[data-mais]"), n = e.target.closest("[data-menos]"), r = e.target.closest("[data-rem]");
      const alvo = (b, attr) => b && cart.find((i) => chave(i) === b.getAttribute(attr));
      if (alvo(m, "data-mais")) alterarQtd(alvo(m, "data-mais"), 1);
      if (alvo(n, "data-menos")) alterarQtd(alvo(n, "data-menos"), -1);
      if (alvo(r, "data-rem")) { cart = cart.filter((i) => i !== alvo(r, "data-rem")); desenharCarrinho(); }
    };
    $("#pdv-itens").onchange = (e) => {
      const inp = e.target.closest("[data-qtd]");
      if (!inp) return;
      const item = cart.find((i) => chave(i) === inp.dataset.qtd);
      if (item) alterarQtd(item, (parseInt(inp.value, 10) || 1) - item.qtd);
    };
    desenharChips(); desenharProdutos(); desenharCarrinho();
    $("#pdv-busca").focus();
  };

  const filtrados = () => {
    const t = termo.trim().toLowerCase();
    return produtos.filter((p) =>
      (catAtiva === "all" || p.categoria === catAtiva) &&
      (!t || (p.nome + " " + (p.codigo || "")).toLowerCase().includes(t)));
  };
  const desenharChips = () => {
    $("#pdv-chips").innerHTML = `<button type="button" data-cat="all" class="${catAtiva === "all" ? "ativo" : ""}">Todos</button>` +
      categorias.map((c) => `<button type="button" data-cat="${esc(c.id)}" class="${catAtiva === c.id ? "ativo" : ""}">${esc(c.nome)}</button>`).join("");
  };
  const desenharProdutos = () => {
    const lista = filtrados().sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    $("#pdv-produtos").innerHTML = lista.map((p) => `
      <button type="button" class="pdv-card ${p.estoque <= 0 ? "sem" : ""}" data-pid="${p.id}">
        <img src="${esc(p.imagem || DB.placeholder("📦", "#e5e7eb"))}" alt="" />
        <strong>${esc(p.nome)}</strong>
        <span>${moeda(p.preco)}</span>
        <small>${p.estoque <= 0 ? "Sem estoque" : `${p.estoque} em estoque`}${temVariantes(p) ? " · variações" : ""}</small>
      </button>`).join("") || `<p class="vazio">Nenhum produto.</p>`;
  };
  const desenharCarrinho = () => {
    $("#pdv-itens").innerHTML = cart.map((i) => `
      <div class="pdv-item">
        <div class="pi-nome"><strong>${esc(i.nome)}</strong>${i.variante ? `<small>${esc(i.variante)}</small>` : ""}<small>${moeda(i.preco)} un.</small></div>
        <div class="pi-qtd"><button type="button" data-menos="${esc(chave(i))}">−</button>
          <input type="number" min="1" value="${i.qtd}" data-qtd="${esc(chave(i))}" aria-label="Quantidade" />
          <button type="button" data-mais="${esc(chave(i))}">+</button></div>
        <div class="pi-total">${moeda(i.preco * i.qtd)}</div>
        <button type="button" class="rem-var" data-rem="${esc(chave(i))}" aria-label="Remover">&times;</button>
      </div>`).join("") || `<p class="dica" style="padding:14px 0;text-align:center">Nenhum item. Clique em um produto ou leia o código de barras.</p>`;
    desenharTotais();
  };
  const desenharTotais = () => {
    const t = totais();
    $("#pdv-totais").innerHTML = `
      <div><span>Subtotal</span><span>${moeda(t.subtotal)}</span></div>
      ${t.desconto ? `<div><span>Desconto</span><span>- ${moeda(t.desconto)}</span></div>` : ""}
      <div class="grande"><span>Total</span><span>${moeda(t.total)}</span></div>`;
    $("#pdv-receber").disabled = cart.length === 0;
    $("#pdv-receber").innerHTML = `<i class="fa-solid fa-sack-dollar"></i> Receber (F4)${formaRapida ? ` — ${esc(formaRapida)}` : ""}`;
  };

  const novaVenda = () => { cart = []; desconto = { tipo: "valor", valor: 0 }; cliente = ""; clienteId = ""; formaRapida = ""; };

  // ---------- Cliente e produto cadastrados na hora ----------
  const infoCliente = () => {
    const el = $("#pdv-cli-info");
    if (!el) return;
    const nome = cliente.trim();
    el.textContent = !nome ? "" : clienteId ? "Cliente cadastrado." : "Nome avulso (não cadastrado). Use o botão para cadastrar.";
    el.style.color = clienteId ? "var(--ok)" : "var(--suave)";
  };
  // seleciona o cliente na venda; `soEstado` evita mexer na tela quando chamado de dentro do recebimento
  const definirCliente = (c, soEstado) => {
    if (!clientes.some((x) => x.id === c.id)) clientes.push(c);
    cliente = c.nome; clienteId = c.id;
    const inp = $("#pdv-cliente");
    if (inp) inp.value = c.nome;
    const dl = $("#pdv-clientes");
    if (dl) dl.innerHTML = clientes.map((x) => `<option value="${esc(x.nome)}">`).join("");
    infoCliente();
  };

  const produtoRapido = () => {
    abrirModal("Novo produto", `
      <label>Nome<input name="nome" required autocomplete="off" /></label>
      <div class="grid2">
        <label>Código de barras / SKU<input name="codigo" autocomplete="off" /></label>
        <label>Categoria<select name="categoria"><option value="">Sem categoria</option>${categorias.map((c) => `<option value="${esc(c.id)}">${esc(c.nome)}</option>`).join("")}</select></label>
      </div>
      <div class="grid2">
        <label>Preço de venda (R$)<input name="preco" type="number" min="0" step="0.01" required /></label>
        <label>Custo (R$) — opcional<input name="custo" type="number" min="0" step="0.01" /></label>
      </div>
      <label>Estoque inicial<input name="estoque" type="number" min="0" step="1" value="1" required /></label>
      <label class="check"><input type="checkbox" name="add" checked /> Adicionar à venda atual</label>
      <p class="dica">Cadastro rápido. Foto, descrição e variações podem ser completadas depois em Produtos.</p>`,
      async (d) => {
        const nome = d.nome.trim(), codigo = d.codigo.trim(), preco = parseFloat(d.preco);
        if (!nome || !(preco >= 0)) return false;
        if (codigo && produtos.some((p) => (p.codigo || "").toLowerCase() === codigo.toLowerCase())) { toast("Já existe um produto com esse código"); return false; }
        let novo = null;
        const ok = await tentar(async () => {
          novo = await DB.produtos.salvar({
            nome, codigo, categoria: d.categoria, preco, precoAntigo: 0, custo: d.custo === "" ? null : parseFloat(d.custo),
            estoque: Math.max(0, parseInt(d.estoque, 10) || 0), descricao: "", imagem: DB.placeholder("📦", "#e5e7eb"),
            destaque: false, ativo: true, variantes: [],
          });
        });
        if (!ok) return false;
        produtos.push(novo);
        await tentar(() => DB.movimentos.registrar(novo, "", 0, novo.estoque, { tipo: "entrada", motivo: "Estoque inicial (cadastro rápido no PDV)" }));
        toast("Produto cadastrado");
        setTimeout(() => { desenharProdutos(); if (d.add === "on") adicionar(novo, ""); }, 0);
      }, { salvar: "Cadastrar produto" });
  };

  const escolher = (p) => {
    if (!p) return;
    if (temVariantes(p)) {
      abrirModal(`${p.nome} — escolha a opção`, `
        <div class="variantes-pdv">${p.variantes.map((v) => `
          <label class="var ${v.estoque <= 0 ? "off" : ""}"><input type="radio" name="vid" value="${esc(v.id)}" ${v.estoque <= 0 ? "disabled" : ""} /><span>${esc(v.nome)} <small>(${v.estoque})</small></span></label>`).join("")}</div>`,
        (d) => { if (!d.vid) { toast("Escolha uma opção"); return false; } adicionar(p, d.vid); }, { salvar: "Adicionar" });
      return;
    }
    adicionar(p, "");
  };
  const adicionar = (p, vid) => {
    const disponivel = estoqueDe(p, vid);
    const existente = cart.find((i) => i.id === p.id && i.vid === vid);
    if ((existente ? existente.qtd : 0) + 1 > disponivel) return toast(disponivel <= 0 ? "Produto sem estoque" : `Estoque disponível: ${disponivel}`);
    if (existente) existente.qtd++;
    else cart.push({ id: p.id, vid, nome: p.nome, variante: vid ? p.variantes.find((v) => v.id === vid).nome : "", preco: p.preco, custo: p.custo ?? null, qtd: 1 });
    desenharCarrinho();
  };
  const alterarQtd = (item, delta) => {
    const p = produtos.find((x) => x.id === item.id);
    const nova = item.qtd + delta;
    if (nova <= 0) cart = cart.filter((i) => i !== item);
    else if (p && nova > estoqueDe(p, item.vid)) { toast(`Estoque disponível: ${estoqueDe(p, item.vid)}`); }
    else item.qtd = nova;
    desenharCarrinho();
  };

  // ---------- Recebimento ----------
  const addDiasIso = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return isoDia(d); };
  const addMesesIso = (iso, n) => {
    const [y, m, d] = iso.split("-").map(Number);
    const base = new Date(y, m - 1 + n, 1);
    const ultimo = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
    return isoDia(new Date(base.getFullYear(), base.getMonth(), Math.min(d, ultimo)));
  };
  const dataCurta = (iso) => iso.split("-").reverse().join("/");
  const INTERVALOS = { mensal: "Mensal", quinzenal: "Quinzenal (15 dias)", semanal: "Semanal (7 dias)" };
  // divide `valor` em `n` parcelas (a última absorve os centavos) a partir do 1º vencimento
  const gerarParcelas = (valor, n, primeiro, intervalo) => {
    const base = Math.floor((valor / n) * 100) / 100;
    return Array.from({ length: n }, (_, i) => ({
      n: i + 1,
      valor: i === n - 1 ? arred(valor - base * (n - 1)) : base,
      venc: intervalo === "mensal" ? addMesesIso(primeiro, i) : addDiasIso(primeiro, i * (intervalo === "quinzenal" ? 15 : 7)),
    }));
  };
  const rotuloPagamento = (p) => p.forma + (p.parcelas > 1 ? ` ${p.parcelas}x` : "");

  const receber = () => {
    if (!cart.length) return toast("Adicione itens à venda");
    const t = totais();
    if (t.total <= 0) return toast("Total da venda deve ser maior que zero");
    let pags = [];       // { forma, valor (aplicado na venda), recebido, [parcelas, intervalo, parcelasLista] }
    let forma = formaRapida || "Dinheiro";
    const prazo = { parc: 1, venc: addDiasIso(isoDia(), 30), intervalo: "mensal" };
    // PIX e cartões: o valor total já entra lançado, basta concluir (dá para remover e dividir o pagamento)
    if (["PIX", "Cartão de Débito", "Cartão de Crédito"].includes(formaRapida)) pags.push({ forma: formaRapida, valor: t.total, recebido: t.total });
    const pago = () => arred(pags.reduce((s, p) => s + p.valor, 0));
    const restante = () => arred(t.total - pago());
    const troco = () => arred(pags.reduce((s, p) => s + (p.recebido - p.valor), 0));

    // ----- painel da forma escolhida -----
    const painel = () => {
      const falta = restante();
      if (forma === "Dinheiro") return `
        <div class="grid2">
          <label>Valor recebido do cliente (R$)<input type="number" id="pg-valor" min="0.01" step="0.01" value="${falta.toFixed(2)}" /></label>
          <div class="pg-troco"><span>Troco a devolver</span><strong id="pg-troco">${moeda(0)}</strong></div>
        </div>
        <button type="button" class="btn" id="pg-add"><i class="fa-solid fa-plus"></i> Adicionar dinheiro</button>`;
      if (forma === "A prazo") return `
        <div class="grid2">
          <label>Valor a prazo (R$)<input type="number" id="pg-valor" min="0.01" step="0.01" value="${falta.toFixed(2)}" /></label>
          <label>Dividir em (parcelas)<input type="number" id="pg-parc" min="1" max="60" step="1" value="${prazo.parc}" /></label>
        </div>
        <div class="grid2">
          <label>1º vencimento<input type="date" id="pg-venc" value="${prazo.venc}" min="${isoDia()}" /></label>
          <label>Intervalo<select id="pg-int">${Object.entries(INTERVALOS).map(([k, n]) => `<option value="${k}" ${prazo.intervalo === k ? "selected" : ""}>${n}</option>`).join("")}</select></label>
        </div>
        <label>Cliente (obrigatório — a conta a receber fica no nome dele)
          <input id="pg-cliente" list="pdv-clientes" value="${esc(cliente)}" placeholder="Digite para buscar..." autocomplete="off" /></label>
        <p class="dica" id="pg-cli-info"></p>
        <button type="button" class="link-btn" id="pg-novo-cli"><i class="fa-solid fa-user-plus"></i> Cadastrar novo cliente agora</button>
        <div class="pg-novo-cli" id="pg-novo-cli-box" hidden>
          <div class="grid2">
            <label>Nome<input id="pg-nc-nome" autocomplete="off" /></label>
            <label>Telefone<input id="pg-nc-fone" type="tel" /></label>
          </div>
          <button type="button" class="btn sec" id="pg-nc-salvar">Cadastrar e selecionar</button>
        </div>
        <div class="pg-prev" id="pg-prev"></div>
        <button type="button" class="btn" id="pg-add"><i class="fa-solid fa-plus"></i> Adicionar a prazo</button>`;
      return `
        <label>Valor no ${esc(forma)} (R$)<input type="number" id="pg-valor" min="0.01" step="0.01" value="${falta.toFixed(2)}" /></label>
        <button type="button" class="btn" id="pg-add"><i class="fa-solid fa-plus"></i> Adicionar ${esc(forma)}</button>`;
    };

    const desenharPrevia = () => {
      const alvo = $("#pg-prev");
      if (!alvo) return;
      const v = parseFloat($("#pg-valor").value) || 0, n = Math.min(60, Math.max(1, parseInt($("#pg-parc").value, 10) || 1));
      if (!(v > 0) || !$("#pg-venc").value) { alvo.innerHTML = ""; return; }
      const lista = gerarParcelas(Math.min(v, restante()), n, $("#pg-venc").value, $("#pg-int").value);
      alvo.innerHTML = `<b>Parcelas que serão lançadas em Contas a receber:</b><ul>${lista.map((p) => `<li><span>${p.n}/${n} — ${dataCurta(p.venc)}</span><b>${moeda(p.valor)}</b></li>`).join("")}</ul>`;
    };
    const infoCliente = () => {
      const el = $("#pg-cli-info");
      if (!el) return;
      const nome = $("#pg-cliente").value.trim();
      const c = clientes.find((x) => x.nome.toLowerCase() === nome.toLowerCase());
      el.textContent = !nome ? "" : c ? "Cliente cadastrado." : "Cliente não cadastrado — use \"Cadastrar novo cliente agora\".";
      el.style.color = c ? "var(--ok)" : "var(--erro)";
    };

    const desenhar = () => {
      const falta = restante();
      $("#pg-area").innerHTML = `
        <div class="pg-resumo">
          <div><span>Pago</span><strong>${moeda(pago())}</strong></div>
          <div class="${falta > 0 ? "falta" : "ok"}"><span>Restante</span><strong>${moeda(falta)}</strong></div>
          <div><span>Troco</span><strong>${moeda(troco())}</strong></div>
        </div>
        <ul class="pg-lista">${pags.map((p, i) => `
          <li><span><i class="fa-solid ${ICONE[p.forma]}"></i> ${esc(rotuloPagamento(p))}
            ${p.recebido > p.valor ? `<small>(recebido ${moeda(p.recebido)})</small>` : ""}
            ${p.parcelasLista ? `<small>1º venc. ${dataCurta(p.parcelasLista[0].venc)}</small>` : ""}</span>
            <b>${moeda(p.valor)}</b><button type="button" class="rem-var" data-rpg="${i}" aria-label="Remover">&times;</button></li>`).join("")}</ul>
        ${falta > 0 ? `
          <div class="pg-formas">${FORMAS.map((f) => `<button type="button" class="btn sec ${f === forma ? "ativo" : ""}" data-forma="${esc(f)}"><i class="fa-solid ${ICONE[f]}"></i> ${esc(f)}</button>`).join("")}</div>
          <div class="pg-painel">${painel()}</div>` : ""}`;
      ligar();
    };

    const ligar = () => {
      const v = $("#pg-valor");
      if (!v) return;
      v.focus(); v.select();
      if (forma === "Dinheiro") {
        v.oninput = () => { $("#pg-troco").textContent = moeda(Math.max(0, arred((parseFloat(v.value) || 0) - restante()))); };
        v.oninput();
      }
      if (forma === "A prazo") {
        ["#pg-valor", "#pg-parc", "#pg-venc", "#pg-int"].forEach((s) => {
          $(s).oninput = $(s).onchange = () => { prazo.parc = parseInt($("#pg-parc").value, 10) || 1; prazo.venc = $("#pg-venc").value; prazo.intervalo = $("#pg-int").value; desenharPrevia(); };
        });
        $("#pg-cliente").oninput = infoCliente;
        $("#pg-novo-cli").onclick = () => { $("#pg-novo-cli-box").hidden = false; $("#pg-nc-nome").value = $("#pg-cliente").value; $("#pg-nc-nome").focus(); };
        $("#pg-nc-salvar").onclick = async () => {
          const nome = $("#pg-nc-nome").value.trim();
          if (!nome) return toast("Informe o nome do cliente");
          if (clientes.some((x) => x.nome.toLowerCase() === nome.toLowerCase())) return toast("Já existe um cliente com esse nome");
          let novo = null;
          if (!(await tentar(async () => { novo = await DB.clientes.salvar({ nome, telefone: $("#pg-nc-fone").value.trim(), criadoEm: new Date().toISOString() }); }))) return;
          definirCliente(novo, true);
          $("#pg-cliente").value = novo.nome; $("#pg-novo-cli-box").hidden = true; infoCliente(); toast("Cliente cadastrado");
        };
        desenharPrevia(); infoCliente();
      }
    };

    abrirModal("Receber venda", `
      <div class="pg-total"><span>Total a receber</span><strong>${moeda(t.total)}</strong></div>
      <div id="pg-area"></div>`,
      async () => {
        if (restante() > 0.009) { toast(`Falta receber ${moeda(restante())}`); return false; }
        const venda = await finalizar(t, pags, troco());
        if (!venda) return false;
        novaVenda();
        autoImprimir(venda);
        setTimeout(() => { telaVenda(); mostrarRecibo(venda, true); }, 0);
      }, { salvar: "Concluir venda", largo: true });

    desenhar();

    const adicionar = () => {
      const digitado = parseFloat($("#pg-valor").value);
      if (!(digitado > 0)) return toast("Informe o valor");
      const falta = restante();
      const aplicado = arred(Math.min(digitado, falta));
      if (forma !== "Dinheiro" && digitado > falta + 0.009) toast(`Valor ajustado para ${moeda(falta)} (restante)`);
      if (forma === "A prazo") {
        const nome = $("#pg-cliente").value.trim();
        const c = clientes.find((x) => x.nome.toLowerCase() === nome.toLowerCase());
        if (!c) return toast("Selecione um cliente cadastrado (ou cadastre agora)");
        const n = Math.min(60, Math.max(1, parseInt($("#pg-parc").value, 10) || 1)), venc = $("#pg-venc").value;
        if (!venc) return toast("Informe o 1º vencimento");
        definirCliente(c, true);
        pags.push({ forma, valor: aplicado, recebido: aplicado, parcelas: n, intervalo: $("#pg-int").value, parcelasLista: gerarParcelas(aplicado, n, venc, $("#pg-int").value) });
      } else {
        pags.push({ forma, valor: aplicado, recebido: forma === "Dinheiro" ? digitado : aplicado });
      }
      desenhar();
    };

    $("#pg-area").onclick = (e) => {
      const f = e.target.closest("[data-forma]"), r = e.target.closest("[data-rpg]");
      if (r) { pags.splice(+r.dataset.rpg, 1); desenhar(); return; }
      if (f) { forma = f.dataset.forma; desenhar(); return; }
      if (e.target.closest("#pg-add")) adicionar();
    };
    // Enter dentro dos campos adiciona o pagamento (e nunca conclui a venda por engano)
    $("#pg-area").onkeydown = (e) => {
      if (e.key !== "Enter" || e.target.tagName === "BUTTON") return;
      e.preventDefault();
      if (e.target.id === "pg-nc-nome" || e.target.id === "pg-nc-fone") return $("#pg-nc-salvar").click();
      $("#pg-add") && adicionar();
    };
  };

  const finalizar = async (t, pags, troco) => {
    let venda = null;
    const ok = await tentar(async () => {
      // revalida estoque com o servidor
      const frescos = await Promise.all([...new Set(cart.map((i) => i.id))].map((id) => DB.produtos.obter(id)));
      for (const i of cart) {
        const p = frescos.find((x) => x && x.id === i.id);
        if (!p || estoqueDe(p, i.vid) < i.qtd) {
          toast(`Estoque insuficiente para "${i.nome}"`);
          throw Object.assign(new Error("estoque"), { silencioso: true });
        }
      }
      const numero = await DB.proximoNumero("venda");
      venda = await DB.vendas.salvar({
        numero, criadoEm: new Date().toISOString(), origem: "pdv", status: "concluida", caixaId: caixa.id,
        operador: DB.auth.currentUser.email, cliente: cliente.trim(), clienteId: clienteId || "",
        itens: cart.map(({ id, vid, variante, nome, preco, custo, qtd }) => ({ id, vid, variante, nome, preco, custo, qtd })),
        subtotal: t.subtotal, desconto: t.desconto, total: t.total,
        pagamentos: pags.map(({ forma, valor, parcelas, intervalo, parcelasLista }) => (parcelas ? { forma, valor, parcelas, intervalo, parcelasLista } : { forma, valor })),
        troco,
      });
      for (const i of cart) await DB.produtos.ajustarEstoque(i.id, -i.qtd, i.vid, { tipo: "venda_pdv", motivo: `Venda PDV #${numero}`, ref: String(numero) });
      // cada pagamento a prazo vira uma conta a receber por parcela (empresa), no nome do cliente
      for (const pg of pags.filter((p) => p.parcelasLista)) {
        const grupoId = DB.fs.collection("contas").doc().id, lote = DB.fs.batch(), n = pg.parcelas;
        pg.parcelasLista.forEach((pc) => lote.set(DB.fs.collection("contas").doc(), JSON.parse(JSON.stringify({
          tipo: "receber", escopo: "empresa", descricao: `Venda PDV #${numero}${n > 1 ? ` — parcela ${pc.n}/${n}` : ""}`,
          parte: cliente.trim(), clienteId: clienteId || "", categoria: "Vendas a prazo", valor: pc.valor, vencimento: pc.venc,
          status: "pendente", origem: "pdv", vendaId: venda.id, grupoId, criadoEm: new Date().toISOString(),
        }))));
        await lote.commit();
      }
    }, "Não foi possível concluir a venda");
    if (!ok) venda = null;
    if (venda) produtos = await DB.produtos.listar(); // atualiza o estoque exibido
    return venda;
  };

  // ---------- Cupom / recibo ----------
  const htmlCupom = (v, cfg) => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Venda #${v.numero}</title>
    <style>
      @page{margin:0}
      body{font-family:"Courier New",monospace;font-size:12px;width:76mm;margin:4mm;color:#000}
      h1{font-size:15px;text-align:center;margin:0}.c{text-align:center}.l{border-top:1px dashed #000;margin:6px 0}
      table{width:100%;border-collapse:collapse}td{padding:1px 0;vertical-align:top}.r{text-align:right}.b{font-weight:bold}
      .no{margin-top:10px;text-align:center}@media print{.no{display:none}}
    </style></head><body>
    <h1>${esc(cfg.nomeLoja)}</h1>
    <div class="c">${esc(cfg.endereco || "")}</div>
    <div class="l"></div>
    <div>Venda nº ${v.numero}${v.status === "cancelada" ? " (CANCELADA)" : ""}</div>
    <div>${dataBR(v.criadoEm)}${v.cliente ? " — " + esc(v.cliente) : ""}</div>
    <div class="l"></div>
    <table>${v.itens.map((i) => `<tr><td colspan="2">${esc(nomeItem(i))}</td></tr><tr><td>${i.qtd} x ${moeda(i.preco)}</td><td class="r">${moeda(i.preco * i.qtd)}</td></tr>`).join("")}</table>
    <div class="l"></div>
    <table>
      <tr><td>Subtotal</td><td class="r">${moeda(v.subtotal)}</td></tr>
      ${v.desconto ? `<tr><td>Desconto</td><td class="r">- ${moeda(v.desconto)}</td></tr>` : ""}
      <tr class="b"><td>TOTAL</td><td class="r">${moeda(v.total)}</td></tr>
      ${v.pagamentos.map((p) => `<tr><td>${esc(rotuloPagamento(p))}</td><td class="r">${moeda(p.valor)}</td></tr>${(p.parcelasLista || []).map((pc) => `<tr><td>&nbsp;&nbsp;${pc.n}/${p.parcelas} venc. ${dataCurta(pc.venc)}</td><td class="r">${moeda(pc.valor)}</td></tr>`).join("")}`).join("")}
      ${v.troco ? `<tr><td>Troco</td><td class="r">${moeda(v.troco)}</td></tr>` : ""}
    </table>
    <div class="l"></div><div class="c">Obrigado pela preferência!</div>
    <div class="no"><button onclick="window.print()">Imprimir</button></div>
    <script>window.onload=function(){setTimeout(function(){window.print()},300)}<\/script></body></html>`;

  // Imprime direto na térmica Bluetooth quando conectada; senão abre a janela de impressão do navegador
  const imprimirCupom = async (v) => {
    if (A.impressora && A.impressora.conectada()) {
      try { await A.impressora.cupomVenda(v); toast("Cupom enviado para a impressora"); return; }
      catch (e) { toast("Falha na impressora (" + (e.message || "erro") + "). Abrindo a impressão do navegador."); }
    }
    const cfg = await DB.config.obter();
    const w = window.open("", "_blank", "width=380,height=640");
    if (!w) return toast("Permita pop-ups para imprimir");
    w.document.write(htmlCupom(v, cfg));
    w.document.close();
  };

  // Impressão automática das vendas (Configurações → Impressora)
  const autoImprimir = async (venda) => {
    if (!(A.config && A.config.impressaoAutoPdv)) return;
    if (!A.impressora || !A.impressora.conectada()) { toast("Impressão automática ligada, mas a impressora não está conectada."); return; }
    try { await A.impressora.cupomVenda(venda); } catch (e) { toast("Não foi possível imprimir o cupom: " + (e.message || "erro")); }
  };

  const mostrarRecibo = (v, nova) => {
    abrirModal(`Venda #${v.numero}${v.status === "cancelada" ? " — cancelada" : ""}`, `
      <div class="detalhe">
        <p>${dataBR(v.criadoEm)} · operador ${esc(v.operador || "—")}${v.cliente ? ` · cliente ${esc(v.cliente)}` : ""}</p>
        <ul>${v.itens.map((i) => `<li>${i.qtd}x ${esc(nomeItem(i))} — ${moeda(i.preco * i.qtd)}</li>`).join("")}</ul>
        <p>Subtotal ${moeda(v.subtotal)}${v.desconto ? ` · Desconto -${moeda(v.desconto)}` : ""}</p>
        <p><b>Total ${moeda(v.total)}</b></p>
        <p>${v.pagamentos.map((p) => `${esc(rotuloPagamento(p))} ${moeda(p.valor)}`).join(" · ")}${v.troco ? ` · Troco ${moeda(v.troco)}` : ""}</p>
        ${v.pagamentos.filter((p) => p.parcelasLista).map((p) => `<p class="dica">A prazo: ${p.parcelasLista.map((pc) => `${pc.n}/${p.parcelas} em ${dataCurta(pc.venc)} (${moeda(pc.valor)})`).join("; ")}</p>`).join("")}
      </div>
      <button type="button" class="btn sec" id="imp-cupom"><i class="fa-solid fa-print"></i> Imprimir cupom</button>`,
      () => {}, { salvar: nova ? "Nova venda" : "Fechar", semCancelar: true });
    $("#imp-cupom").onclick = () => imprimirCupom(v);
  };

  // ---------- Sub-aba: Vendas ----------
  const telaVendas = async () => {
    if (!diaVendas) diaVendas = isoDia();
    $("#pdv-corpo").innerHTML = `<p class="vazio">Carregando...</p>`;
    const [a, b] = [new Date(diaVendas + "T00:00:00"), new Date(diaVendas + "T23:59:59.999")];
    const lista = (await DB.vendas.listarEntre("criadoEm", a.toISOString(), b.toISOString())).sort((x, y) => y.numero - x.numero);
    const validas = lista.filter((v) => v.status !== "cancelada");
    const total = validas.reduce((s, v) => s + v.total, 0);
    $("#pdv-corpo").innerHTML = `
      <div class="filtros"><input type="date" id="dia-vendas" value="${diaVendas}" />
        <span class="dica" style="align-self:center">${validas.length} venda(s) · ${moeda(total)}</span></div>
      <table><thead><tr><th>Nº</th><th>Hora</th><th>Cliente</th><th>Pagamento</th><th>Total</th><th>Situação</th><th></th></tr></thead><tbody>
      ${lista.map((v) => `<tr>
        <td>${v.numero}</td><td>${new Date(v.criadoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</td>
        <td>${esc(v.cliente || "—")}</td><td>${esc(v.pagamentos.map((p) => rotuloPagamento(p)).join(" + "))}</td><td>${moeda(v.total)}</td>
        <td><span class="status ${v.status === "cancelada" ? "s-cancelado" : "s-entregue"}">${v.status === "cancelada" ? "Cancelada" : "Concluída"}</span></td>
        <td class="acoes"><button class="btn sec peq" data-ver="${v.id}">Ver</button>
          ${v.status === "cancelada" ? "" : `<button class="btn perigo peq" data-cancel="${v.id}">Cancelar</button>`}</td></tr>`).join("") || `<tr><td colspan="7" class="vazio">Nenhuma venda neste dia.</td></tr>`}
      </tbody></table>`;
    $("#dia-vendas").onchange = (e) => { diaVendas = e.target.value || isoDia(); telaVendas(); };
    $("#pdv-corpo").onclick = async (e) => {
      const ver = e.target.closest("[data-ver]"), can = e.target.closest("[data-cancel]");
      if (ver) mostrarRecibo(lista.find((v) => v.id === ver.dataset.ver), false);
      if (can) cancelarVenda(lista.find((v) => v.id === can.dataset.cancel));
    };
  };

  const cancelarVenda = async (v) => {
    if (!confirm(`Cancelar a venda #${v.numero}? O estoque será devolvido.`)) return;
    const ok = await tentar(async () => {
      for (const i of v.itens) await DB.produtos.ajustarEstoque(i.id, i.qtd, i.vid, { tipo: "cancelamento_pdv", motivo: `Venda PDV #${v.numero} cancelada`, ref: String(v.numero) });
      await DB.vendas.salvar({ ...v, status: "cancelada", canceladaEm: new Date().toISOString(), canceladaPor: DB.auth.currentUser.email });
      // remove as parcelas a prazo ainda não recebidas (se alguma já foi recebida, avisa)
      const contas = (await DB.fs.collection("contas").where("vendaId", "==", v.id).get()).docs;
      for (const c of contas) {
        if (c.data().status === "pago") toast("Uma parcela a prazo desta venda já foi recebida; ajuste em Contas a receber.");
        else await DB.contas.remover(c.id);
      }
    }, "Não foi possível cancelar a venda");
    if (ok) { produtos = await DB.produtos.listar(); toast("Venda cancelada"); telaVendas(); }
  };

  // ---------- Sub-aba: Caixa ----------
  const resumoCaixa = (c, vendas) => {
    const validas = vendas.filter((v) => v.status !== "cancelada");
    const porForma = {};
    validas.forEach((v) => v.pagamentos.forEach((p) => (porForma[p.forma] = arred((porForma[p.forma] || 0) + p.valor))));
    const mov = c.movimentos || [];
    const sang = mov.filter((m) => m.tipo === "sangria").reduce((s, m) => s + m.valor, 0);
    const supr = mov.filter((m) => m.tipo === "suprimento").reduce((s, m) => s + m.valor, 0);
    const esperado = arred((c.saldoInicial || 0) + (porForma.Dinheiro || 0) + supr - sang);
    return { porForma, qtd: validas.length, totalVendas: arred(validas.reduce((s, v) => s + v.total, 0)), sang, supr, esperado };
  };

  const telaCaixa = async () => {
    $("#pdv-corpo").innerHTML = `<p class="vazio">Carregando...</p>`;
    if (!caixa) {
      const hist = (await DB.caixas.listar()).filter((c) => c.status === "fechado").sort((a, b) => b.abertoEm.localeCompare(a.abertoEm)).slice(0, 10);
      $("#pdv-corpo").innerHTML = `
        <div class="painel" style="max-width:460px;margin-bottom:16px">
          <h3 style="margin-bottom:10px">Abrir caixa</h3>
          <form id="form-abrir" style="display:grid;gap:10px">
            <label>Saldo inicial em dinheiro (R$)<input name="saldo" type="number" min="0" step="0.01" value="0" required /></label>
            <button class="btn"><i class="fa-solid fa-lock-open"></i> Abrir caixa</button>
          </form>
        </div>
        <h3 style="margin-bottom:8px">Últimos fechamentos</h3>
        <table><thead><tr><th>Abertura</th><th>Fechamento</th><th>Vendas</th><th>Esperado</th><th>Contado</th><th>Diferença</th></tr></thead><tbody>
        ${hist.map((c) => `<tr><td>${dataBR(c.abertoEm)}</td><td>${dataBR(c.fechadoEm)}</td><td>${moeda(c.resumo?.totalVendas)}</td><td>${moeda(c.esperado)}</td><td>${moeda(c.contado)}</td>
          <td style="color:${Math.abs(c.diferenca) < 0.01 ? "var(--ok)" : "var(--erro)"}">${moeda(c.diferenca)}</td></tr>`).join("") || `<tr><td colspan="6" class="vazio">Nenhum fechamento ainda.</td></tr>`}
        </tbody></table>`;
      $("#form-abrir").onsubmit = async (e) => {
        e.preventDefault();
        const saldo = parseFloat(new FormData(e.target).get("saldo")) || 0;
        if (await tentar(async () => { caixa = await DB.caixas.salvar({ status: "aberto", abertoEm: new Date().toISOString(), abertoPor: DB.auth.currentUser.email, saldoInicial: saldo, movimentos: [] }); })) {
          toast("Caixa aberto"); sub = "venda"; desenharBase();
        }
      };
      return;
    }
    const vendas = (await DB.fs.collection("vendas").where("caixaId", "==", caixa.id).get()).docs.map((d) => ({ ...d.data(), id: d.id }));
    const r = resumoCaixa(caixa, vendas);
    $("#pdv-corpo").innerHTML = `
      <div class="kpis">
        <div class="kpi"><span>Aberto em</span><strong style="font-size:1.1rem">${dataBR(caixa.abertoEm)}</strong></div>
        <div class="kpi"><span>Saldo inicial</span><strong>${moeda(caixa.saldoInicial)}</strong></div>
        <div class="kpi"><span>Vendas (${r.qtd})</span><strong>${moeda(r.totalVendas)}</strong></div>
        <div class="kpi"><span>Dinheiro esperado</span><strong>${moeda(r.esperado)}</strong></div>
      </div>
      <div class="duas">
        <div class="painel"><h3>Recebido por forma</h3><ul>${Object.entries(r.porForma).map(([f, v]) => `<li><span>${esc(f)}</span><strong>${moeda(v)}</strong></li>`).join("") || "<li>Sem vendas</li>"}</ul></div>
        <div class="painel"><h3>Movimentos</h3><ul>
          ${(caixa.movimentos || []).map((m) => `<li><span>${m.tipo === "sangria" ? "Sangria" : "Suprimento"} — ${esc(m.motivo || "")} <small>${dataBR(m.em)}</small></span><strong>${m.tipo === "sangria" ? "-" : "+"} ${moeda(m.valor)}</strong></li>`).join("") || "<li>Nenhum</li>"}</ul></div>
      </div>
      <div class="barra-acoes" style="margin-top:14px">
        <button class="btn sec" id="cx-sangria"><i class="fa-solid fa-arrow-up-from-bracket"></i> Sangria</button>
        <button class="btn sec" id="cx-suprimento"><i class="fa-solid fa-arrow-down-to-bracket"></i> Suprimento</button>
        <button class="btn perigo" id="cx-fechar" style="margin-left:auto"><i class="fa-solid fa-lock"></i> Fechar caixa</button>
      </div>`;

    const movimento = (tipo) => abrirModal(tipo === "sangria" ? "Sangria (retirada de dinheiro)" : "Suprimento (entrada de dinheiro)", `
      <label>Valor (R$)<input name="valor" type="number" min="0.01" step="0.01" required /></label>
      <label>Motivo<input name="motivo" placeholder="Ex.: pagamento de fornecedor" /></label>`,
      async (d) => {
        const valor = parseFloat(d.valor);
        if (!(valor > 0)) return false;
        const novo = { ...caixa, movimentos: [...(caixa.movimentos || []), { tipo, valor, motivo: d.motivo.trim(), em: new Date().toISOString(), por: DB.auth.currentUser.email }] };
        if (!(await tentar(() => DB.caixas.salvar(novo)))) return false;
        caixa = novo; toast("Movimento registrado"); telaCaixa();
      });
    $("#cx-sangria").onclick = () => movimento("sangria");
    $("#cx-suprimento").onclick = () => movimento("suprimento");
    $("#cx-fechar").onclick = () => {
      abrirModal("Fechar caixa", `
        <div class="detalhe"><p>Dinheiro esperado no caixa: <b>${moeda(r.esperado)}</b></p>
          <p class="dica">Saldo inicial + vendas em dinheiro + suprimentos − sangrias.</p></div>
        <label>Dinheiro contado (R$)<input name="contado" id="cx-contado" type="number" min="0" step="0.01" required /></label>
        <p id="cx-dif" class="dica"></p>
        <label>Observações<input name="obs" /></label>`,
        async (d) => {
          const contado = parseFloat(d.contado);
          if (!(contado >= 0)) return false;
          const fechado = {
            ...caixa, status: "fechado", fechadoEm: new Date().toISOString(), fechadoPor: DB.auth.currentUser.email,
            contado, esperado: r.esperado, diferenca: arred(contado - r.esperado), obs: d.obs.trim(),
            resumo: { porForma: r.porForma, qtd: r.qtd, totalVendas: r.totalVendas, sangrias: r.sang, suprimentos: r.supr },
          };
          if (!(await tentar(() => DB.caixas.salvar(fechado)))) return false;
          caixa = null; novaVenda(); toast("Caixa fechado"); telaCaixa();
        }, { salvar: "Fechar caixa" });
      $("#cx-contado").oninput = (e) => {
        const dif = arred((parseFloat(e.target.value) || 0) - r.esperado);
        $("#cx-dif").textContent = `Diferença: ${moeda(dif)}`;
        $("#cx-dif").style.color = Math.abs(dif) < 0.01 ? "var(--ok)" : "var(--erro)";
      };
    };
  };

  // ---------- Atalhos de teclado ----------
  document.addEventListener("keydown", (e) => {
    if ($("#tab-pdv").hidden || sub !== "venda" || !caixa || !$("#modal").hidden) return;
    if (e.key === "F2") { e.preventDefault(); $("#pdv-busca")?.focus(); }
    if (e.key === "F4") { e.preventDefault(); receber(); }
  });
});
