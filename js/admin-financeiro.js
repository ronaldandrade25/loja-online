// Contas a pagar e contas a receber, cada uma com sub-abas Empresa e Pessoal.
// Tudo fica na coleção "contas" (campo tipo: pagar | receber; campo escopo: empresa | pessoal).
window.Admin.modulos.push((A) => {
  const { $, toast, tentar, abrirModal, carregando } = A;
  const { moeda, esc } = DB;

  const CONFIG = {
    pagar: {
      titulo: "Contas a pagar", acao: "Pagar", feito: "Pago", feitoNoMes: "Pago no mês", parte: "Fornecedor / credor", cor: "var(--erro)",
      categorias: {
        empresa: ["Fornecedores", "Aluguel", "Salários", "Impostos", "Energia / Água / Internet", "Marketing", "Frete / Logística", "Manutenção", "Taxas e tarifas", "Outros"],
        pessoal: ["Moradia", "Alimentação", "Transporte", "Saúde", "Educação", "Lazer", "Cartão de crédito", "Assinaturas", "Outros"],
      },
    },
    receber: {
      titulo: "Contas a receber", acao: "Receber", feito: "Recebido", feitoNoMes: "Recebido no mês", parte: "Cliente / pagador", cor: "var(--ok)",
      categorias: {
        empresa: ["Vendas a prazo", "Vendas", "Serviços", "Encomendas", "Outros"],
        pessoal: ["Salário", "Aluguel recebido", "Reembolso", "Rendimentos", "Outros"],
      },
    },
  };
  const estado = {
    pagar: { escopo: "empresa", status: "abertas", mes: "", busca: "" },
    receber: { escopo: "empresa", status: "abertas", mes: "", busca: "" },
  };

  const pad = (n) => String(n).padStart(2, "0");
  const isoDia = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const hoje = () => isoDia();
  const dataCurta = (iso) => (iso ? iso.split("-").reverse().join("/") : "—");
  const arred = (v) => Math.round(v * 100) / 100;
  const addDias = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return isoDia(d); };
  // soma meses preservando o dia (ajusta para o último dia do mês quando necessário)
  const addMeses = (iso, n) => {
    const [y, m, d] = iso.split("-").map(Number);
    const base = new Date(y, m - 1 + n, 1);
    const ultimo = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
    return `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(Math.min(d, ultimo))}`;
  };

  const situacao = (c) => {
    if (c.status === "pago") return "pago";
    const h = hoje();
    return c.vencimento < h ? "vencida" : c.vencimento === h ? "hoje" : "pendente";
  };
  const ROTULO_SIT = { pago: "feito", vencida: "Vencida", hoje: "Vence hoje", pendente: "Pendente" };
  const CLASSE_SIT = { pago: "s-ativo", vencida: "s-cancelado", hoje: "s-confirmado", pendente: "s-novo" };

  // ---------- Tela (uma função serve para as duas abas) ----------
  const tela = (tipo) => async () => {
    carregando(tipo);
    const cfg = CONFIG[tipo], est = estado[tipo];
    const todas = (await DB.contas.listar()).filter((c) => c.tipo === tipo && c.escopo === est.escopo);
    const h = hoje(), mesAtual = h.slice(0, 7), em7 = addDias(h, 7);
    const abertas = todas.filter((c) => c.status !== "pago");
    const soma = (l) => arred(l.reduce((s, c) => s + c.valor, 0));
    const vencidas = abertas.filter((c) => c.vencimento < h);
    const prox7 = abertas.filter((c) => c.vencimento >= h && c.vencimento <= em7);
    const feitasMes = todas.filter((c) => c.status === "pago" && (c.pagoEm || "").slice(0, 7) === mesAtual);

    let lista = todas.filter((c) => {
      const sit = situacao(c);
      if (est.status === "abertas" && c.status === "pago") return false;
      if (est.status === "vencidas" && sit !== "vencida") return false;
      if (est.status === "pendentes" && !(sit === "pendente" || sit === "hoje")) return false;
      if (est.status === "pagas" && c.status !== "pago") return false;
      if (est.mes && c.vencimento.slice(0, 7) !== est.mes) return false;
      if (est.busca) {
        const t = est.busca.toLowerCase();
        if (!`${c.descricao} ${c.parte || ""} ${c.categoria || ""}`.toLowerCase().includes(t)) return false;
      }
      return true;
    }).sort((a, b) => (est.status === "pagas" ? (b.pagoEm || "").localeCompare(a.pagoEm || "") : a.vencimento.localeCompare(b.vencimento)));

    $("#tab-" + tipo).innerHTML = `
      <div class="cab"><h1>${cfg.titulo}</h1><button class="btn" data-nova><i class="fa-solid fa-plus"></i> Nova conta</button></div>
      <div class="seg" id="seg-${tipo}" style="margin-bottom:14px">
        <button type="button" data-escopo="empresa" class="${est.escopo === "empresa" ? "ativo" : ""}"><i class="fa-solid fa-building"></i> Empresa</button>
        <button type="button" data-escopo="pessoal" class="${est.escopo === "pessoal" ? "ativo" : ""}"><i class="fa-solid fa-user"></i> Pessoal</button>
      </div>
      <div class="kpis">
        <div class="kpi"><span>Em aberto (${abertas.length})</span><strong>${moeda(soma(abertas))}</strong></div>
        <div class="kpi"><span>Vencidas (${vencidas.length})</span><strong style="color:${vencidas.length ? "var(--erro)" : "inherit"}">${moeda(soma(vencidas))}</strong></div>
        <div class="kpi"><span>Próximos 7 dias (${prox7.length})</span><strong>${moeda(soma(prox7))}</strong></div>
        <div class="kpi"><span>${cfg.feitoNoMes}</span><strong>${moeda(arred(feitasMes.reduce((s, c) => s + (c.valorPago ?? c.valor), 0)))}</strong></div>
      </div>
      <div class="filtros">
        <select id="f-status-${tipo}">
          ${[["abertas", "Em aberto"], ["vencidas", "Vencidas"], ["pendentes", "A vencer"], ["pagas", cfg.feito + "s"], ["todas", "Todas"]].map(([v, n]) => `<option value="${v}" ${est.status === v ? "selected" : ""}>${n}</option>`).join("")}
        </select>
        <input type="month" id="f-mes-${tipo}" value="${est.mes}" title="Mês de vencimento" />
        <input id="f-busca-${tipo}" placeholder="Buscar descrição, ${tipo === "pagar" ? "fornecedor" : "cliente"} ou categoria..." value="${esc(est.busca)}" style="min-width:260px" />
      </div>
      <table><thead><tr><th>Vencimento</th><th>Descrição</th><th>${tipo === "pagar" ? "Fornecedor" : "Cliente"}</th><th>Categoria</th><th>Valor</th><th>Situação</th><th></th></tr></thead><tbody>
      ${lista.map((c) => {
        const sit = situacao(c);
        return `<tr>
          <td>${dataCurta(c.vencimento)}</td><td>${esc(c.descricao)}${c.origem === "pdv" ? ' <small class="dica">(PDV)</small>' : ""}</td>
          <td>${esc(c.parte || "—")}</td><td>${esc(c.categoria || "—")}</td>
          <td>${moeda(c.valor)}${c.status === "pago" && c.valorPago != null && c.valorPago !== c.valor ? `<br><small class="dica">${cfg.feito.toLowerCase()}: ${moeda(c.valorPago)}</small>` : ""}</td>
          <td><span class="status ${CLASSE_SIT[sit]}">${sit === "pago" ? cfg.feito + (c.pagoEm ? " " + dataCurta(c.pagoEm) : "") : ROTULO_SIT[sit]}</span></td>
          <td class="acoes">
            ${c.status === "pago"
              ? `<button class="btn sec peq" data-desfazer="${c.id}">Desfazer</button>`
              : `<button class="btn peq" data-baixar="${c.id}">${cfg.acao}</button>`}
            <button class="btn sec peq" data-edit="${c.id}">Editar</button>
            <button class="btn perigo peq" data-del="${c.id}">Excluir</button></td></tr>`;
      }).join("") || `<tr><td colspan="7" class="vazio">Nenhuma conta encontrada.</td></tr>`}
      </tbody>${lista.length ? `<tfoot><tr><td colspan="4"><b>Total da lista (${lista.length})</b></td><td colspan="3"><b>${moeda(soma(lista))}</b></td></tr></tfoot>` : ""}</table>`;

    const raiz = $("#tab-" + tipo);
    raiz.querySelector("[data-nova]").onclick = () => formConta(tipo);
    $("#seg-" + tipo).onclick = (e) => { const b = e.target.closest("[data-escopo]"); if (b) { est.escopo = b.dataset.escopo; A.telas[tipo](); } };
    $("#f-status-" + tipo).onchange = (e) => { est.status = e.target.value; A.telas[tipo](); };
    $("#f-mes-" + tipo).onchange = (e) => { est.mes = e.target.value; A.telas[tipo](); };
    const busca = $("#f-busca-" + tipo);
    busca.oninput = () => {
      est.busca = busca.value;
      clearTimeout(busca._t);
      busca._t = setTimeout(async () => { await A.telas[tipo](); const n = $("#f-busca-" + tipo); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 350);
    };
    raiz.onclick = (e) => {
      const b = e.target.closest("[data-baixar]"), ed = e.target.closest("[data-edit]"), del = e.target.closest("[data-del]"), des = e.target.closest("[data-desfazer]");
      const achar = (id) => todas.find((c) => c.id === id);
      if (b) baixar(tipo, achar(b.dataset.baixar));
      if (ed) formConta(tipo, achar(ed.dataset.edit));
      if (des) desfazer(tipo, achar(des.dataset.desfazer));
      if (del) excluir(tipo, achar(del.dataset.del));
    };
  };

  // ---------- Ações ----------
  const baixar = (tipo, c) => {
    const cfg = CONFIG[tipo];
    abrirModal(`${cfg.acao}: ${c.descricao}`, `
      <div class="detalhe"><p>Vencimento ${dataCurta(c.vencimento)} · valor ${moeda(c.valor)}${c.parte ? ` · ${esc(c.parte)}` : ""}</p></div>
      <div class="grid2">
        <label>Data do ${tipo === "pagar" ? "pagamento" : "recebimento"}<input name="data" type="date" value="${hoje()}" required /></label>
        <label>Valor ${tipo === "pagar" ? "pago" : "recebido"} (R$)<input name="valor" type="number" min="0.01" step="0.01" value="${c.valor}" required /></label>
      </div>
      <p class="dica">Altere o valor se houve juros, multa ou desconto.</p>`,
      async (d) => {
        const valorPago = parseFloat(d.valor);
        if (!(valorPago > 0)) return false;
        if (!(await tentar(() => DB.contas.salvar({ ...c, status: "pago", pagoEm: d.data, valorPago })))) return false;
        toast(`${cfg.feito} registrado`); A.telas[tipo](); A.atualizarPillVencidas();
      }, { salvar: cfg.acao });
  };
  const desfazer = async (tipo, c) => {
    if (!confirm("Voltar esta conta para em aberto?")) return;
    if (await tentar(() => DB.contas.salvar({ ...c, status: "pendente", pagoEm: null, valorPago: null }))) { A.telas[tipo](); A.atualizarPillVencidas(); }
  };
  const excluir = async (tipo, c) => {
    if (!confirm(`Excluir a conta "${c.descricao}"?`)) return;
    if (await tentar(() => DB.contas.remover(c.id))) { toast("Conta excluída"); A.telas[tipo](); A.atualizarPillVencidas(); }
  };

  const formConta = (tipo, c) => {
    const cfg = CONFIG[tipo], est = estado[tipo];
    const nova = !c;
    c = c || { descricao: "", valor: "", vencimento: hoje(), categoria: "", parte: "", obs: "", escopo: est.escopo };
    abrirModal(nova ? `Nova conta — ${cfg.titulo.toLowerCase()}` : "Editar conta", `
      <label>Descrição<input name="descricao" value="${esc(c.descricao)}" required /></label>
      <div class="grid2">
        <label>Valor (R$)<input name="valor" type="number" min="0.01" step="0.01" value="${c.valor}" required /></label>
        <label>Vencimento<input name="vencimento" type="date" value="${c.vencimento}" required /></label>
      </div>
      <div class="grid2">
        <label>Conta<select name="escopo" id="ct-escopo"><option value="empresa" ${c.escopo === "empresa" ? "selected" : ""}>Empresa</option><option value="pessoal" ${c.escopo === "pessoal" ? "selected" : ""}>Pessoal</option></select></label>
        <label>Categoria<input name="categoria" id="ct-cat" list="ct-cats" value="${esc(c.categoria || "")}" autocomplete="off" /><datalist id="ct-cats"></datalist></label>
      </div>
      <label>${cfg.parte}<input name="parte" value="${esc(c.parte || "")}" /></label>
      <label>Observações<input name="obs" value="${esc(c.obs || "")}" /></label>
      ${nova ? `<label>Repetir (nº de parcelas / meses)<input name="parcelas" type="number" min="1" max="60" step="1" value="1" /></label>
        <p class="dica">Com mais de 1, são criadas contas mensais com o mesmo valor (ex.: aluguel, parcelamentos). A descrição ganha "(1/12)", "(2/12)"...</p>` : ""}`,
      async (d) => {
        const base = { ...c, tipo, descricao: d.descricao.trim(), valor: parseFloat(d.valor), vencimento: d.vencimento, escopo: d.escopo, categoria: d.categoria.trim(), parte: d.parte.trim(), obs: d.obs.trim() };
        if (!(base.valor > 0)) return false;
        const n = nova ? Math.min(60, Math.max(1, parseInt(d.parcelas, 10) || 1)) : 1;
        const ok = await tentar(async () => {
          if (nova) {
            base.status = "pendente"; base.criadoEm = new Date().toISOString();
            const grupoId = n > 1 ? DB.fs.collection("contas").doc().id : null;
            const lote = DB.fs.batch();
            for (let i = 0; i < n; i++) {
              const ref = DB.fs.collection("contas").doc();
              lote.set(ref, JSON.parse(JSON.stringify({
                ...base, grupoId, descricao: n > 1 ? `${base.descricao} (${i + 1}/${n})` : base.descricao, vencimento: addMeses(base.vencimento, i),
              })));
            }
            await lote.commit();
          } else {
            await DB.contas.salvar(base);
          }
        });
        if (!ok) return false;
        est.escopo = base.escopo;
        toast(n > 1 ? `${n} contas criadas` : "Conta salva"); A.telas[tipo](); A.atualizarPillVencidas();
      });
    const preencherCats = () => {
      $("#ct-cats").innerHTML = CONFIG[tipo].categorias[$("#ct-escopo").value].map((x) => `<option value="${esc(x)}">`).join("");
    };
    $("#ct-escopo").onchange = preencherCats;
    preencherCats();
  };

  // ---------- Registro das telas e aviso de vencidas ----------
  A.telas.pagar = tela("pagar");
  A.telas.receber = tela("receber");

  A.atualizarPillVencidas = async () => {
    try {
      const snap = await DB.fs.collection("contas").where("tipo", "==", "pagar").where("status", "==", "pendente").get();
      const h = hoje();
      const n = snap.docs.filter((d) => d.data().vencimento < h).length;
      $("#pill-vencidas").hidden = n === 0;
      $("#pill-vencidas").textContent = n;
    } catch { /* ignorado */ }
  };
});
