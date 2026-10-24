// Relatórios: vendas (PDV + loja online) e financeiro (contas), com comparação ao período anterior.
// Todos os gráficos são SVG/HTML próprios (sem bibliotecas) e têm tabela equivalente em "Ver tabela".
window.Admin.modulos.push((A) => {
  const { $, toast, carregando } = A;
  const { moeda, esc } = DB;

  const filtro = { periodo: "30", de: "", ate: "", escopo: "empresa" };
  const DIAS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
  const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

  // "Fiado" é o nome antigo da forma "A prazo" (vendas já gravadas continuam válidas)
  const ehPrazo = (forma) => forma === "A prazo" || forma === "Fiado";
  const pad = (n) => String(n).padStart(2, "0");
  const isoDia = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const dia0 = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const fimDoDia = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  const addDias = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const dataDeIso = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d, 12); };
  const arred = (v) => Math.round(v * 100) / 100;
  const curta = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
  const compacto = (v) => (v >= 1000 ? (v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " mil" : String(Math.round(v)));
  const maximoBonito = (max) => {
    if (max <= 0) return 100;
    const e = Math.pow(10, Math.floor(Math.log10(max))), f = max / e;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e;
  };

  // ---------- Período ----------
  const calcularPeriodo = () => {
    const h = dia0(new Date());
    let ini = h, fim = h;
    switch (filtro.periodo) {
      case "hoje": break;
      case "7": ini = addDias(h, -6); break;
      case "30": ini = addDias(h, -29); break;
      case "90": ini = addDias(h, -89); break;
      case "mes": ini = new Date(h.getFullYear(), h.getMonth(), 1); break;
      case "mesAnt": ini = new Date(h.getFullYear(), h.getMonth() - 1, 1); fim = new Date(h.getFullYear(), h.getMonth(), 0); break;
      case "ano": ini = new Date(h.getFullYear(), 0, 1); break;
      case "custom": {
        const a = filtro.de ? dataDeIso(filtro.de) : addDias(h, -29), b = filtro.ate ? dataDeIso(filtro.ate) : h;
        ini = dia0(a <= b ? a : b); fim = dia0(a <= b ? b : a);
        break;
      }
    }
    const dias = Math.round((fim - ini) / 86400000) + 1;
    const antFim = addDias(ini, -1), antIni = addDias(antFim, -(dias - 1));
    return { ini, fim: fimDoDia(fim), dias, antIni, antFim: fimDoDia(antFim) };
  };

  // ---------- Tela ----------
  A.telas.relatorios = async () => {
    const painel = $("#tab-relatorios");
    if (!$("#rel-corpo")) {
      painel.innerHTML = `
        <div class="cab"><h1>Relatórios</h1>
          <div class="barra-acoes no-print">
            <button class="btn sec peq" id="rel-csv-vendas"><i class="fa-solid fa-file-csv"></i> CSV vendas</button>
            <button class="btn sec peq" id="rel-csv-contas"><i class="fa-solid fa-file-csv"></i> CSV contas</button>
            <button class="btn peq" id="rel-imprimir"><i class="fa-solid fa-print"></i> Imprimir / PDF</button>
          </div>
        </div>
        <div class="filtros no-print" id="rel-filtros">
          <select id="rel-periodo">
            ${[["hoje", "Hoje"], ["7", "Últimos 7 dias"], ["30", "Últimos 30 dias"], ["90", "Últimos 90 dias"], ["mes", "Este mês"], ["mesAnt", "Mês anterior"], ["ano", "Este ano"], ["custom", "Personalizado"]]
              .map(([v, n]) => `<option value="${v}" ${filtro.periodo === v ? "selected" : ""}>${n}</option>`).join("")}
          </select>
          <input type="date" id="rel-de" value="${filtro.de}" ${filtro.periodo === "custom" ? "" : "hidden"} />
          <input type="date" id="rel-ate" value="${filtro.ate}" ${filtro.periodo === "custom" ? "" : "hidden"} />
          <select id="rel-escopo" title="Contas consideradas no financeiro">
            ${[["empresa", "Contas: Empresa"], ["pessoal", "Contas: Pessoal"], ["ambos", "Contas: Empresa + Pessoal"]].map(([v, n]) => `<option value="${v}" ${filtro.escopo === v ? "selected" : ""}>${n}</option>`).join("")}
          </select>
        </div>
        <div id="rel-corpo"></div>`;
      $("#rel-periodo").onchange = (e) => {
        filtro.periodo = e.target.value;
        $("#rel-de").hidden = $("#rel-ate").hidden = filtro.periodo !== "custom";
        gerar();
      };
      $("#rel-de").onchange = (e) => { filtro.de = e.target.value; gerar(); };
      $("#rel-ate").onchange = (e) => { filtro.ate = e.target.value; gerar(); };
      $("#rel-escopo").onchange = (e) => { filtro.escopo = e.target.value; gerar(); };
      $("#rel-imprimir").onclick = () => window.print();
      $("#rel-csv-vendas").onclick = () => exportar("vendas");
      $("#rel-csv-contas").onclick = () => exportar("contas");
    }
    await gerar();
  };

  let ultimo = null; // dados do último relatório (para exportar CSV)

  const gerar = async () => {
    const corpo = $("#rel-corpo");
    corpo.style.opacity = ".5"; // mantém o conteúdo anterior enquanto recarrega
    if (!corpo.innerHTML) corpo.innerHTML = `<p class="vazio">Carregando...</p>`;
    try {
      const p = calcularPeriodo();
      const [vendas, pedidos, contas, produtos, categorias] = await Promise.all([
        DB.vendas.listarEntre("criadoEm", p.antIni.toISOString(), p.fim.toISOString()),
        DB.pedidos.listarEntre("criadoEm", p.antIni.toISOString(), p.fim.toISOString()),
        DB.contas.listar(), DB.produtos.listar(), DB.categorias.listar(),
      ]);
      ultimo = { p, dados: preparar(p, vendas, pedidos, contas, produtos, categorias) };
      corpo.innerHTML = montar(ultimo.p, ultimo.dados);
    } catch (e) {
      console.error(e);
      corpo.innerHTML = `<p class="vazio">Não foi possível gerar o relatório. Verifique as regras do Firestore e sua permissão de admin.</p>`;
    }
    corpo.style.opacity = "";
  };

  // ---------- Preparação dos dados ----------
  const preparar = (p, vendas, pedidos, contas, produtos, categorias) => {
    const prod = Object.fromEntries(produtos.map((x) => [x.id, x]));
    const catNome = Object.fromEntries(categorias.map((c) => [c.id, c.nome]));
    const normItens = (itens) => itens.map((i) => ({
      id: i.id, nome: i.nome, variante: i.variante || "", preco: i.preco, qtd: i.qtd,
      custo: i.custo ?? prod[i.id]?.custo ?? null,
      categoria: catNome[prod[i.id]?.categoria] || "Sem categoria",
    }));
    const registros = [
      ...vendas.filter((v) => v.status !== "cancelada").map((v) => ({
        origem: "PDV", ref: "#" + v.numero, data: new Date(v.criadoEm), total: v.total, desconto: v.desconto || 0, cliente: v.cliente || "",
        itens: normItens(v.itens), pagamentos: v.pagamentos,
      })),
      ...pedidos.filter((o) => o.status !== "cancelado").map((o) => ({
        origem: "Loja online", ref: "#" + o.codigo, data: new Date(o.criadoEm), total: o.total, desconto: o.desconto || 0, cliente: o.cliente?.nome || "",
        itens: normItens(o.itens), pagamentos: [{ forma: o.pagamento, valor: o.total }],
      })),
    ];
    const noPeriodo = (r, ini, fim) => r.data >= ini && r.data <= fim;
    const atual = registros.filter((r) => noPeriodo(r, p.ini, p.fim));
    const anterior = registros.filter((r) => noPeriodo(r, p.antIni, p.antFim));

    const escopoOk = (c) => filtro.escopo === "ambos" || c.escopo === filtro.escopo;
    const empresaOk = filtro.escopo === "empresa" || filtro.escopo === "ambos";
    const baixadasEntre = (tipo, ini, fim, soEmpresa) => contas.filter((c) =>
      c.tipo === tipo && c.status === "pago" && c.pagoEm && (soEmpresa ? c.escopo === "empresa" : escopoOk(c)) &&
      dataDeIso(c.pagoEm) >= ini && dataDeIso(c.pagoEm) <= fim);
    const valorConta = (c) => c.valorPago ?? c.valor;

    const metricas = (regs, ini, fim) => {
      const receita = arred(regs.reduce((s, r) => s + r.total, 0));
      const qtd = regs.length;
      let lucro = 0, base = 0, baseComCusto = 0;
      regs.forEach((r) => {
        lucro -= r.desconto;
        r.itens.forEach((i) => {
          base += i.preco * i.qtd;
          if (i.custo != null) { lucro += (i.preco - i.custo) * i.qtd; baseComCusto += i.preco * i.qtd; }
        });
      });
      const vendasCaixa = empresaOk ? regs.reduce((s, r) => s + r.pagamentos.filter((x) => !ehPrazo(x.forma)).reduce((a, x) => a + x.valor, 0), 0) : 0;
      const recebidas = baixadasEntre("receber", ini, fim).reduce((s, c) => s + valorConta(c), 0);
      const saidas = baixadasEntre("pagar", ini, fim).reduce((s, c) => s + valorConta(c), 0);
      const despesasEmpresa = baixadasEntre("pagar", ini, fim, true).reduce((s, c) => s + valorConta(c), 0);
      const entradas = vendasCaixa + recebidas;
      return {
        receita, qtd, ticket: qtd ? receita / qtd : 0, lucro: arred(lucro), cobertura: base ? baseComCusto / base : 1,
        entradas: arred(entradas), saidas: arred(saidas), saldo: arred(entradas - saidas), lucroLiquido: arred(lucro - despesasEmpresa),
      };
    };
    const m = metricas(atual, p.ini, p.fim), ant = metricas(anterior, p.antIni, p.antFim);

    // ---- Séries no tempo ----
    const gran = p.dias <= 31 ? "dia" : p.dias <= 120 ? "semana" : "mes";
    const chaveDe = (d) => {
      if (gran === "dia") return isoDia(d);
      if (gran === "mes") return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
      return isoDia(addDias(dia0(d), -((d.getDay() + 6) % 7)));
    };
    const baldes = [];
    let cur = gran === "mes" ? new Date(p.ini.getFullYear(), p.ini.getMonth(), 1) : gran === "semana" ? addDias(p.ini, -((p.ini.getDay() + 6) % 7)) : p.ini;
    while (cur <= p.fim) {
      baldes.push({ chave: chaveDe(cur), rotulo: gran === "mes" ? `${MESES[cur.getMonth()]}/${String(cur.getFullYear()).slice(2)}` : curta(cur), data: new Date(cur) });
      cur = gran === "mes" ? new Date(cur.getFullYear(), cur.getMonth() + 1, 1) : addDias(cur, gran === "semana" ? 7 : 1);
    }
    const idx = new Map(baldes.map((b, i) => [b.chave, i]));
    const serie = () => baldes.map(() => 0);
    const somar = (arr, data, v) => { const i = idx.get(chaveDe(data)); if (i != null) arr[i] += v; };

    const sEntradas = serie(), sSaidas = serie(), sPdv = serie(), sOnline = serie();
    atual.forEach((r) => {
      somar(r.origem === "PDV" ? sPdv : sOnline, r.data, r.total);
      if (empresaOk) somar(sEntradas, r.data, r.pagamentos.filter((x) => !ehPrazo(x.forma)).reduce((a, x) => a + x.valor, 0));
    });
    baixadasEntre("receber", p.ini, p.fim).forEach((c) => somar(sEntradas, dataDeIso(c.pagoEm), valorConta(c)));
    baixadasEntre("pagar", p.ini, p.fim).forEach((c) => somar(sSaidas, dataDeIso(c.pagoEm), valorConta(c)));

    // ---- Quebras ----
    const agrupar = (fn) => { const o = {}; fn(o); return Object.entries(o).map(([rotulo, v]) => ({ rotulo, ...v })).sort((a, b) => b.valor - a.valor); };
    const porForma = agrupar((o) => atual.forEach((r) => r.pagamentos.forEach((x) => { o[x.forma] = o[x.forma] || { valor: 0, qtd: 0 }; o[x.forma].valor += x.valor; o[x.forma].qtd++; })));
    const porCategoria = agrupar((o) => atual.forEach((r) => r.itens.forEach((i) => { o[i.categoria] = o[i.categoria] || { valor: 0, qtd: 0 }; o[i.categoria].valor += i.preco * i.qtd; o[i.categoria].qtd += i.qtd; })));
    const porProduto = agrupar((o) => atual.forEach((r) => r.itens.forEach((i) => { const k = i.nome; o[k] = o[k] || { valor: 0, qtd: 0 }; o[k].valor += i.preco * i.qtd; o[k].qtd += i.qtd; })));
    const despesasCat = agrupar((o) => baixadasEntre("pagar", p.ini, p.fim).forEach((c) => { const k = c.categoria || "Sem categoria"; o[k] = o[k] || { valor: 0, qtd: 0 }; o[k].valor += valorConta(c); o[k].qtd++; }));

    // ---- Mapa de calor: dia da semana × hora ----
    const calor = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ valor: 0, qtd: 0 })));
    atual.forEach((r) => { const c = calor[(r.data.getDay() + 6) % 7][r.data.getHours()]; c.valor += r.total; c.qtd++; });

    // ---- Projeção de contas em aberto (próximas 8 semanas) ----
    const h = dia0(new Date());
    const semanas = ["Vencidas", ...Array.from({ length: 8 }, (_, i) => curta(addDias(h, i * 7)))];
    const projReceber = semanas.map(() => 0), projPagar = semanas.map(() => 0);
    contas.filter((c) => c.status !== "pago" && escopoOk(c)).forEach((c) => {
      const v = dataDeIso(c.vencimento);
      const dif = Math.floor((dia0(v) - h) / 86400000);
      const i = dif < 0 ? 0 : Math.floor(dif / 7) + 1;
      if (i >= semanas.length) return;
      (c.tipo === "receber" ? projReceber : projPagar)[i] += c.valor;
    });
    const abertas = contas.filter((c) => c.status !== "pago" && escopoOk(c));
    const aberto = (tipo) => arred(abertas.filter((c) => c.tipo === tipo).reduce((s, c) => s + c.valor, 0));
    const vencidoPagar = arred(abertas.filter((c) => c.tipo === "pagar" && dataDeIso(c.vencimento) < h).reduce((s, c) => s + c.valor, 0));

    return {
      m, ant, gran, baldes, sEntradas, sSaidas, sPdv, sOnline, porForma, porCategoria, porProduto, despesasCat, calor, semanas, projReceber, projPagar,
      abertoReceber: aberto("receber"), abertoPagar: aberto("pagar"), vencidoPagar, atual, contasPeriodo: contas.filter(escopoOk),
      origem: { pdv: arred(sPdv.reduce((a, b) => a + b, 0)), online: arred(sOnline.reduce((a, b) => a + b, 0)) },
    };
  };

  // ---------- Componentes de gráfico ----------
  const delta = (cur, ant) => {
    if (!ant) return cur ? `<small class="delta">novo</small>` : `<small class="delta">—</small>`;
    const pct = ((cur - ant) / Math.abs(ant)) * 100;
    return `<small class="delta">${pct >= 0 ? "▲" : "▼"} ${Math.abs(pct).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}% vs. anterior</small>`;
  };
  const kpi = (rotulo, valor, extra = "", dica = "") => `<div class="kpi" ${dica ? `title="${esc(dica)}"` : ""}><span>${rotulo}</span><strong>${valor}</strong>${extra}</div>`;

  const tabela = (cab, linhas) => `<details class="g-tabela"><summary>Ver tabela</summary><table><thead><tr>${cab.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>
    ${linhas.map((l) => `<tr>${l.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${cab.length}" class="vazio">Sem dados no período.</td></tr>`}</tbody></table></details>`;

  const legenda = (itens) => `<div class="legenda">${itens.map(([cls, nome]) => `<span><i class="sw ${cls}"></i>${esc(nome)}</span>`).join("")}</div>`;

  const pathTopo = (x, y, w, h, r) => {
    r = Math.min(r, h, w / 2);
    return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
  };

  // Barras verticais, agrupadas ou empilhadas. series: [{ nome, cls, valores }]
  const barras = (rotulos, series, { empilhado = false, fmt = moeda, prefixo = "R$ " } = {}) => {
    const W = 720, H = 250, m = { l: 58, r: 10, t: 10, b: 30 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b, n = rotulos.length;
    const maxV = Math.max(0, ...rotulos.map((_, i) => (empilhado ? series.reduce((s, x) => s + x.valores[i], 0) : Math.max(...series.map((x) => x.valores[i])))));
    const topo = maximoBonito(maxV);
    const slot = iw / n;
    const passoX = Math.ceil(n / 8);
    const grade = [0, 0.5, 1].map((f) => {
      const y = m.t + ih - f * ih;
      return `<line x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}" class="g-grade${f === 0 ? " g-base" : ""}" /><text x="${m.l - 8}" y="${y + 4}" text-anchor="end" class="g-eixo">${f === 0 ? "0" : prefixo + compacto(topo * f)}</text>`;
    }).join("");
    const corpo = rotulos.map((rot, i) => {
      let marcas = "";
      if (empilhado) {
        const bw = Math.max(2, Math.min(slot - 2, 40)), x = m.l + i * slot + (slot - bw) / 2;
        let acc = 0;
        const visiveis = series.filter((s) => s.valores[i] > 0);
        series.forEach((s) => {
          const v = s.valores[i];
          if (v <= 0) return;
          const h = (v / topo) * ih, y = m.t + ih - ((acc + v) / topo) * ih;
          const ultimo = s === visiveis[visiveis.length - 1];
          marcas += ultimo ? `<path class="${s.cls}" d="${pathTopo(x, y, bw, h, 4)}" stroke="var(--card)" stroke-width="2" />` : `<rect class="${s.cls}" x="${x}" y="${y}" width="${bw}" height="${h}" stroke="var(--card)" stroke-width="2" />`;
          acc += v;
        });
      } else {
        const gw = Math.min(slot * 0.8, 28 * series.length), bw = (gw - 2 * (series.length - 1)) / series.length, x0 = m.l + i * slot + (slot - gw) / 2;
        series.forEach((s, k) => {
          const v = s.valores[i];
          if (v <= 0) return;
          const h = Math.max(1, (v / topo) * ih);
          marcas += `<path class="${s.cls}" d="${pathTopo(x0 + k * (bw + 2), m.t + ih - h, Math.max(2, bw), h, 4)}" />`;
        });
      }
      const tip = `${rot}\n` + series.map((s) => `${s.nome}: ${fmt(s.valores[i])}`).join("\n");
      const rotulo = i % passoX === 0 ? `<text x="${m.l + i * slot + slot / 2}" y="${H - 9}" text-anchor="middle" class="g-eixo">${esc(rot)}</text>` : "";
      return `${marcas}${rotulo}<rect class="g-hit" x="${m.l + i * slot}" y="${m.t}" width="${slot}" height="${ih}" data-tip="${esc(tip)}" />`;
    }).join("");
    return `${series.length > 1 ? legenda(series.map((s) => [s.cls, s.nome])) : ""}<div class="grafico"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(series.map((s) => s.nome).join(" e "))} por período">${grade}${corpo}</svg></div>`;
  };

  // Barras horizontais rotuladas (ranking). itens: [{ rotulo, valor, qtd }]
  const ranking = (itens, { max = 8, fmt = moeda, unidade = "" } = {}) => {
    let lista = itens.filter((i) => i.valor > 0);
    if (lista.length > max) {
      const resto = lista.slice(max - 1);
      lista = [...lista.slice(0, max - 1), { rotulo: `Outros (${resto.length})`, valor: resto.reduce((s, i) => s + i.valor, 0), qtd: resto.reduce((s, i) => s + (i.qtd || 0), 0) }];
    }
    if (!lista.length) return `<p class="vazio">Sem dados no período.</p>`;
    const topo = Math.max(...lista.map((i) => i.valor));
    const total = lista.reduce((s, i) => s + i.valor, 0);
    return `<div class="hb">${lista.map((i) => `
      <div class="hb-linha" data-tip="${esc(`${i.rotulo}\n${fmt(i.valor)} (${((i.valor / total) * 100).toFixed(0)}%)${i.qtd ? `\n${i.qtd}${unidade}` : ""}`)}">
        <span class="hb-rot">${esc(i.rotulo)}</span>
        <div class="hb-trilho"><div class="hb-barra" style="width:${Math.max(2, (i.valor / topo) * 100)}%"></div></div>
        <span class="hb-val">${fmt(i.valor)}</span>
      </div>`).join("")}</div>`;
  };

  // Mapa de calor dia da semana × hora (escala sequencial de um matiz, 5 degraus)
  const mapaCalor = (calor) => {
    let hMin = 24, hMax = -1, max = 0;
    calor.forEach((linha) => linha.forEach((c, h) => { if (c.qtd) { hMin = Math.min(hMin, h); hMax = Math.max(hMax, h); max = Math.max(max, c.valor); } }));
    if (hMax < 0) return `<p class="vazio">Sem vendas no período.</p>`;
    hMin = Math.min(hMin, 8); hMax = Math.max(hMax, 18);
    const horas = hMax - hMin + 1, L = 38, T = 4, cw = (720 - L - 6) / horas, ch = 26, W = 720, H = T + 7 * ch + 22;
    const degrau = (v) => (v <= 0 ? 0 : Math.min(5, Math.ceil((v / max) * 5)));
    let svg = "";
    calor.forEach((linha, d) => {
      svg += `<text x="${L - 6}" y="${T + d * ch + ch / 2 + 4}" text-anchor="end" class="g-eixo">${DIAS[d]}</text>`;
      for (let h = hMin; h <= hMax; h++) {
        const c = linha[h], g = degrau(c.valor);
        svg += `<rect class="cel c${g}" x="${L + (h - hMin) * cw + 1}" y="${T + d * ch + 1}" width="${cw - 2}" height="${ch - 2}" rx="4" data-tip="${esc(`${DIAS[d]}, ${pad(h)}h\n${c.qtd} venda(s)\n${moeda(c.valor)}`)}" />`;
      }
    });
    for (let h = hMin; h <= hMax; h += horas > 14 ? 2 : 1) svg += `<text x="${L + (h - hMin) * cw + cw / 2}" y="${H - 6}" text-anchor="middle" class="g-eixo">${pad(h)}h</text>`;
    return `<div class="grafico"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Receita por dia da semana e hora">${svg}</svg></div>
      <div class="escala"><span>menos</span>${[1, 2, 3, 4, 5].map((g) => `<i class="cel c${g}"></i>`).join("")}<span>mais</span></div>`;
  };

  A.graficos = { barras, ranking, tabela, legenda };

  // ---------- Montagem do relatório ----------
  const montar = (p, d) => {
    const { m, ant } = d;
    const periodoTxt = `${curta(p.ini)}/${p.ini.getFullYear()} a ${curta(p.fim)}/${p.fim.getFullYear()} (${p.dias} dia${p.dias > 1 ? "s" : ""})`;
    const gr = { dia: "por dia", semana: "por semana", mes: "por mês" }[d.gran];
    const fluxoTab = d.baldes.map((b, i) => [b.rotulo, moeda(d.sEntradas[i]), moeda(d.sSaidas[i]), moeda(d.sEntradas[i] - d.sSaidas[i])]);
    const origemTab = d.baldes.map((b, i) => [b.rotulo, moeda(d.sPdv[i]), moeda(d.sOnline[i]), moeda(d.sPdv[i] + d.sOnline[i])]);
    const totalOrigem = d.origem.pdv + d.origem.online;

    return `
      <p class="dica" style="margin-bottom:12px">Período: <b>${periodoTxt}</b> · comparado com ${curta(p.antIni)}/${p.antIni.getFullYear()} a ${curta(p.antFim)}/${p.antFim.getFullYear()}</p>
      <div class="kpis">
        ${kpi("Receita de vendas", moeda(m.receita), delta(m.receita, ant.receita), "PDV + loja online, sem cancelamentos")}
        ${kpi("Vendas", m.qtd, delta(m.qtd, ant.qtd))}
        ${kpi("Ticket médio", moeda(m.ticket), delta(m.ticket, ant.ticket))}
        ${kpi("Lucro bruto estimado", moeda(m.lucro), delta(m.lucro, ant.lucro) + (m.cobertura < 0.995 ? `<small class="delta">custo cadastrado em ${(m.cobertura * 100).toFixed(0)}% das vendas</small>` : ""), "Preço − custo dos produtos, menos descontos. Cadastre o custo em Produtos.")}
        ${kpi("Entradas", moeda(m.entradas), delta(m.entradas, ant.entradas), "Vendas recebidas (exceto a prazo) + contas a receber baixadas")}
        ${kpi("Saídas", moeda(m.saidas), delta(m.saidas, ant.saidas), "Contas a pagar baixadas no período")}
        ${kpi("Saldo do período", `<span style="color:${m.saldo < 0 ? "var(--erro)" : "inherit"}">${moeda(m.saldo)}</span>`, delta(m.saldo, ant.saldo))}
        ${kpi("Lucro após despesas (empresa)", `<span style="color:${m.lucroLiquido < 0 ? "var(--erro)" : "inherit"}">${moeda(m.lucroLiquido)}</span>`, delta(m.lucroLiquido, ant.lucroLiquido), "Lucro bruto estimado − despesas da empresa pagas no período")}
        ${kpi("A receber (em aberto)", moeda(d.abertoReceber))}
        ${kpi("A pagar (em aberto)", moeda(d.abertoPagar), d.vencidoPagar ? `<small class="delta" style="color:var(--erro)">${moeda(d.vencidoPagar)} vencido</small>` : "")}
      </div>

      <div class="rel-grid">
        <section class="painel cheio">
          <h3>Fluxo de caixa: entradas × saídas <small>(${gr})</small></h3>
          ${barras(d.baldes.map((b) => b.rotulo), [{ nome: "Entradas", cls: "s1", valores: d.sEntradas }, { nome: "Saídas", cls: "s2", valores: d.sSaidas }])}
          ${tabela(["Período", "Entradas", "Saídas", "Saldo"], fluxoTab)}
        </section>

        <section class="painel cheio">
          <h3>Receita de vendas por origem <small>(${gr})</small></h3>
          ${barras(d.baldes.map((b) => b.rotulo), [{ nome: "PDV", cls: "s1", valores: d.sPdv }, { nome: "Loja online", cls: "s2", valores: d.sOnline }], { empilhado: true })}
          <p class="dica">${totalOrigem ? `PDV ${((d.origem.pdv / totalOrigem) * 100).toFixed(0)}% · Loja online ${((d.origem.online / totalOrigem) * 100).toFixed(0)}% da receita no período.` : ""}</p>
          ${tabela(["Período", "PDV", "Loja online", "Total"], origemTab)}
        </section>

        <section class="painel">
          <h3>Formas de pagamento</h3>
          ${ranking(d.porForma, { unidade: " pagamento(s)" })}
          ${tabela(["Forma", "Valor", "Pagamentos"], d.porForma.map((i) => [i.rotulo, moeda(i.valor), i.qtd]))}
        </section>

        <section class="painel">
          <h3>Receita por categoria</h3>
          ${ranking(d.porCategoria, { unidade: " un." })}
          ${tabela(["Categoria", "Receita", "Unidades"], d.porCategoria.map((i) => [i.rotulo, moeda(i.valor), i.qtd]))}
        </section>

        <section class="painel">
          <h3>Produtos mais vendidos <small>(por receita)</small></h3>
          ${ranking(d.porProduto, { max: 10, unidade: " un." })}
          ${tabela(["Produto", "Receita", "Unidades"], d.porProduto.map((i) => [i.rotulo, moeda(i.valor), i.qtd]))}
        </section>

        <section class="painel">
          <h3>Despesas por categoria <small>(pagas no período)</small></h3>
          ${ranking(d.despesasCat, { unidade: " conta(s)" })}
          ${tabela(["Categoria", "Valor", "Contas"], d.despesasCat.map((i) => [i.rotulo, moeda(i.valor), i.qtd]))}
        </section>

        <section class="painel cheio">
          <h3>Horários de maior venda <small>(receita por dia da semana e hora)</small></h3>
          ${mapaCalor(d.calor)}
          ${tabela(["Dia", "Hora", "Vendas", "Receita"], d.calor.flatMap((linha, i) => linha.map((c, h) => [DIAS[i], pad(h) + "h", c.qtd, moeda(c.valor)]).filter((l) => l[2] > 0)))}
        </section>

        <section class="painel cheio">
          <h3>Projeção: contas em aberto nas próximas semanas</h3>
          ${barras(d.semanas, [{ nome: "A receber", cls: "s1", valores: d.projReceber }, { nome: "A pagar", cls: "s2", valores: d.projPagar }])}
          ${tabela(["Semana (início)", "A receber", "A pagar", "Saldo"], d.semanas.map((s, i) => [s, moeda(d.projReceber[i]), moeda(d.projPagar[i]), moeda(d.projReceber[i] - d.projPagar[i])]))}
        </section>
      </div>

      <details class="painel" style="margin-top:14px"><summary style="cursor:pointer"><b>Como os números são calculados</b></summary>
        <ul class="notas">
          <li><b>Receita de vendas:</b> soma das vendas do PDV e dos pedidos da loja online que não foram cancelados, na data em que foram feitos (inclui vendas a prazo e o frete dos pedidos online).</li>
          <li><b>Lucro bruto estimado:</b> (preço − custo) × quantidade dos itens, menos descontos. Só entra o que tem custo cadastrado em Produtos; o aviso mostra a cobertura.</li>
          <li><b>Entradas:</b> pagamentos recebidos nas vendas (exceto vendas a prazo, que só entram quando a conta a receber é baixada) + contas a receber baixadas no período. O filtro "Contas" define quais contas entram; as vendas contam como empresa.</li>
          <li><b>Saídas:</b> contas a pagar baixadas no período (pela data do pagamento).</li>
          <li><b>Lucro após despesas:</b> lucro bruto estimado − despesas da empresa pagas no período.</li>
          <li><b>Comparação:</b> com o período imediatamente anterior, de mesma duração.</li>
        </ul></details>`;
  };

  // ---------- Exportação CSV ----------
  const baixarCsv = (nome, linhas) => {
    const cel = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = "﻿" + linhas.map((l) => l.map(cel).join(";")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = nome;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const num = (v) => String(arred(v)).replace(".", ",");
  const exportar = (que) => {
    if (!ultimo) return toast("Gere o relatório primeiro");
    const { p, dados: d } = ultimo;
    const sufixo = `${isoDia(p.ini)}_a_${isoDia(p.fim)}`;
    if (que === "vendas") {
      const linhas = [["Data", "Origem", "Referência", "Cliente", "Produto", "Variação", "Categoria", "Qtd", "Preço unit.", "Total do item", "Custo unit."]];
      d.atual.forEach((r) => r.itens.forEach((i) => linhas.push([r.data.toLocaleString("pt-BR"), r.origem, r.ref, r.cliente, i.nome, i.variante, i.categoria, i.qtd, num(i.preco), num(i.preco * i.qtd), i.custo == null ? "" : num(i.custo)])));
      baixarCsv(`vendas_${sufixo}.csv`, linhas);
    } else {
      const linhas = [["Tipo", "Conta", "Descrição", "Parte", "Categoria", "Vencimento", "Valor", "Situação", "Data baixa", "Valor baixado"]];
      d.contasPeriodo.forEach((c) => linhas.push([c.tipo === "pagar" ? "A pagar" : "A receber", c.escopo, c.descricao, c.parte || "", c.categoria || "", c.vencimento.split("-").reverse().join("/"), num(c.valor), c.status === "pago" ? "Baixada" : "Em aberto", c.pagoEm ? c.pagoEm.split("-").reverse().join("/") : "", c.valorPago != null ? num(c.valorPago) : ""]));
      baixarCsv(`contas_${sufixo}.csv`, linhas);
    }
  };

  // ---------- Tooltip único para todas as marcas com data-tip ----------
  const tip = document.createElement("div");
  tip.className = "g-tip fixa";
  tip.hidden = true;
  document.body.appendChild(tip);
  document.addEventListener("mousemove", (e) => {
    const alvo = e.target.closest && e.target.closest("#tab-relatorios [data-tip], #tab-estoque [data-tip]");
    if (!alvo) { tip.hidden = true; return; }
    tip.textContent = alvo.dataset.tip; // textContent: rótulos vêm de dados do banco
    tip.hidden = false;
    const w = tip.offsetWidth;
    tip.style.left = Math.min(Math.max(e.clientX + 14, 8), window.innerWidth - w - 8) + "px";
    tip.style.top = Math.max(e.clientY - tip.offsetHeight - 10, 8) + "px";
  });
  document.addEventListener("scroll", () => { tip.hidden = true; }, true);
});
