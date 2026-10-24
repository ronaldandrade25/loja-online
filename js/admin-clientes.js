// Cadastro de clientes. O formulário (A.formCliente) também é usado pelo PDV para cadastrar na hora.
window.Admin.modulos.push((A) => {
  const { $, toast, tentar, abrirModal, carregando } = A;
  const { moeda, esc } = DB;
  let busca = "";

  // Abre o formulário no modal. `depois(clienteSalvo)` é chamado após salvar.
  A.formCliente = (c, depois, inicial) => {
    const nova = !c;
    c = c || { nome: "", telefone: "", documento: "", email: "", endereco: "", obs: "", ...(inicial || {}) };
    abrirModal(nova ? "Novo cliente" : "Editar cliente", `
      <label>Nome<input name="nome" value="${esc(c.nome)}" required autocomplete="off" /></label>
      <div class="grid2">
        <label>Telefone / WhatsApp<input name="telefone" type="tel" value="${esc(c.telefone || "")}" placeholder="(81) 99999-9999" /></label>
        <label>CPF / CNPJ<input name="documento" value="${esc(c.documento || "")}" /></label>
      </div>
      <label>E-mail<input name="email" type="email" value="${esc(c.email || "")}" /></label>
      <label>Endereço<input name="endereco" value="${esc(c.endereco || "")}" /></label>
      <label>Observações<input name="obs" value="${esc(c.obs || "")}" /></label>`,
      async (d) => {
        const nome = d.nome.trim();
        if (!nome) return false;
        const outros = await DB.clientes.listar();
        if (outros.some((x) => x.id !== c.id && x.nome.trim().toLowerCase() === nome.toLowerCase())) {
          toast("Já existe um cliente com esse nome"); return false;
        }
        let salvo = null;
        const ok = await tentar(async () => {
          salvo = await DB.clientes.salvar({
            ...c, nome, telefone: d.telefone.trim(), documento: d.documento.trim(), email: d.email.trim(), endereco: d.endereco.trim(), obs: d.obs.trim(),
            criadoEm: c.criadoEm || new Date().toISOString(),
          });
        });
        if (!ok) return false;
        toast("Cliente salvo");
        if (depois) setTimeout(() => depois(salvo), 0); // depois que o modal fechar
      }, { salvar: "Salvar cliente" });
  };

  // Clientes que compraram pelo site e ainda não estão cadastrados entram sozinhos na aba Clientes.
  // Roda ao entrar no painel, quando chega pedido novo e ao abrir a aba. Só olha pedidos criados depois
  // da última sincronização (assim um cliente excluído não volta sozinho). Já cadastrado = mesmo telefone ou mesmo nome.
  let sincronizando = null;
  const digitos = (s) => String(s || "").replace(/D/g, "");
  A.sincronizarClientes = () => {
    if (!sincronizando) sincronizando = (async () => {
      try {
        const ref = DB.fs.collection("configuracoes").doc("contadores");
        const marca = ((await ref.get()).data() || {}).clientesSyncEm || "";
        const novos = (await DB.pedidos.listar()).filter((p) => p.criadoEm && p.criadoEm > marca && p.cliente && (p.cliente.nome || "").trim())
          .sort((a, b) => a.criadoEm.localeCompare(b.criadoEm));
        if (!novos.length) return 0;
        const existentes = await DB.clientes.listar();
        const fones = new Set(existentes.map((x) => digitos(x.telefone)).filter((d) => d.length >= 8));
        const nomes = new Set(existentes.map((x) => (x.nome || "").trim().toLowerCase()));
        let criados = 0;
        for (const p of novos) {
          const nome = p.cliente.nome.trim(), fone = digitos(p.cliente.telefone);
          if ((fone.length >= 8 && fones.has(fone)) || nomes.has(nome.toLowerCase())) continue;
          await DB.clientes.salvar({
            nome, telefone: (p.cliente.telefone || "").trim(), documento: p.cliente.cpf || "", email: p.cliente.email || "",
            endereco: p.tipo === "entrega" ? p.endereco || "" : "", obs: "Cadastrado automaticamente pelo pedido " + p.codigo,
            origem: "site", criadoEm: p.criadoEm,
          });
          if (fone.length >= 8) fones.add(fone);
          nomes.add(nome.toLowerCase());
          criados++;
        }
        await ref.set({ clientesSyncEm: novos[novos.length - 1].criadoEm }, { merge: true });
        return criados;
      } catch (e) { console.error("sincronizar clientes:", e); return 0; }
      finally { sincronizando = null; }
    })();
    return sincronizando;
  };
  const aoEntrarAnterior = A.aoEntrar;
  A.aoEntrar = async () => { if (aoEntrarAnterior) await aoEntrarAnterior(); A.sincronizarClientes(); };

  A.telas.clientes = async () => {
    carregando("clientes");
    await A.sincronizarClientes();
    const [clientes, contas] = await Promise.all([DB.clientes.listar(), DB.contas.listar()]);
    const aberto = {};
    contas.filter((x) => x.tipo === "receber" && x.status !== "pago" && x.clienteId).forEach((x) => { aberto[x.clienteId] = (aberto[x.clienteId] || 0) + x.valor; });
    const t = busca.toLowerCase();
    const lista = clientes
      .filter((c) => !t || `${c.nome} ${c.telefone || ""} ${c.documento || ""} ${c.email || ""}`.toLowerCase().includes(t))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

    $("#tab-clientes").innerHTML = `
      <div class="cab"><h1>Clientes</h1><button class="btn" id="novo-cliente"><i class="fa-solid fa-user-plus"></i> Novo cliente</button></div>
      <div class="filtros"><input id="busca-cliente" placeholder="Buscar por nome, telefone, CPF/CNPJ ou e-mail..." value="${esc(busca)}" style="min-width:300px" /></div>
      <table class="tabela-cartoes"><thead><tr><th>Nome</th><th>Telefone</th><th>CPF / CNPJ</th><th>E-mail</th><th>A receber (em aberto)</th><th></th></tr></thead><tbody>
      ${lista.map((c) => {
        const fone = (c.telefone || "").replace(/\D/g, "");
        const inicial = esc((c.nome.trim()[0] || "?").toUpperCase());
        return `<tr>
          <td data-label="Nome"><span class="avatar-cli" aria-hidden="true">${inicial}</span><span class="cli-nome"><b>${esc(c.nome)}</b>${c.obs ? `<small class="dica">${esc(c.obs)}</small>` : ""}</span></td>
          <td data-label="Telefone">${c.telefone ? `<a class="cli-link" href="tel:${esc(fone)}">${esc(c.telefone)}</a>` : "—"}</td>
          <td data-label="CPF / CNPJ">${esc(c.documento || "—")}</td>
          <td data-label="E-mail">${c.email ? `<a class="cli-link" href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : "—"}</td>
          <td data-label="A receber">${aberto[c.id] ? `<b class="cli-devendo">${moeda(aberto[c.id])}</b>` : "—"}</td>
          <td class="acoes">
            ${fone ? `<a class="btn sec peq" target="_blank" rel="noopener" href="https://wa.me/${fone.length > 11 ? fone : "55" + fone}" aria-label="Abrir WhatsApp de ${esc(c.nome)}"><i class="fab fa-whatsapp"></i> WhatsApp</a>` : ""}
            <button class="btn sec peq" data-edit="${c.id}">Editar</button>
            <button class="btn perigo peq" data-del="${c.id}">Excluir</button></td></tr>`;
      }).join("") || `<tr><td colspan="6" class="vazio">${clientes.length ? "Nenhum cliente encontrado." : "Nenhum cliente cadastrado."}</td></tr>`}
      </tbody></table>`;

    $("#novo-cliente").onclick = () => A.formCliente(null, () => A.telas.clientes());
    const b = $("#busca-cliente");
    b.oninput = () => {
      busca = b.value;
      clearTimeout(b._t);
      b._t = setTimeout(async () => { await A.telas.clientes(); const n = $("#busca-cliente"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 300);
    };
    $("#tab-clientes").onclick = async (e) => {
      const ed = e.target.closest("[data-edit]"), del = e.target.closest("[data-del]");
      if (ed) A.formCliente(clientes.find((c) => c.id === ed.dataset.edit), () => A.telas.clientes());
      if (del) {
        const c = clientes.find((x) => x.id === del.dataset.del);
        const msg = aberto[c.id] ? `${c.nome} tem ${moeda(aberto[c.id])} em contas a receber. As contas continuam existindo, mas sem vínculo com o cadastro. Excluir mesmo assim?` : `Excluir o cliente "${c.nome}"?`;
        if (confirm(msg) && (await tentar(() => DB.clientes.remover(c.id)))) { toast("Cliente excluído"); A.telas.clientes(); }
      }
    };
  };
});
