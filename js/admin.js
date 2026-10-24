// Módulos extras (admin-pdv.js, admin-financeiro.js, admin-relatorios.js) se registram aqui
window.Admin = { telas: {}, modulos: [] };

document.addEventListener("DOMContentLoaded", () => {
  if (!DB.configurado) return;
  const { moeda, esc, auth } = DB;
  const $ = (s) => document.querySelector(s);
  const STATUS = ["novo", "confirmado", "enviado", "entregue", "cancelado"];
  const ROTULO = { novo: "Novo", confirmado: "Confirmado", enviado: "Enviado", entregue: "Entregue", cancelado: "Cancelado" };
  // Status em que o estoque já foi baixado
  const BAIXA_ESTOQUE = ["confirmado", "enviado", "entregue"];

  const toast = (msg) => {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove("show"), 2600);
  };
  const dataBR = (iso) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  // Executa uma operação do Firebase mostrando erro amigável
  const tentar = async (fn, msgErro = "Não foi possível concluir a operação") => {
    try { await fn(); return true; }
    catch (e) {
      console.error(e);
      if (e.silencioso) return false; // quem lançou o erro já avisou o usuário
      toast(e.code === "permission-denied" ? "Sem permissão (seu e-mail precisa estar em emailsAdmin() nas regras)" : msgErro);
      return false;
    }
  };

  // ---- Login (Firebase Auth) ----
  const mensagensAuth = {
    "auth/invalid-credential": "E-mail ou senha incorretos.",
    "auth/invalid-email": "E-mail inválido.",
    "auth/user-disabled": "Usuário desativado.",
    "auth/too-many-requests": "Muitas tentativas. Aguarde um pouco.",
    "auth/network-request-failed": "Sem conexão com a internet.",
  };
  const erroLogin = (msg) => { $("#login-erro").textContent = msg; };

  // lembra o último e-mail usado neste navegador
  try { $("#email").value = localStorage.getItem("lo_admin_email") || ""; } catch { /* ignorado */ }
  if ($("#email").value) $("#senha").focus();

  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    erroLogin("");
    $("#login-btn").disabled = true;
    try { await auth.signInWithEmailAndPassword($("#email").value.trim(), $("#senha").value); }
    catch (err) { erroLogin(mensagensAuth[err.code] || "Não foi possível entrar."); }
    finally { $("#login-btn").disabled = false; }
  });
  $("#esqueci").addEventListener("click", async () => {
    const email = $("#email").value.trim();
    if (!email) return erroLogin("Informe o e-mail acima para receber o link.");
    try { await auth.sendPasswordResetEmail(email); erroLogin(""); toast("Link de redefinição enviado para o e-mail."); }
    catch (err) { erroLogin(mensagensAuth[err.code] || "Não foi possível enviar o e-mail."); }
  });
  $("#sair").addEventListener("click", () => auth.signOut());

  // Cores do painel e do login seguem a cor principal cadastrada em Configurações.
  // A última cor fica guardada no aparelho para o login já abrir na cor certa.
  const pintar = (hex) => {
    if (!/^#[0-9a-f]{6}$/i.test(hex || "")) return;
    const r = document.documentElement.style;
    r.setProperty("--primaria", hex); r.setProperty("--on-primaria", DB.contraste(hex));
    const tema = document.querySelector('meta[name="theme-color"]'); if (tema) tema.content = hex;
  };
  window.Admin.pintar = pintar;
  try { pintar(localStorage.getItem("lo_admin_cor")); } catch { /* ignorado */ }
  DB.config.obter().then((c) => { pintar(c.corPrimaria); try { localStorage.setItem("lo_admin_cor", c.corPrimaria || ""); } catch { /* ignorado */ } }).catch(() => {});

  auth.onAuthStateChanged(async (user) => {
    if (!user) { $("#app").hidden = true; $("#login").hidden = false; if (window.Admin.aoSair) window.Admin.aoSair(); return; }
    // A lista de administradores fica nas regras do Firestore (regras.md). Para saber se este
    // usuário está nela, tenta ler algo que só o admin lê: se as regras negarem, não entra.
    let ehAdmin = false;
    try { await DB.fs.collection("pedidos").limit(1).get(); ehAdmin = true; }
    catch (e) { if (e.code !== "permission-denied") console.error(e); }
    if (!ehAdmin) {
      await auth.signOut();
      erroLogin(`O e-mail ${user.email} não tem permissão de administrador (ou as regras do Firestore não foram publicadas).`);
      return;
    }
    try { localStorage.setItem("lo_admin_email", user.email); } catch { /* ignorado */ }
    $("#login").hidden = true;
    $("#app").hidden = false;
    $("#side-nome").textContent = (await DB.config.obter()).nomeLoja;
    abrirTab("dashboard");
    if (window.Admin.aoEntrar) window.Admin.aoEntrar();
  });

  // ---- Navegação ----
  const telas = window.Admin.telas;
  async function abrirTab(nome) {
    document.querySelectorAll("#menu button").forEach((b) => b.classList.toggle("ativo", b.dataset.tab === nome));
    document.querySelectorAll(".tab").forEach((t) => (t.hidden = t.id !== "tab-" + nome));
    const ativo = document.querySelector("#menu .ativo");
    if (ativo && ativo.scrollIntoView) ativo.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
    try { await telas[nome](); }
    catch (e) {
      console.error(e);
      $("#tab-" + nome).innerHTML = `<p class="vazio">Erro ao carregar dados. Verifique as regras do Firestore e sua permissão de admin.</p>`;
    }
    atualizarPill();
  }
  async function atualizarPill() {
    try {
      const snap = await DB.fs.collection("pedidos").where("status", "==", "novo").get();
      $("#pill-novos").hidden = snap.empty;
      $("#pill-novos").textContent = snap.size;
    } catch { /* ignorado */ }
    if (window.Admin.atualizarPillVencidas) window.Admin.atualizarPillVencidas();
  }
  // Menu lateral no celular: faixa de ícones à esquerda; o botão ☰ abre com os nomes
  const lateral = $("#side"), fundoMenu = $("#side-fundo"), botaoMenu = $("#side-toggle");
  const abrirMenu = (aberto) => {
    lateral.classList.toggle("aberta", aberto);
    fundoMenu.hidden = !aberto;
    botaoMenu.setAttribute("aria-expanded", String(aberto));
    botaoMenu.setAttribute("aria-label", aberto ? "Fechar menu" : "Abrir menu");
  };
  botaoMenu.addEventListener("click", () => abrirMenu(!lateral.classList.contains("aberta")));
  fundoMenu.addEventListener("click", () => abrirMenu(false));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && lateral.classList.contains("aberta")) abrirMenu(false); });
  if (window.matchMedia) { const desktop = window.matchMedia("(min-width: 801px)"); if (desktop.addEventListener) desktop.addEventListener("change", (e) => { if (e.matches) abrirMenu(false); }); }
  // com só os ícones visíveis, o nome aparece ao segurar/passar o mouse
  document.querySelectorAll("#menu [data-tab]").forEach((b) => { b.title = [...b.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim(); });
  $("#menu").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]");
    if (b) { abrirTab(b.dataset.tab); abrirMenu(false); }
  });

  // ---- Modal de formulário ----
  let aoSalvar = null;
  const abrirModal = (titulo, html, salvar, opts = {}) => {
    $("#modal-titulo").textContent = titulo;
    $("#modal-campos").innerHTML = html;
    $("#modal-salvar").textContent = opts.salvar || "Salvar";
    $("#modal-cancelar").hidden = !!opts.semCancelar;
    $("#modal-form").classList.toggle("largo", !!opts.largo);
    aoSalvar = salvar;
    $("#modal").hidden = false;
  };
  const fecharModal = () => { $("#modal").hidden = true; aoSalvar = null; };
  $("#modal-cancelar").addEventListener("click", fecharModal);
  $("#modal").addEventListener("mousedown", (e) => e.target.id === "modal" && fecharModal());
  $("#modal-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!aoSalvar) return;
    const botao = e.target.querySelector(".acoes .btn:not(.sec)");
    botao.disabled = true;
    try { if ((await aoSalvar(Object.fromEntries(new FormData(e.target)), e.target)) !== false) fecharModal(); }
    finally { botao.disabled = false; }
  });

  const carregando = (id) => { $("#tab-" + id).innerHTML = `<p class="vazio">Carregando...</p>`; };

  Object.assign(window.Admin, { $, toast, tentar, abrirModal, fecharModal, abrirTab, carregando, dataBR, atualizarPill, nomeItem: (i) => i.nome + (i.variante ? ` (${i.variante})` : "") });
  window.Admin.modulos.forEach((iniciar) => iniciar(window.Admin));

  // ---- Gráfico de vendas (SVG sem bibliotecas) ----
  let periodoGrafico = 30;
  const compacto = (v) => (v >= 1000 ? (v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " mil" : String(Math.round(v)));
  const maximoBonito = (max) => {
    if (max <= 0) return 100;
    const e = Math.pow(10, Math.floor(Math.log10(max))), f = max / e;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e;
  };
  const serieDiaria = (validos, dias) => {
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const serie = [];
    for (let i = dias - 1; i >= 0; i--) {
      const d = new Date(hoje); d.setDate(d.getDate() - i);
      serie.push({ data: d, chave: d.toDateString(), total: 0, qtd: 0 });
    }
    const idx = Object.fromEntries(serie.map((s, i) => [s.chave, i]));
    validos.forEach((p) => {
      const k = new Date(p.criadoEm).toDateString();
      if (k in idx) { serie[idx[k]].total += p.total; serie[idx[k]].qtd++; }
    });
    return serie;
  };
  const desenharGrafico = (validos) => {
    const serie = serieDiaria(validos, periodoGrafico);
    const totalPeriodo = serie.reduce((s, d) => s + d.total, 0);
    const pedidosPeriodo = serie.reduce((s, d) => s + d.qtd, 0);
    const W = 720, H = 240, m = { l: 56, r: 12, t: 12, b: 28 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const topo = maximoBonito(Math.max(...serie.map((d) => d.total)));
    const slot = iw / serie.length, bw = Math.max(2, Math.min(slot - 2, 36));
    const fmtDia = (d) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
    const passoX = Math.ceil(serie.length / 7);
    const grade = [0, 0.5, 1].map((f) => {
      const y = m.t + ih - f * ih;
      return `<line x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}" class="g-grade${f === 0 ? " g-base" : ""}" />
        <text x="${m.l - 8}" y="${y + 4}" text-anchor="end" class="g-eixo">${f === 0 ? "0" : "R$ " + compacto(topo * f)}</text>`;
    }).join("");
    const barras = serie.map((d, i) => {
      const x = m.l + i * slot + (slot - bw) / 2;
      const h = (d.total / topo) * ih, y = m.t + ih - h, r = Math.min(4, h, bw / 2);
      const barra = h > 0
        ? `<path class="g-barra" d="M${x},${m.t + ih} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${m.t + ih} Z" />` : "";
      const rotulo = i % passoX === (serie.length - 1) % passoX ? `<text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle" class="g-eixo">${fmtDia(d.data)}</text>` : "";
      return `${barra}${rotulo}<rect class="g-hit" data-i="${i}" x="${m.l + i * slot}" y="${m.t}" width="${slot}" height="${ih}" />`;
    }).join("");
    $("#grafico-area").innerHTML = `
      <div class="g-resumo"><strong>${moeda(totalPeriodo)}</strong><span>${pedidosPeriodo} pedido(s) nos últimos ${periodoGrafico} dias</span></div>
      <div class="grafico" id="grafico">
        <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Receita diária dos últimos ${periodoGrafico} dias: ${moeda(totalPeriodo)}">${grade}${barras}</svg>
        <div class="g-tip" id="g-tip" hidden></div>
      </div>
      <details class="g-tabela"><summary>Ver tabela</summary>
        <table><thead><tr><th>Dia</th><th>Pedidos</th><th>Receita</th></tr></thead><tbody>
        ${serie.filter((d) => d.qtd).reverse().map((d) => `<tr><td>${fmtDia(d.data)}</td><td>${d.qtd}</td><td>${moeda(d.total)}</td></tr>`).join("") || `<tr><td colspan="3" class="vazio">Sem vendas no período.</td></tr>`}
        </tbody></table></details>`;
    const box = $("#grafico"), tip = $("#g-tip");
    box.onmousemove = (e) => {
      const hit = e.target.closest("[data-i]");
      if (!hit) { tip.hidden = true; return; }
      const d = serie[+hit.dataset.i];
      tip.innerHTML = `<b>${d.data.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" })}</b><br>${moeda(d.total)} · ${d.qtd} pedido(s)`;
      tip.hidden = false;
      const rb = box.getBoundingClientRect(), rh = hit.getBoundingClientRect();
      tip.style.left = Math.min(Math.max(rh.left - rb.left + rh.width / 2, 70), rb.width - 70) + "px";
      tip.style.top = Math.max(((d.total / topo) ? (m.t + ih - (d.total / topo) * ih) / H * rb.height : rb.height * 0.6) - 8, 0) + "px";
    };
    box.onmouseleave = () => { tip.hidden = true; };
  };

  // ---- Dashboard ----
  telas.dashboard = async () => {
    carregando("dashboard");
    const [pedidos, produtos, cats, vendasPdv] = await Promise.all([DB.pedidos.listar(), DB.produtos.listar(), DB.categorias.listar(), DB.vendas.listar()]);
    const pdvValidas = vendasPdv.filter((v) => v.status !== "cancelada");
    const validos = [...pedidos.filter((p) => p.status !== "cancelado"), ...pdvValidas];
    const receita = validos.reduce((s, p) => s + p.total, 0);
    const hoje = new Date().toDateString();
    const receitaHoje = validos.filter((p) => new Date(p.criadoEm).toDateString() === hoje).reduce((s, p) => s + p.total, 0);
    const baixo = produtos.filter((p) => p.estoque <= 5);
    const ranking = {};
    validos.forEach((p) => p.itens.forEach((i) => (ranking[i.nome] = (ranking[i.nome] || 0) + i.qtd)));
    const top = Object.entries(ranking).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const vazia = produtos.length === 0 && cats.length === 0;
    $("#tab-dashboard").innerHTML = `
      <div class="cab"><h1>Dashboard</h1></div>
      ${vazia ? `<div class="painel" style="margin-bottom:16px"><p style="margin-bottom:10px">Sua loja ainda está vazia.</p><button class="btn" id="semear">Carregar dados de exemplo</button></div>` : ""}
      <div class="kpis">
        <div class="kpi"><span>Receita total</span><strong>${moeda(receita)}</strong></div>
        <div class="kpi"><span>Receita hoje</span><strong>${moeda(receitaHoje)}</strong></div>
        <div class="kpi"><span>Pedidos online</span><strong>${pedidos.length}</strong></div>
        <div class="kpi"><span>Vendas no PDV</span><strong>${pdvValidas.length}</strong></div>
        <div class="kpi"><span>Ticket médio</span><strong>${moeda(validos.length ? receita / validos.length : 0)}</strong></div>
        <div class="kpi"><span>Pedidos novos</span><strong>${pedidos.filter((p) => p.status === "novo").length}</strong></div>
      </div>
      <div class="painel" style="margin-bottom:14px">
        <div class="cab" style="margin-bottom:8px"><h3>Vendas por dia</h3>
          <div class="seg" id="seg-periodo">${[7, 30, 90].map((d) => `<button type="button" data-dias="${d}" class="${d === periodoGrafico ? "ativo" : ""}">${d} dias</button>`).join("")}</div>
        </div>
        <div id="grafico-area"></div>
      </div>
      <div class="duas">
        <div class="painel"><h3>Mais vendidos</h3><ul>${top.map(([n, q]) => `<li><span>${esc(n)}</span><strong>${q} un.</strong></li>`).join("") || "<li>Sem vendas ainda</li>"}</ul></div>
        <div class="painel"><h3>Estoque baixo (≤ 5)</h3><ul>${baixo.map((p) => `<li><span>${esc(p.nome)}</span><strong>${p.estoque}</strong></li>`).join("") || "<li>Tudo em ordem</li>"}</ul></div>
      </div>`;
    desenharGrafico(validos);
    $("#seg-periodo").onclick = (e) => {
      const b = e.target.closest("[data-dias]");
      if (!b) return;
      periodoGrafico = +b.dataset.dias;
      document.querySelectorAll("#seg-periodo button").forEach((x) => x.classList.toggle("ativo", x === b));
      desenharGrafico(validos);
    };
    const s = $("#semear");
    if (s) s.onclick = async () => { s.disabled = true; if (await tentar(() => DB.semear())) abrirTab("dashboard"); else s.disabled = false; };
  };

  // ---- Pedidos ----
  let filtroStatus = "todos";
  telas.pedidos = async () => {
    carregando("pedidos");
    const todos = (await DB.pedidos.listar()).sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
    const lista = filtroStatus === "todos" ? todos : todos.filter((p) => p.status === filtroStatus);
    $("#tab-pedidos").innerHTML = `
      <div class="cab"><h1>Pedidos</h1></div>
      <div class="filtros"><select id="f-status"><option value="todos">Todos os status</option>${STATUS.map((s) => `<option value="${s}" ${s === filtroStatus ? "selected" : ""}>${ROTULO[s]}</option>`).join("")}</select></div>
      <table><thead><tr><th>Código</th><th>Data</th><th>Cliente</th><th>Tipo</th><th>Total</th><th>Status</th><th></th></tr></thead><tbody>
      ${lista.map((p) => `<tr>
        <td>#${esc(p.codigo)}</td><td>${dataBR(p.criadoEm)}</td><td>${esc(p.cliente.nome)}</td>
        <td>${p.tipo === "entrega" ? "Entrega" : "Retirada"}</td><td>${moeda(p.total)}</td>
        <td><span class="status s-${p.status}">${ROTULO[p.status]}</span></td>
        <td class="acoes"><button class="btn sec peq" data-ver="${p.id}">Detalhes</button></td></tr>`).join("") || `<tr><td colspan="7" class="vazio">Nenhum pedido.</td></tr>`}
      </tbody></table>`;
    $("#f-status").onchange = (e) => { filtroStatus = e.target.value; telas.pedidos(); };
  };

  // O estoque é baixado quando o pedido é confirmado e devolvido se voltar a "novo" ou for cancelado.
  const mudarStatus = async (p, novo) => {
    const deveBaixar = BAIXA_ESTOQUE.includes(novo);
    if (deveBaixar && !p.estoqueBaixado) {
      for (const i of p.itens) await DB.produtos.ajustarEstoque(i.id, -i.qtd, i.vid, { tipo: "pedido_site", motivo: `Pedido #${p.codigo} confirmado`, ref: p.codigo });
      p.estoqueBaixado = true;
    } else if (!deveBaixar && p.estoqueBaixado) {
      for (const i of p.itens) await DB.produtos.ajustarEstoque(i.id, i.qtd, i.vid, { tipo: "estorno_pedido", motivo: `Pedido #${p.codigo} ${novo === "cancelado" ? "cancelado" : "voltou para novo"}`, ref: p.codigo });
      p.estoqueBaixado = false;
    }
    p.status = novo;
    await DB.pedidos.atualizar(p);
  };

  const nomeItem = (i) => i.nome + (i.variante ? ` (${i.variante})` : "");
  const foneWhats = (tel) => { const d = (tel || "").replace(/\D/g, ""); return d ? (d.length > 11 ? d : "55" + d) : ""; };

  // Janela de impressão: o usuário escolhe "Salvar como PDF" no diálogo de impressão
  const imprimirPedido = async (p) => {
    const cfg = await DB.config.obter();
    const w = window.open("", "_blank");
    if (!w) return toast("Permita pop-ups para imprimir");
    w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Pedido #${esc(p.codigo)}</title>
      <style>
        body{font-family:system-ui,Segoe UI,Arial,sans-serif;color:#111;margin:32px;max-width:720px}
        h1{font-size:20px;margin:0}.sub{color:#555;font-size:13px;margin:2px 0 18px}
        h2{font-size:14px;text-transform:uppercase;letter-spacing:.04em;color:#555;margin:20px 0 6px;border-bottom:1px solid #ddd;padding-bottom:4px}
        table{width:100%;border-collapse:collapse;font-size:14px}th,td{padding:6px 4px;text-align:left;border-bottom:1px solid #eee}
        td.n,th.n{text-align:right}.tot td{font-weight:700;border-top:2px solid #111;border-bottom:0}
        p{margin:3px 0;font-size:14px}.cod{font-size:22px;font-weight:800;letter-spacing:.1em}
        @media print{.no{display:none}}
      </style></head><body>
      <h1>${esc(cfg.nomeLoja)}</h1>
      <div class="sub">${esc([cfg.endereco, cfg.horario].filter(Boolean).join(" · "))}</div>
      <div class="cod">Pedido #${esc(p.codigo)}</div>
      <div class="sub">${dataBR(p.criadoEm)} · ${esc(ROTULO[p.status])}</div>
      <h2>Cliente</h2>
      <p><b>${esc(p.cliente.nome)}</b> — ${esc(p.cliente.telefone)}</p>
      <p>${p.tipo === "entrega" ? "Entrega: " + esc(p.endereco) + (p.regiao ? " (" + esc(p.regiao) + ")" : "") : "Retirada: " + esc(p.retirada)}</p>
      <h2>Itens</h2>
      <table><thead><tr><th>Produto</th><th class="n">Qtd</th><th class="n">Unit.</th><th class="n">Total</th></tr></thead><tbody>
        ${p.itens.map((i) => `<tr><td>${esc(nomeItem(i))}</td><td class="n">${i.qtd}</td><td class="n">${moeda(i.preco)}</td><td class="n">${moeda(i.preco * i.qtd)}</td></tr>`).join("")}
        <tr><td colspan="3" class="n">Subtotal</td><td class="n">${moeda(p.subtotal)}</td></tr>
        ${p.desconto ? `<tr><td colspan="3" class="n">Desconto (${esc(p.cupom)})</td><td class="n">- ${moeda(p.desconto)}</td></tr>` : ""}
        <tr><td colspan="3" class="n">Frete</td><td class="n">${p.frete ? moeda(p.frete) : "Grátis"}</td></tr>
        <tr class="tot"><td colspan="3" class="n">Total</td><td class="n">${moeda(p.total)}</td></tr>
      </tbody></table>
      <h2>Pagamento</h2>
      <p>${esc(p.pagamento)}${p.troco ? ` (troco para ${moeda(p.troco)})` : ""}</p>
      ${p.obs ? `<h2>Observações</h2><p>${esc(p.obs)}</p>` : ""}
      <p class="no" style="margin-top:24px"><button onclick="window.print()">Imprimir / Salvar PDF</button></p>
      <script>window.onload=function(){setTimeout(function(){window.print()},300)}<\/script>
      </body></html>`);
    w.document.close();
  };

  const mensagemStatus = (p, cfg) => {
    const link = new URL("acompanhar.html?c=" + p.codigo, location.href).href;
    const frases = {
      novo: "recebemos o seu pedido e já vamos confirmá-lo",
      confirmado: "foi confirmado e está sendo preparado",
      enviado: p.tipo === "entrega" ? "saiu para entrega" : "está pronto para retirada",
      entregue: p.tipo === "entrega" ? "foi entregue. Obrigado pela preferência!" : "foi retirado. Obrigado pela preferência!",
      cancelado: "foi cancelado. Qualquer dúvida, é só responder esta mensagem",
    };
    return `Olá, ${p.cliente.nome.split(" ")[0]}! Seu pedido #${p.codigo} na ${cfg.nomeLoja} ${frases[p.status]}.\nAcompanhe: ${link}`;
  };

  const verPedido = async (id) => {
    const p = await DB.pedidos.obter(id);
    if (!p) return toast("Pedido não encontrado");
    abrirModal(`Pedido #${p.codigo}`, `
      <div class="detalhe">
        <p><b>Data:</b> ${dataBR(p.criadoEm)}</p>
        <p><b>Cliente:</b> ${esc(p.cliente.nome)} — ${esc(p.cliente.telefone)}</p>
        ${p.cliente.email ? `<p><b>E-mail:</b> ${esc(p.cliente.email)}</p>` : ""}${p.cliente.cpf ? `<p><b>CPF/CNPJ:</b> ${esc(p.cliente.cpf)}</p>` : ""}
        <p><b>${p.tipo === "entrega" ? "Endereço" : "Retirada"}:</b> ${esc(p.tipo === "entrega" ? p.endereco : p.retirada)}${p.regiao ? ` <i>(${esc(p.regiao)})</i>` : ""}</p>
        <p><b>Pagamento:</b> ${esc(p.pagamento)}${p.troco ? ` (troco para ${moeda(p.troco)})` : ""}</p>
        ${p.obs ? `<p><b>Obs:</b> ${esc(p.obs)}</p>` : ""}
        <ul>${p.itens.map((i) => `<li>${i.qtd}x ${esc(nomeItem(i))} — ${moeda(i.preco * i.qtd)}</li>`).join("")}</ul>
        <p>Subtotal: ${moeda(p.subtotal)}${p.desconto ? ` · Desconto (${esc(p.cupom)}): -${moeda(p.desconto)}` : ""} · Frete: ${moeda(p.frete)}</p>
        <p><b>Total: ${moeda(p.total)}</b></p>
      </div>
      <label>Status<select name="status">${STATUS.map((s) => `<option value="${s}" ${s === p.status ? "selected" : ""}>${ROTULO[s]}</option>`).join("")}</select></label>
      <p style="font-size:.8rem;color:var(--suave)">O estoque é baixado ao confirmar o pedido e devolvido se ele for cancelado. O cliente vê o status em "Acompanhar pedido".</p>
      <div class="barra-acoes">
        <button type="button" class="btn sec peq" id="imprimir-pedido"><i class="fa-solid fa-print"></i> Imprimir / PDF</button>
        <button type="button" class="btn sec peq" id="imprimir-termica"><i class="fa-solid fa-receipt"></i> Cupom na térmica</button>
        <button type="button" class="btn sec peq" id="avisar-cliente"><i class="fab fa-whatsapp"></i> Avisar cliente</button>
        <button type="button" class="btn perigo peq" id="excluir-pedido">Excluir</button>
      </div>`,
      async (d) => {
        if (!(await tentar(() => mudarStatus(p, d.status)))) return false;
        abrirTab("pedidos"); toast("Pedido atualizado");
      });
    $("#imprimir-pedido").onclick = () => imprimirPedido(p);
    $("#imprimir-termica").onclick = async () => {
      if (!window.Admin.impressora || !window.Admin.impressora.conectada()) return toast("Conecte a impressora em Configurações.");
      try { await window.Admin.impressora.pedidoSite(p); toast("Pedido enviado para a impressora"); } catch (e) { toast("Não foi possível imprimir: " + (e.message || "erro")); }
    };
    $("#avisar-cliente").onclick = async () => {
      const fone = foneWhats(p.cliente.telefone);
      if (!fone) return toast("Cliente sem telefone");
      const sel = $("#modal-form [name=status]").value; // mensagem reflete o status escolhido no formulário
      const cfg = await DB.config.obter();
      window.open(`https://wa.me/${fone}?text=${encodeURIComponent(mensagemStatus({ ...p, status: sel }, cfg))}`, "_blank");
    };
    $("#excluir-pedido").onclick = async () => {
      if (!confirm("Excluir este pedido definitivamente?")) return;
      if (p.estoqueBaixado && !confirm("O estoque deste pedido já foi baixado e NÃO será devolvido. Continuar?")) return;
      if (await tentar(() => DB.pedidos.excluir(p.id))) { fecharModal(); abrirTab("pedidos"); }
    };
  };
  $("#tab-pedidos").addEventListener("click", (e) => { const b = e.target.closest("[data-ver]"); if (b) verPedido(b.dataset.ver); });
  window.Admin.verPedido = verPedido;

  // ---- Produtos ----
  let buscaProd = "";
  telas.produtos = async () => {
    carregando("produtos");
    const [produtos, categorias] = await Promise.all([DB.produtos.listar(), DB.categorias.listar()]);
    const cats = Object.fromEntries(categorias.map((c) => [c.id, c.nome]));
    const lista = produtos.filter((p) => p.nome.toLowerCase().includes(buscaProd.toLowerCase())).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    $("#tab-produtos").innerHTML = `
      <div class="cab"><h1>Produtos</h1><div class="barra-acoes"><button class="btn sec" id="exemplos-produtos" title="Adiciona produtos de exemplo de uma loja de acessórios"><i class="fa-solid fa-wand-magic-sparkles"></i> Adicionar exemplos</button><button class="btn" id="novo-produto"><i class="fa-solid fa-plus"></i> Novo produto</button></div></div>
      <div class="filtros"><input id="busca-prod" placeholder="Buscar produto..." value="${esc(buscaProd)}" /></div>
      <table><thead><tr><th></th><th>Nome</th><th>Categoria</th><th>Preço</th><th>Estoque</th><th>Situação</th><th></th></tr></thead><tbody>
      ${lista.map((p) => `<tr>
        <td><img src="${esc(p.imagem)}" alt="" /></td><td>${esc(p.nome)}${p.destaque ? " ⭐" : ""}${p.variantes?.length ? ` <small style="color:var(--suave)">(${p.variantes.length} variações)</small>` : ""}</td><td>${esc(cats[p.categoria] || "—")}</td>
        <td>${moeda(p.preco)}</td><td>${p.estoque}</td>
        <td><span class="status ${p.ativo !== false ? "s-ativo" : "s-inativo"}">${p.ativo !== false ? "Ativo" : "Oculto"}</span></td>
        <td class="acoes"><button class="btn sec peq" data-edit="${p.id}">Editar</button> <button class="btn perigo peq" data-del="${p.id}">Excluir</button></td></tr>`).join("") || `<tr><td colspan="7" class="vazio">Nenhum produto.</td></tr>`}
      </tbody></table>`;
    const b = $("#busca-prod");
    b.oninput = () => { buscaProd = b.value; telas.produtos().then(() => { const n = $("#busca-prod"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }); };
    $("#novo-produto").onclick = () => formProduto();
    $("#exemplos-produtos").onclick = async (e) => {
      if (!confirm("Adicionar produtos de exemplo de uma loja de acessórios (bijuterias, relógios, bolsas, óculos, carteiras, tech e cabelo)?\n\nNada será apagado e produtos com o mesmo nome não são repetidos.")) return;
      e.currentTarget.disabled = true;
      let n = 0;
      if (await tentar(async () => { n = await DB.adicionarExemplos(); })) { toast(n ? `${n} produtos adicionados` : "Os produtos de exemplo já existem"); abrirTab("produtos"); }
      else e.currentTarget.disabled = false;
    };
  };

  // Redimensiona a imagem enviada (fica salva no próprio documento do Firestore, limite 1 MB)
  const lerImagem = (file) => new Promise((ok, fail) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 600, k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      ok(c.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = () => fail(new Error("imagem inválida"));
    img.src = url;
  });

  async function formProduto(id) {
    const p = id ? await DB.produtos.obter(id) : { nome: "", categoria: "", preco: "", precoAntigo: "", estoque: 0, descricao: "", imagem: "", destaque: false, ativo: true };
    const cats = await DB.categorias.listar();
    let imagem = p.imagem;
    abrirModal(id ? "Editar produto" : "Novo produto", `
      <label>Nome<input name="nome" value="${esc(p.nome)}" required /></label>
      <div class="grid2">
        <label>SKU / código de barras<span class="campo-scan"><input name="codigo" value="${esc(p.codigo || "")}" autocomplete="off" /><button type="button" class="btn sec" id="scan-codigo" title="Ler com a câmera" aria-label="Ler código com a câmera"><i class="fa-solid fa-camera"></i></button></span><small class="dica">Usado para achar o produto no PDV: digitando, com leitor USB ou com a câmera.</small></label>
        <label>Custo (R$) — para lucro nos relatórios<input name="custo" type="number" step="0.01" min="0" value="${p.custo ?? ""}" /></label>
      </div>
      <label>Categoria<select name="categoria"><option value="">Sem categoria</option>${cats.filter((c) => !c.pai).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")).flatMap((c) => [c, ...cats.filter((f) => f.pai === c.id)]).map((c) => `<option value="${esc(c.id)}" ${c.id === p.categoria ? "selected" : ""}>${c.pai ? "↳ " : ""}${esc(c.nome)}</option>`).join("")}</select></label>
      <div class="grid2">
        <label>Preço (R$)<input name="preco" type="number" step="0.01" min="0" value="${p.preco}" required /></label>
        <label>Preço antigo (opcional)<input name="precoAntigo" type="number" step="0.01" min="0" value="${p.precoAntigo || ""}" /></label>
      </div>
      <div class="grid2">
        <label>Estoque<input name="estoque" id="campo-estoque" type="number" min="0" step="1" value="${p.estoque}" required /></label>
        <label>Estoque mínimo (alerta)<input name="estoqueMinimo" type="number" min="0" step="1" value="${p.estoqueMinimo ?? ""}" placeholder="padrão" /></label>
      </div>
      <div class="vars-box">
        <div class="vars-cab"><b>Variações (tamanho, cor...)</b><button type="button" class="btn sec peq" id="add-var"><i class="fa-solid fa-plus"></i> Adicionar</button></div>
        <p class="dica">Opcional. Cada variação tem estoque próprio e pode ter seu SKU / código de barras (ex.: "M - Azul"). Com variações, o estoque total é a soma delas.</p>
        <div id="vars-lista"></div>
      </div>
      <label>Descrição<textarea name="descricao" rows="3">${esc(p.descricao)}</textarea></label>
      <label>Imagem (envie um arquivo ou cole uma URL)
        <input type="file" id="img-arquivo" accept="image/*" />
        <input name="imagemUrl" id="img-url" placeholder="https://..." value="${p.imagem && !p.imagem.startsWith("data:") ? esc(p.imagem) : ""}" />
      </label>
      <img class="prev" id="img-prev" src="${esc(p.imagem)}" alt="" ${p.imagem ? "" : "hidden"} />
      <label class="check"><input type="checkbox" name="destaque" ${p.destaque ? "checked" : ""} /> Produto em destaque</label>
      <label class="check"><input type="checkbox" name="ativo" ${p.ativo !== false ? "checked" : ""} /> Visível na loja</label>`,
      async (d) => {
        const url = d.imagemUrl.trim();
        const variantes = [...document.querySelectorAll("#vars-lista .var-linha")]
          .map((l) => ({ id: l.dataset.id, nome: l.querySelector(".v-nome").value.trim(), codigo: l.querySelector(".v-cod").value.trim(), estoque: Math.max(0, parseInt(l.querySelector(".v-est").value, 10) || 0) }))
          .filter((v) => v.nome);
        if (new Set(variantes.map((v) => v.nome.toLowerCase())).size !== variantes.length) { toast("Há variações com o mesmo nome"); return false; }
        const item = {
          ...p, nome: d.nome.trim(), categoria: d.categoria, preco: parseFloat(d.preco), precoAntigo: parseFloat(d.precoAntigo) || 0,
          estoque: variantes.length ? variantes.reduce((t, v) => t + v.estoque, 0) : parseInt(d.estoque, 10), variantes, estoqueMinimo: d.estoqueMinimo === "" ? null : Math.max(0, parseInt(d.estoqueMinimo, 10) || 0), codigo: d.codigo.trim(), custo: d.custo === "" ? null : parseFloat(d.custo), descricao: d.descricao.trim(), imagem: url || imagem || DB.placeholder("📦", "#e5e7eb"),
          destaque: d.destaque === "on", ativo: d.ativo === "on",
        };
        let salvo = null;
        if (!(await tentar(async () => { salvo = await DB.produtos.salvar(item); }, "Falha ao salvar (imagem muito grande?)"))) return false;
        // histórico de estoque: estoque inicial no cadastro ou alteração feita pelo formulário
        await tentar(() => DB.movimentos.registrar(salvo, "", id ? (p.estoque || 0) : 0, salvo.estoque, { tipo: id ? "ajuste" : "entrada", motivo: id ? "Edição do produto" : "Estoque inicial (cadastro)" }));
        abrirTab("produtos"); toast("Produto salvo");
      });
    $("#img-arquivo").onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try { imagem = await lerImagem(f); $("#img-url").value = ""; $("#img-prev").src = imagem; $("#img-prev").hidden = false; }
      catch { toast("Arquivo de imagem inválido"); }
    };
    // editor de variações
    const lista = $("#vars-lista"), campoEst = $("#campo-estoque");
    const somar = () => {
      const linhas = [...lista.querySelectorAll(".var-linha")];
      campoEst.readOnly = linhas.length > 0;
      if (linhas.length) campoEst.value = linhas.reduce((t, l) => t + (Math.max(0, parseInt(l.querySelector(".v-est").value, 10) || 0)), 0);
    };
    const linhaVar = (v = {}) => {
      const l = document.createElement("div");
      l.className = "var-linha";
      l.dataset.id = v.id || "v" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      l.innerHTML = `<input class="v-nome" placeholder="Nome (ex.: M - Azul)" value="${esc(v.nome || "")}" /><input class="v-cod" placeholder="SKU / código" value="${esc(v.codigo || "")}" autocomplete="off" /><input class="v-est" type="number" min="0" step="1" placeholder="Estoque" value="${v.estoque ?? 0}" /><button type="button" class="rem-var" aria-label="Remover variação">&times;</button>`;
      l.querySelector(".v-est").oninput = somar;
      l.querySelector(".rem-var").onclick = () => { l.remove(); somar(); };
      lista.appendChild(l);
    };
    (p.variantes || []).forEach(linhaVar);
    somar();
    $("#add-var").onclick = () => { linhaVar(); somar(); lista.lastChild.querySelector(".v-nome").focus(); };
    $("#scan-codigo").onclick = () => {
      if (!window.Admin.scanner.suportado()) return toast("Este navegador não permite usar a câmera. Digite o código ou use um leitor USB.");
      window.Admin.scanner.abrir({
        titulo: "Ler código do produto",
        aoLer: async (codigo) => {
          $("#modal-form").elements.codigo.value = codigo;
          let aviso = "";
          try {
            const outro = (await DB.produtos.listar()).find((x) => x.id !== id && [x.codigo, ...(x.variantes || []).map((v) => v.codigo)].some((c) => c && c.toLowerCase() === codigo.toLowerCase()));
            if (outro) aviso = `Atenção: este código já está em "${outro.nome}"`;
          } catch { /* ignorado */ }
          return aviso ? { manter: false, erro: aviso } : { manter: false, ok: `Código ${codigo} lido` };
        },
      });
    };
    $("#img-url").oninput = (e) => { if (e.target.value) { $("#img-prev").src = e.target.value; $("#img-prev").hidden = false; } };
  }
  $("#tab-produtos").addEventListener("click", async (e) => {
    const ed = e.target.closest("[data-edit]"), del = e.target.closest("[data-del]");
    if (ed) formProduto(ed.dataset.edit);
    if (del && confirm("Excluir este produto?")) { if (await tentar(() => DB.produtos.remover(del.dataset.del))) abrirTab("produtos"); }
  });

  // ---- Categorias (com subcategorias) ----
  telas.categorias = async () => {
    carregando("categorias");
    const [categorias, prods] = await Promise.all([DB.categorias.listar(), DB.produtos.listar()]);
    const existe = (id) => categorias.some((x) => x.id === id);
    const raizes = categorias.filter((c) => !c.pai || !existe(c.pai)).sort((x, y) => x.nome.localeCompare(y.nome, "pt-BR"));
    const filhos = (id) => categorias.filter((c) => c.pai === id).sort((x, y) => x.nome.localeCompare(y.nome, "pt-BR"));
    const linhas = [];
    raizes.forEach((r) => { linhas.push([r, false]); filhos(r.id).forEach((f) => linhas.push([f, true])); });
    $("#tab-categorias").innerHTML = `
      <div class="cab"><h1>Categorias</h1><button class="btn" id="nova-cat"><i class="fa-solid fa-plus"></i> Nova categoria</button></div>
      <p class="dica" style="margin-bottom:10px">Uma categoria pode ter subcategorias (escolha a "Categoria pai" ao editar). Na loja, a categoria pai mostra também os produtos das subcategorias.</p>
      <table><thead><tr><th>Foto / ícone</th><th>Nome</th><th>Produtos</th><th></th></tr></thead><tbody>
      ${linhas.map(([c, sub]) => `<tr><td>${c.imagem ? `<img class="thumb-cat" src="${esc(c.imagem)}" alt="" />` : `<i class="fa-solid ${esc(c.icone || "fa-tag")}"></i>`}</td>
        <td>${sub ? '<span class="dica">↳</span> ' : ""}<b>${esc(c.nome)}</b>${!sub && filhos(c.id).length ? ` <small class="dica">(${filhos(c.id).length} subcategorias)</small>` : ""}</td>
        <td>${prods.filter((p) => p.categoria === c.id).length}</td>
        <td class="acoes"><button class="btn sec peq" data-edit="${c.id}">Editar</button> <button class="btn perigo peq" data-del="${c.id}">Excluir</button></td></tr>`).join("") || `<tr><td colspan="4" class="vazio">Nenhuma categoria.</td></tr>`}
      </tbody></table>`;
    $("#nova-cat").onclick = () => formCategoria();
  };
  async function formCategoria(id) {
    const c = id ? await DB.categorias.obter(id) : { nome: "", icone: "fa-tag", pai: "", imagem: "" };
    let imagem = c.imagem || "";
    const todas = await DB.categorias.listar();
    // só categorias principais podem ser "pai" (um nível de subcategorias); uma categoria que já tem filhas não vira subcategoria
    const temFilhas = id && todas.some((x) => x.pai === id);
    const possiveis = todas.filter((x) => x.id !== id && !x.pai).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    abrirModal(id ? "Editar categoria" : "Nova categoria", `
      <label>Nome<input name="nome" value="${esc(c.nome)}" required /></label>
      <label>Foto da categoria (envie um arquivo ou cole uma URL)
        <input type="file" id="cat-arquivo" accept="image/*" />
        <input name="imagemUrl" id="cat-url" placeholder="https://..." value="${c.imagem && !c.imagem.startsWith("data:") ? esc(c.imagem) : ""}" />
        <small class="dica">Aparece nos cartões de categoria da página inicial. Sem foto, é usado o ícone abaixo.</small>
      </label>
      <div class="foto-cat"><img class="prev" id="cat-prev" alt="" ${imagem ? `src="${esc(imagem)}"` : "hidden"} /><button type="button" class="btn sec peq" id="cat-remover" ${imagem ? "" : "hidden"}>Remover foto</button></div>
      <label>Ícone Font Awesome (ex.: fa-shirt, fa-headphones)<input name="icone" value="${esc(c.icone)}" /></label>
      <label>Categoria pai (opcional)
        <select name="pai" ${temFilhas ? "disabled" : ""}><option value="">Nenhuma (categoria principal)</option>${possiveis.map((x) => `<option value="${esc(x.id)}" ${x.id === c.pai ? "selected" : ""}>${esc(x.nome)}</option>`).join("")}</select>
        <small class="dica">${temFilhas ? "Esta categoria já tem subcategorias, por isso não pode ser subcategoria de outra." : "Escolha uma para criar uma subcategoria (ex.: Masculino → Camisetas)."}</small>
      </label>`,
      async (d) => {
        if (!(await tentar(() => DB.categorias.salvar({ ...c, nome: d.nome.trim(), icone: d.icone.trim() || "fa-tag", pai: temFilhas ? "" : (d.pai || ""), imagem: d.imagemUrl.trim() || imagem })))) return false;
        abrirTab("categorias"); toast("Categoria salva");
      });
    const mostrarFoto = (src) => { const im = $("#cat-prev"); if (src) im.src = src; else im.removeAttribute("src"); im.hidden = !src; $("#cat-remover").hidden = !src; };
    $("#cat-arquivo").onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try { imagem = await lerImagem(f); $("#cat-url").value = ""; mostrarFoto(imagem); }
      catch { toast("Arquivo de imagem inválido"); }
    };
    $("#cat-url").oninput = (e) => { if (e.target.value) { imagem = ""; mostrarFoto(e.target.value); } };
    $("#cat-remover").onclick = () => { imagem = ""; $("#cat-url").value = ""; $("#cat-arquivo").value = ""; mostrarFoto(""); };
  }
  $("#tab-categorias").addEventListener("click", async (e) => {
    const ed = e.target.closest("[data-edit]"), del = e.target.closest("[data-del]");
    if (ed) formCategoria(ed.dataset.edit);
    if (del && confirm("Excluir categoria? Os produtos ficarão sem categoria e as subcategorias viram categorias principais.")) {
      const ok = await tentar(async () => {
        const prods = (await DB.produtos.listar()).filter((p) => p.categoria === del.dataset.del);
        await Promise.all(prods.map((p) => DB.produtos.salvar({ ...p, categoria: "" })));
        const subs = (await DB.categorias.listar()).filter((x) => x.pai === del.dataset.del);
        await Promise.all(subs.map((x) => DB.categorias.salvar({ ...x, pai: "" })));
        await DB.categorias.remover(del.dataset.del);
      });
      if (ok) abrirTab("categorias");
    }
  });

  // ---- Fretes (valor de entrega por região) ----
  telas.fretes = async () => {
    carregando("fretes");
    const [lista, c] = await Promise.all([DB.fretes.listar(), DB.config.obter()]);
    lista.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    $("#tab-fretes").innerHTML = `
      <div class="cab"><h1>Fretes</h1><button class="btn" id="novo-frete"><i class="fa-solid fa-plus"></i> Nova região</button></div>
      <p class="dica" style="margin-bottom:12px">Cadastre o valor de entrega por bairro, cidade ou zona. No checkout o cliente escolhe a região (e ela é selecionada sozinha quando o nome coincide com o bairro/cidade do CEP).
        ${lista.length ? "" : `Sem regiões cadastradas, vale o frete padrão de ${moeda(c.taxaEntrega)} (Configurações).`}
        ${c.freteGratisAcima > 0 ? `Frete grátis para pedidos a partir de ${moeda(c.freteGratisAcima)}.` : ""}</p>
      <table><thead><tr><th>Região</th><th>Valor</th><th>Prazo</th><th>Situação</th><th></th></tr></thead><tbody>
      ${lista.map((f) => `<tr><td><b>${esc(f.nome)}</b></td><td>${moeda(f.valor)}</td><td>${esc(f.prazo || "—")}</td>
        <td><span class="status ${f.ativo !== false ? "s-ativo" : "s-inativo"}">${f.ativo !== false ? "Ativo" : "Inativo"}</span></td>
        <td class="acoes"><button class="btn sec peq" data-edit="${f.id}">Editar</button> <button class="btn perigo peq" data-del="${f.id}">Excluir</button></td></tr>`).join("") || `<tr><td colspan="5" class="vazio">Nenhuma região cadastrada.</td></tr>`}
      </tbody></table>`;
    $("#novo-frete").onclick = () => formFrete();
  };
  async function formFrete(id) {
    const f = id ? await DB.fretes.obter(id) : { nome: "", valor: "", prazo: "", ativo: true };
    abrirModal(id ? "Editar região" : "Nova região", `
      <label>Região (bairro, cidade ou zona)<input name="nome" value="${esc(f.nome)}" required placeholder="Ex.: Boa Viagem" /></label>
      <div class="grid2">
        <label>Valor do frete (R$)<input name="valor" type="number" step="0.01" min="0" value="${f.valor}" required /></label>
        <label>Prazo (opcional)<input name="prazo" value="${esc(f.prazo || "")}" placeholder="Ex.: 1 a 2 dias" /></label>
      </div>
      <label class="check"><input type="checkbox" name="ativo" ${f.ativo !== false ? "checked" : ""} /> Região ativa</label>`,
      async (d) => {
        const nome = d.nome.trim();
        if ((await DB.fretes.listar()).some((x) => x.nome.toLowerCase() === nome.toLowerCase() && x.id !== f.id)) { toast("Já existe uma região com esse nome"); return false; }
        if (!(await tentar(() => DB.fretes.salvar({ ...f, nome, valor: parseFloat(d.valor) || 0, prazo: d.prazo.trim(), ativo: d.ativo === "on" })))) return false;
        abrirTab("fretes"); toast("Região salva");
      });
  }
  $("#tab-fretes").addEventListener("click", async (e) => {
    const ed = e.target.closest("[data-edit]"), del = e.target.closest("[data-del]");
    if (ed) formFrete(ed.dataset.edit);
    if (del && confirm("Excluir esta região?")) { if (await tentar(() => DB.fretes.remover(del.dataset.del))) abrirTab("fretes"); }
  });

  // ---- Cupons ----
  telas.cupons = async () => {
    carregando("cupons");
    const cupons = await DB.cupons.listar();
    $("#tab-cupons").innerHTML = `
      <div class="cab"><h1>Cupons</h1><button class="btn" id="novo-cupom"><i class="fa-solid fa-plus"></i> Novo cupom</button></div>
      <table><thead><tr><th>Código</th><th>Desconto</th><th>Mínimo</th><th>Situação</th><th></th></tr></thead><tbody>
      ${cupons.map((c) => `<tr><td><b>${esc(c.codigo)}</b></td><td>${c.tipo === "percentual" ? c.valor + "%" : moeda(c.valor)}</td><td>${moeda(c.minimo)}</td>
        <td><span class="status ${c.ativo !== false ? "s-ativo" : "s-inativo"}">${c.ativo !== false ? "Ativo" : "Inativo"}</span></td>
        <td class="acoes"><button class="btn sec peq" data-edit="${c.id}">Editar</button> <button class="btn perigo peq" data-del="${c.id}">Excluir</button></td></tr>`).join("") || `<tr><td colspan="5" class="vazio">Nenhum cupom.</td></tr>`}
      </tbody></table>`;
    $("#novo-cupom").onclick = () => formCupom();
  };
  async function formCupom(id) {
    const c = id ? await DB.cupons.obter(id) : { codigo: "", tipo: "percentual", valor: "", minimo: 0, ativo: true };
    abrirModal(id ? "Editar cupom" : "Novo cupom", `
      <label>Código<input name="codigo" value="${esc(c.codigo)}" required style="text-transform:uppercase" /></label>
      <div class="grid2">
        <label>Tipo<select name="tipo"><option value="percentual" ${c.tipo === "percentual" ? "selected" : ""}>Percentual (%)</option><option value="fixo" ${c.tipo === "fixo" ? "selected" : ""}>Valor fixo (R$)</option></select></label>
        <label>Valor<input name="valor" type="number" step="0.01" min="0.01" value="${c.valor}" required /></label>
      </div>
      <label>Pedido mínimo (R$)<input name="minimo" type="number" step="0.01" min="0" value="${c.minimo}" /></label>
      <label class="check"><input type="checkbox" name="ativo" ${c.ativo !== false ? "checked" : ""} /> Cupom ativo</label>`,
      async (d) => {
        const codigo = d.codigo.trim().toUpperCase();
        const valor = parseFloat(d.valor);
        if (d.tipo === "percentual" && valor > 100) { toast("Percentual não pode passar de 100"); return false; }
        if ((await DB.cupons.listar()).some((x) => x.codigo === codigo && x.id !== c.id)) { toast("Já existe um cupom com esse código"); return false; }
        if (!(await tentar(() => DB.cupons.salvar({ ...c, codigo, tipo: d.tipo, valor, minimo: parseFloat(d.minimo) || 0, ativo: d.ativo === "on" })))) return false;
        abrirTab("cupons"); toast("Cupom salvo");
      });
  }
  $("#tab-cupons").addEventListener("click", async (e) => {
    const ed = e.target.closest("[data-edit]"), del = e.target.closest("[data-del]");
    if (ed) formCupom(ed.dataset.edit);
    if (del && confirm("Excluir este cupom?")) { if (await tentar(() => DB.cupons.remover(del.dataset.del))) abrirTab("cupons"); }
  });
});
