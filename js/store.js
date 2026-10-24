document.addEventListener("DOMContentLoaded", async () => {
  if (!DB.configurado) return;
  const { moeda, esc } = DB;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  // ---- Estado ----
  let config, produtos = [], categorias = [], cupons = [], fretes = [];
  let categoriaAtiva = "all";
  let termo = "";
  let ordem = "destaque";
  let cupom = null;
  let passo = 1; // etapa do carrinho: 1 produtos, 2 entrega/retirada, 3 pagamento
  // Item do carrinho: { id, vid, qtd } — vid é a variante (vazio quando o produto não tem variantes)
  let carrinho = [];
  try { carrinho = JSON.parse(localStorage.getItem("lo_carrinho")) || []; } catch { carrinho = []; }
  carrinho = carrinho.map((i) => ({ vid: "", ...i }));
  const salvarCarrinho = () => localStorage.setItem("lo_carrinho", JSON.stringify(carrinho));
  const produtoPorId = (id) => produtos.find((p) => p.id === id);
  const temVariantes = (p) => Array.isArray(p.variantes) && p.variantes.length > 0;
  const variante = (p, vid) => (p.variantes || []).find((v) => v.id === vid);
  const estoqueDe = (p, vid) => (temVariantes(p) ? variante(p, vid)?.estoque ?? 0 : p.estoque);
  const chave = (i) => i.id + "|" + i.vid;
  const ativos = () => produtos.filter((p) => p.ativo !== false);
  // categorias podem ter subcategorias (campo "pai")
  const filhosDe = (id) => categorias.filter((c) => c.pai === id);
  const raizes = () => categorias.filter((c) => !c.pai || !categorias.some((x) => x.id === c.pai));
  const idsDaCategoria = (id) => [id, ...filhosDe(id).map((c) => c.id)];
  const expandidas = new Set();
  const expandirDe = (id) => {
    const c = categorias.find((x) => x.id === id);
    if (!c) return;
    if (filhosDe(id).length) expandidas.add(id);
    if (c.pai) expandidas.add(c.pai);
  };

  const toast = (msg) => {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove("show"), 2600);
  };
  const normalizar = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const digitos = (s) => String(s || "").replace(/\D/g, "");
  const pad = (n) => String(n).padStart(2, "0");
  const isoLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const somaDias = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const NOMES_DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  // [1,2,3,4,5,6] → "Seg a Sáb"; [1,3,5] → "Seg, Qua, Sex"
  const descreverDias = (dias) => {
    const d = [...new Set(dias.map(Number))].sort((a, b) => a - b);
    const grupos = [];
    d.forEach((x) => { const g = grupos[grupos.length - 1]; if (g && x === g[g.length - 1] + 1) g.push(x); else grupos.push([x]); });
    return grupos.map((g) => (g.length >= 3 ? `${NOMES_DIAS[g[0]]} a ${NOMES_DIAS[g[g.length - 1]]}` : g.map((x) => NOMES_DIAS[x]).join(", "))).join(", ");
  };
  const linkSocial = (v, base) => { const s = String(v || "").trim(); if (!s) return ""; return /^https?:\/\//i.test(s) ? s : base + s.replace(/^@/, ""); };
  const campoModo = (nome) => (config.campos && config.campos[nome]) || "opcional"; // oculto | opcional | obrigatorio
  const rotulo = (base, nome) => (campoModo(nome) === "obrigatorio" ? base : `${base} (opcional)`);

  // ---- Configurações da loja (tema, textos, seções da página inicial) ----
  const aplicarConfig = () => {
    DB.aplicarTema(config);
    document.title = config.nomeLoja;
    $("#logo-nome").textContent = config.nomeLoja;
    if (config.logoUrl) {
      const img = new Image();
      img.className = "logo-img"; img.alt = ""; img.src = config.logoUrl;
      $("#logo-ico").replaceChildren(img);
    }

    // banner
    const hero = $("#hero");
    // O banner é uma imagem de verdade (e não fundo cortado): aparece a partir do topo, logo depois do cabeçalho
    hero.querySelectorAll(".hero-img").forEach((el) => el.remove());
    hero.classList.toggle("hero--banner", !!config.bannerUrl);
    if (config.bannerUrl) {
      const img = new Image();
      img.className = "hero-img"; img.alt = ""; img.src = config.bannerUrl;
      hero.prepend(img);
    }
    $("#hero-titulo").textContent = config.bannerTitulo || config.nomeLoja;
    $("#hero-slogan").textContent = config.bannerTexto || config.slogan;
    $("#hero-cta-txt").textContent = config.bannerBotao || "Ver produtos";

    // títulos das seções
    $("#tit-categorias").textContent = config.tituloCategorias || "Categorias";
    $("#tit-destaques").textContent = config.tituloDestaques || "Produtos em destaque";
    $("#tit-localizacao").textContent = config.tituloLocalizacao || "Localização";
    $("#tit-contato").textContent = config.tituloContato || "Contato";

    // localização
    const end = (config.endereco || "").trim();
    $("#loja-endereco").textContent = end || "Consulte nosso endereço pelo WhatsApp.";
    $("#loja-horario").textContent = config.horario || "";
    const mapa = $("#loja-mapa"), embed = $("#loja-mapa-embed");
    mapa.hidden = !end;
    if (end) mapa.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(end)}`;
    const comMapa = !!end && config.mostrarMapa !== false;
    embed.hidden = !comMapa;
    if (comMapa) embed.src = `https://www.google.com/maps?q=${encodeURIComponent(end)}&output=embed`;
    $(".info-card").classList.toggle("sem-mapa", !comMapa);
    $("#localizacao").hidden = config.mostrarLocalizacao === false;
    $("#nav-localizacao").hidden = config.mostrarLocalizacao === false;

    // contato
    $("#texto-contato").textContent = config.textoContato || "";
    $("#texto-contato").hidden = !config.textoContato;
    const botoes = [];
    const zap = digitos(config.whatsapp);
    if (zap) botoes.push(`<a class="contact-btn whatsapp" href="https://wa.me/${zap}?text=${encodeURIComponent("Olá! Vim pelo site da " + config.nomeLoja)}" target="_blank" rel="noopener"><i class="fab fa-whatsapp"></i> WhatsApp</a>`);
    if (digitos(config.telefone)) botoes.push(`<a class="contact-btn telefone" href="tel:+${esc(digitos(config.telefone).replace(/^(?!55)/, "55"))}"><i class="fa-solid fa-phone"></i> ${esc(config.telefone)}</a>`);
    if ((config.email || "").trim()) botoes.push(`<a class="contact-btn email" href="mailto:${esc(config.email.trim())}"><i class="fa-regular fa-envelope"></i> ${esc(config.email.trim())}</a>`);
    const ig = linkSocial(config.instagram, "https://instagram.com/");
    if (ig) botoes.push(`<a class="contact-btn instagram" href="${esc(ig)}" target="_blank" rel="noopener"><i class="fab fa-instagram"></i> Instagram</a>`);
    const fb = linkSocial(config.facebook, "https://facebook.com/");
    if (fb) botoes.push(`<a class="contact-btn facebook" href="${esc(fb)}" target="_blank" rel="noopener"><i class="fab fa-facebook-f"></i> Facebook</a>`);
    $("#contact-links").innerHTML = botoes.join("");
    $("#contato").hidden = config.mostrarContato === false || botoes.length === 0 && !config.textoContato;
    $("#nav-contato").hidden = $("#contato").hidden;

    $("#prod-titulo").textContent = config.tituloProdutos || "Produtos";
    $("#prod-subtitulo").textContent = config.subtituloProdutos || "";
    $("#prod-subtitulo").hidden = !config.subtituloProdutos;
    const zf = $("#zap-flutuante");
    zf.hidden = config.zapFlutuante === false || !zap;
    if (zap) zf.href = `https://wa.me/${zap}?text=${encodeURIComponent("Olá! Vim pelo site da " + config.nomeLoja)}`;

    $("#rodape-copy").textContent = config.rodapeTexto || `${new Date().getFullYear()} — ${config.nomeLoja}. Todos os direitos reservados.`;
  };

  // ---- Catálogo ----
  const cardHtml = (p) => {
    const desc = p.precoAntigo > p.preco ? Math.round((1 - p.preco / p.precoAntigo) * 100) : 0;
    const esgotado = p.estoque <= 0;
    const zap = digitos(config.whatsapp);
    const msg = encodeURIComponent(`Olá! Tenho interesse no produto: ${p.nome} (${moeda(p.preco)})`);
    return `
      <article class="card" data-id="${p.id}">
        <div class="tags">
          ${p.destaque ? `<span class="tag">Destaque</span>` : ""}
          ${desc ? `<span class="tag desc">-${desc}%</span>` : ""}
          ${esgotado ? `<span class="tag esgotado">Esgotado</span>` : ""}
        </div>
        <div class="card-acoes">
          ${config.mostrarZapProdutos !== false && zap ? `<a class="card-zap" data-zap href="https://wa.me/${zap}?text=${msg}" target="_blank" rel="noopener" aria-label="Perguntar sobre ${esc(p.nome)} no WhatsApp"><i class="fab fa-whatsapp"></i></a>` : ""}
        </div>
        <img src="${esc(p.imagem || DB.placeholder("📦", "#e5e7eb"))}" alt="${esc(p.nome)}" loading="lazy" draggable="false" />
        <div class="card-info">
          <h3>${esc(p.nome)}</h3>
          <div class="precos">
            ${p.precoAntigo > p.preco ? `<s>${moeda(p.precoAntigo)}</s>` : ""}
            <strong>${moeda(p.preco)}</strong>
          </div>
          <button class="btn-principal" data-add="${p.id}" ${esgotado ? "disabled" : ""}>${esgotado ? "Indisponível" : temVariantes(p) ? "Escolher opção" : "Adicionar"}</button>
        </div>
      </article>`;
  };

  // Página inicial: categorias e produtos em destaque (carrosséis)
  const renderHome = () => {
    const lista = ativos();
    const conta = (id) => { const ids = idsDaCategoria(id); return lista.filter((p) => ids.includes(p.categoria)).length; };
    const cats = raizes().filter((c) => conta(c.id) > 0);
    $("#category-cards").innerHTML = cats.map((c) => `
      <a class="cat-card" href="#produtos/${encodeURIComponent(c.id)}" draggable="false">
        ${c.imagem ? `<img class="cat-foto" src="${esc(c.imagem)}" alt="" loading="lazy" draggable="false" />` : `<i class="fa-solid ${esc(c.icone || "fa-tag")}"></i>`}
        <strong>${esc(c.nome)}</strong>
        <small>${conta(c.id)} ${conta(c.id) === 1 ? "produto" : "produtos"}</small>
      </a>`).join("");
    $("#home-categorias").hidden = config.mostrarCategorias === false || cats.length === 0;

    const qtd = Math.min(24, Math.max(1, parseInt(config.qtdDestaques, 10) || 8));
    let destaques = lista.filter((p) => p.destaque);
    if (!destaques.length) destaques = lista.filter((p) => p.estoque > 0); // sem destaques marcados: mostra os disponíveis
    $("#featured-container").innerHTML = destaques.slice(0, qtd).map(cardHtml).join("");
    $("#home-destaques").hidden = config.mostrarDestaques === false || destaques.length === 0;
    iniciarCarrosseis();
  };

  // Carrossel: setas, rolagem por toque, teclado e arrastar com o mouse
  const iniciarCarrosseis = () => {
    $$("[data-carrossel]").forEach((car) => {
      const trilho = car.querySelector(".car-trilho"), ant = car.querySelector(".prev"), prox = car.querySelector(".next");
      const atualizar = () => {
        const sobra = trilho.scrollWidth - trilho.clientWidth;
        car.toggleAttribute("data-sem-scroll", sobra <= 2);
        ant.disabled = trilho.scrollLeft <= 2;
        prox.disabled = trilho.scrollLeft >= sobra - 2;
      };
      if (!car.dataset.pronto) {
        car.dataset.pronto = "1";
        const mover = (dir) => {
          const dx = dir * Math.max(200, trilho.clientWidth * 0.85);
          if (trilho.scrollBy) trilho.scrollBy({ left: dx, behavior: "smooth" }); else trilho.scrollLeft += dx;
        };
        ant.addEventListener("click", () => mover(-1));
        prox.addEventListener("click", () => mover(1));
        trilho.addEventListener("scroll", atualizar, { passive: true });
        window.addEventListener("resize", atualizar);
        trilho.addEventListener("keydown", (e) => {
          if (e.key === "ArrowRight") { e.preventDefault(); mover(1); }
          if (e.key === "ArrowLeft") { e.preventDefault(); mover(-1); }
        });
        trilho.addEventListener("dragstart", (e) => e.preventDefault());
        let x0 = 0, s0 = 0, segurando = false, moveu = false;
        trilho.addEventListener("pointerdown", (e) => { if (e.pointerType !== "mouse" || e.button !== 0) return; segurando = true; moveu = false; x0 = e.clientX; s0 = trilho.scrollLeft; });
        window.addEventListener("pointermove", (e) => {
          if (!segurando) return;
          const dx = e.clientX - x0;
          if (!moveu && Math.abs(dx) > 5) { moveu = true; trilho.classList.add("arrastando"); }
          if (moveu) trilho.scrollLeft = s0 - dx;
        });
        window.addEventListener("pointerup", () => { if (!segurando) return; segurando = false; trilho.classList.remove("arrastando"); });
        // se o usuário arrastou, não conta como clique (não abre produto nem categoria)
        trilho.addEventListener("click", (e) => { if (moveu) { e.preventDefault(); e.stopPropagation(); moveu = false; } }, true);
      }
      atualizar();
    });
  };

  // Menu lateral de categorias (com subcategorias) e rótulo para o celular
  const renderChips = () => {
    const lista = ativos();
    const conta = (ids) => lista.filter((p) => ids.includes(p.categoria)).length;
    const item = (id, nome, extra = "") => `<button type="button" class="cat-item ${categoriaAtiva === id ? "ativo" : ""}" data-cat="${esc(id)}"><span>${esc(nome)}</span>${extra}</button>`;
    let html = item("all", "Todas");
    raizes().forEach((c) => {
      if (!conta(idsDaCategoria(c.id))) return;
      const filhos = filhosDe(c.id).filter((f) => conta([f.id]) > 0);
      if (!filhos.length) { html += item(c.id, c.nome); return; }
      const aberto = expandidas.has(c.id);
      html += `<div class="cat-grupo">${item(c.id, c.nome)}<button type="button" class="cat-seta" data-expandir="${esc(c.id)}" aria-expanded="${aberto}" aria-label="Subcategorias de ${esc(c.nome)}"><i class="fa-solid fa-chevron-down"></i></button><div class="cat-sub" ${aberto ? "" : "hidden"}>${filhos.map((f) => item(f.id, f.nome)).join("")}</div></div>`;
    });
    $("#chips").innerHTML = html;
    const atual = categoriaAtiva === "all" ? "Todas" : (categorias.find((c) => c.id === categoriaAtiva) || {}).nome || "Todas";
    $("#cat-atual").textContent = atual;
  };

  const selecionarCategoria = (id) => {
    categoriaAtiva = id;
    expandirDe(id);
    renderChips(); renderGrid();
    $("#cat-lateral").classList.remove("aberto");
    $("#cat-toggle").setAttribute("aria-expanded", "false");
    history.replaceState(null, "", "#produtos" + (id === "all" ? "" : "/" + encodeURIComponent(id)));
  };

  const renderGrid = () => {
    let lista = ativos();
    if (categoriaAtiva !== "all") { const ids = idsDaCategoria(categoriaAtiva); lista = lista.filter((p) => ids.includes(p.categoria)); }
    if (termo.trim()) {
      const t = normalizar(termo);
      lista = lista.filter((p) => normalizar(p.nome + " " + (p.descricao || "")).includes(t));
    }
    const ordenadores = {
      destaque: (a, b) => Number(b.destaque) - Number(a.destaque),
      menor: (a, b) => a.preco - b.preco,
      maior: (a, b) => b.preco - a.preco,
      nome: (a, b) => a.nome.localeCompare(b.nome, "pt-BR"),
    };
    lista.sort(ordenadores[ordem]);
    $("#contagem").textContent = `${lista.length} ${lista.length === 1 ? "produto" : "produtos"}`;
    $("#vazio").hidden = lista.length > 0;
    $("#grid").innerHTML = lista.map(cardHtml).join("");
  };

  const abrirProduto = (id) => {
    const p = produtoPorId(id);
    if (!p) return;
    const esgotado = p.estoque <= 0;
    $("#produto-detalhe").innerHTML = `
      <img src="${esc(p.imagem || DB.placeholder("📦", "#e5e7eb"))}" alt="${esc(p.nome)}" />
      <div class="det-info">
        <h2>${esc(p.nome)}</h2>
        <div class="precos">${p.precoAntigo > p.preco ? `<s>${moeda(p.precoAntigo)}</s>` : ""}<strong>${moeda(p.preco)}</strong></div>
        <p>${esc(p.descricao || "")}</p>
        ${temVariantes(p) ? `<div class="variantes" role="radiogroup" aria-label="Opções">${p.variantes.map((v) => `
          <label class="var ${v.estoque <= 0 ? "off" : ""}"><input type="radio" name="vid" value="${esc(v.id)}" ${v.estoque <= 0 ? "disabled" : ""} /><span>${esc(v.nome)}</span></label>`).join("")}</div>` : ""}
        <p class="estoque ${esgotado ? "zero" : ""}">${esgotado ? "Esgotado" : p.estoque <= 5 ? `Restam apenas ${p.estoque}` : "Em estoque"}</p>
        <button class="btn-principal" data-add="${p.id}" ${esgotado ? "disabled" : ""}>Adicionar ao carrinho</button>
      </div>`;
    $("#modal-produto").hidden = false;
  };

  // ---- Navegação entre Início e Produtos (usa o # da URL) ----
  const rotear = () => {
    const [raiz, sub] = decodeURIComponent(location.hash.replace(/^#/, "")).split("/");
    const emProdutos = raiz === "produtos";
    $("#view-inicio").hidden = emProdutos;
    $("#view-produtos").hidden = !emProdutos;
    let ativo = emProdutos ? "produtos" : "inicio";
    if (emProdutos) {
      categoriaAtiva = sub && categorias.some((c) => c.id === sub) ? sub : "all";
      expandirDe(categoriaAtiva);
      renderChips(); renderGrid();
      window.scrollTo({ top: 0 });
    } else if ((raiz === "localizacao" || raiz === "contato") && !$("#" + raiz).hidden) {
      ativo = raiz;
      $("#" + raiz).scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      window.scrollTo({ top: 0 });
    }
    if (!emProdutos) iniciarCarrosseis();
    $$("#main-nav a").forEach((a) => a.classList.toggle("ativo", a.dataset.nav === ativo));
    const atual = $("#main-nav a.ativo");
    if (atual && atual.scrollIntoView) atual.scrollIntoView({ block: "nearest", inline: "center" });
  };
  window.addEventListener("hashchange", rotear);

  // ---- Carrinho ----
  const adicionar = (id, vid = "") => {
    const p = produtoPorId(id);
    if (!p) return;
    const disponivel = estoqueDe(p, vid);
    if (disponivel <= 0) return toast("Indisponível");
    const item = carrinho.find((i) => i.id === id && i.vid === vid);
    if (item) {
      if (item.qtd >= disponivel) return toast("Estoque máximo atingido");
      item.qtd++;
    } else carrinho.push({ id, vid, qtd: 1 });
    renderCarrinho();
    toast(`${p.nome}${vid ? " (" + variante(p, vid).nome + ")" : ""} adicionado`);
  };

  // Itens do carrinho resolvidos contra o catálogo atual (descarta removidos/ajusta estoque)
  const itensResolvidos = () => {
    carrinho = carrinho.filter((i) => {
      const p = produtoPorId(i.id);
      if (!p || p.ativo === false) return false;
      if (temVariantes(p) !== !!i.vid) return false;
      const est = estoqueDe(p, i.vid);
      if (est <= 0) return false;
      i.qtd = Math.min(i.qtd, est);
      return true;
    });
    return carrinho.map((i) => ({ ...i, p: produtoPorId(i.id), nomeVar: i.vid ? variante(produtoPorId(i.id), i.vid).nome : "" }));
  };

  const regiaoSelecionada = () => fretes.find((f) => f.id === $("#regiao").value) || null;

  const calcular = () => {
    const itens = itensResolvidos();
    const subtotal = itens.reduce((s, i) => s + i.p.preco * i.qtd, 0);
    let desconto = 0;
    if (cupom) {
      if (subtotal < cupom.minimo) cupom = null;
      else desconto = Math.min(subtotal, cupom.tipo === "percentual" ? subtotal * cupom.valor / 100 : cupom.valor);
    }
    const retirada = document.querySelector('[name="entrega"]:checked').value === "retirada";
    const regiao = retirada ? null : regiaoSelecionada();
    const precisaRegiao = !retirada && fretes.length > 0;
    const base = precisaRegiao ? (regiao ? Number(regiao.valor) || 0 : 0) : Number(config.taxaEntrega) || 0;
    const gratis = config.freteGratisAcima > 0 && subtotal - desconto >= config.freteGratisAcima;
    const frete = retirada || itens.length === 0 || gratis ? 0 : base;
    return { itens, subtotal, desconto, frete, total: subtotal - desconto + frete, retirada, regiao, precisaRegiao, gratis };
  };

  const renderCarrinho = () => {
    const r = calcular();
    const qtdTotal = r.itens.reduce((s, i) => s + i.qtd, 0);
    $("#cart-badge").textContent = qtdTotal;
    $("#cart-badge").hidden = qtdTotal === 0;
    const vazio = r.itens.length === 0;
    $("#passos").hidden = vazio;
    $("#drawer-foot").hidden = vazio;
    if (vazio && passo !== 1) { passo = 1; mostrarPasso(); }
    const minimo = Number(config.pedidoMinimo) || 0;
    const aviso = !vazio && minimo > 0 && r.subtotal < minimo
      ? `<p class="cart-aviso"><i class="fa-solid fa-circle-info"></i> Pedido mínimo de ${moeda(minimo)}. Faltam ${moeda(minimo - r.subtotal)}.</p>` : "";
    $("#cart-itens").innerHTML = vazio
      ? `<p class="vazio">Seu carrinho está vazio.</p><button type="button" class="btn-sec cart-continuar" data-fechar-carrinho>Continuar comprando</button>`
      : r.itens.map((i) => `
        <div class="cart-item">
          <img src="${esc(i.p.imagem)}" alt="" />
          <div class="ci-info">
            <strong>${esc(i.p.nome)}</strong>
            ${i.nomeVar ? `<span class="ci-var">${esc(i.nomeVar)}</span>` : ""}
            <span>${moeda(i.p.preco)}</span>
            <div class="qtd">
              <button type="button" data-menos="${esc(chave(i))}">−</button><span>${i.qtd}</span><button type="button" data-mais="${esc(chave(i))}">+</button>
            </div>
          </div>
          <button type="button" class="remover" data-rem="${esc(chave(i))}" aria-label="Remover"><i class="fa-solid fa-trash"></i></button>
        </div>`).join("") + aviso + `<p class="cart-dica">Na próxima etapa você informa como quer receber seu pedido.</p>
        <button type="button" class="link-btn cart-continuar" data-fechar-carrinho>+ Adicionar mais produtos</button>`;
    $("#mini-total").textContent = moeda(passo === 1 ? r.subtotal - r.desconto : r.total);
    $("#r-sub").textContent = moeda(r.subtotal);
    $("#r-desc-linha").hidden = !r.desconto;
    $("#r-desc").textContent = "- " + moeda(r.desconto);
    $("#r-frete").textContent = r.retirada ? "Retirada" : r.precisaRegiao && !r.regiao ? "Escolha a região" : r.frete ? moeda(r.frete) : "Grátis";
    $("#r-total").textContent = moeda(r.total);
    salvarCarrinho();
  };

  const abrirDrawer = () => {
    $("#drawer").classList.add("show"); $("#overlay").classList.add("show"); document.body.classList.add("no-scroll");
    if (!carrinho.length) passo = 1;
    mostrarPasso(); renderCarrinho();
  };
  const fecharDrawer = () => { $("#drawer").classList.remove("show"); $("#overlay").classList.remove("show"); document.body.classList.remove("no-scroll"); };
  const fecharModais = () => { $("#modal-produto").hidden = true; $("#modal-sucesso").hidden = true; };

  // ---- Eventos gerais ----
  document.addEventListener("click", (e) => {
    const ir = e.target.closest("[data-ir]");
    if (ir) return irPara(+ir.dataset.ir);
    if (e.target.closest("[data-fechar-carrinho]")) return fecharDrawer();
    const copiar = e.target.closest("[data-copiar]");
    if (copiar) {
      const texto = copiar.dataset.copiar;
      (navigator.clipboard ? navigator.clipboard.writeText(texto) : Promise.reject()).then(() => toast("Chave PIX copiada"), () => toast("Copie manualmente: " + texto));
      return;
    }
    if (e.target.closest("[data-zap]")) { e.stopPropagation(); return; } // deixa o link do WhatsApp abrir
    const exp = e.target.closest("[data-expandir]");
    if (exp) {
      const id = exp.dataset.expandir;
      if (expandidas.has(id)) expandidas.delete(id); else expandidas.add(id);
      renderChips();
      return;
    }
    const tog = e.target.closest("#cat-toggle");
    if (tog) {
      const lateral = $("#cat-lateral");
      lateral.classList.toggle("aberto");
      tog.setAttribute("aria-expanded", String(lateral.classList.contains("aberto")));
      return;
    }
    const add = e.target.closest("[data-add]");
    if (add) {
      e.stopPropagation();
      const p = produtoPorId(add.dataset.add);
      if (!p) return;
      if (!temVariantes(p)) return adicionar(p.id);
      if (!add.closest("#produto-detalhe")) return abrirProduto(p.id);
      const sel = document.querySelector('#produto-detalhe input[name="vid"]:checked');
      if (!sel) return toast("Escolha uma opção");
      adicionar(p.id, sel.value);
      return;
    }
    const cat = e.target.closest("[data-cat]");
    if (cat) { selecionarCategoria(cat.dataset.cat); return; }
    const card = e.target.closest(".card");
    if (card) return abrirProduto(card.dataset.id);
    if (e.target.matches("[data-fechar]") || e.target.classList.contains("modal")) fecharModais();

    const alvo = (attr) => { const b = e.target.closest(`[${attr}]`); return b && carrinho.find((i) => chave(i) === b.getAttribute(attr)); };
    const mais = alvo("data-mais"), menos = alvo("data-menos"), rem = alvo("data-rem");
    if (mais) adicionar(mais.id, mais.vid);
    if (menos && --menos.qtd <= 0) carrinho = carrinho.filter((i) => i !== menos);
    if (rem) carrinho = carrinho.filter((i) => i !== rem);
    if (menos || rem) renderCarrinho();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { fecharModais(); fecharDrawer(); } });
  $("#busca").addEventListener("input", (e) => { termo = e.target.value; renderGrid(); });
  $("#ordem").addEventListener("change", (e) => { ordem = e.target.value; renderGrid(); });
  $("#abrir-carrinho").addEventListener("click", abrirDrawer);
  $("#fechar-carrinho").addEventListener("click", fecharDrawer);
  $("#overlay").addEventListener("click", fecharDrawer);

  // ---- Checkout ----
  const form = $("#checkout");
  let modos = { entrega: true, retirada: true };

  const montarRegioes = () => {
    const sel = $("#regiao");
    fretes = fretes.filter((f) => f.ativo !== false).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    sel.hidden = fretes.length === 0;
    sel.innerHTML = `<option value="" disabled selected>Região de entrega</option>` +
      fretes.map((f) => `<option value="${esc(f.id)}">${esc(f.nome)} — ${moeda(f.valor)}${f.prazo ? " · " + esc(f.prazo) : ""}</option>`).join("");
    sel.onchange = renderCarrinho;
  };

  const modoEscolhido = () => (form.querySelector('[name="entrega"]:checked') || {}).value;
  const pagamentoEscolhido = () => (form.querySelector('[name="pagamento"]:checked') || {}).value;

  // Aplica as configurações ao formulário: modos de entrega, campos do cadastro, retirada e pagamentos
  const aplicarCheckout = () => {
    // entrega / retirada
    let ent = config.entregaAtiva !== false, ret = config.retiradaAtiva !== false;
    if (!ent && !ret) ent = ret = true; // configuração inválida: não deixa a loja sem opção de recebimento
    modos = { entrega: ent, retirada: ret };
    $("#lbl-entrega").hidden = !ent;
    $("#lbl-retirada").hidden = !ret;
    $("#toggle-modo").hidden = !(ent && ret);
    $("#modo-titulo").textContent = ent && ret ? "Como você prefere receber?" : ent ? "Entrega" : "Retirada na loja";
    form.querySelector(`[name="entrega"][value="${ent ? "entrega" : "retirada"}"]`).checked = true;
    const aviso = (config.entregaAviso || "").trim();
    $("#entrega-aviso").hidden = !aviso;
    $("#entrega-aviso").textContent = aviso;

    // campos do cadastro (oculto / opcional / obrigatório)
    $$("[data-campo]").forEach((el) => { el.hidden = campoModo(el.dataset.campo) === "oculto"; });
    form.email.placeholder = rotulo("E-mail", "email");
    form.cpf.placeholder = rotulo("CPF ou CNPJ", "cpf");
    form.cep.placeholder = rotulo("CEP", "cep");
    form.complemento.placeholder = rotulo("Complemento", "complemento");
    form.obs.placeholder = rotulo("Observações", "obs");

    montarRetirada();

    // formas de pagamento
    const pg = config.pagamentos || {};
    let algum = false;
    $$("#opcoes-pg label").forEach((l) => { const on = pg[l.dataset.pg] !== false; l.hidden = !on; algum = algum || on; });
    if (!algum) $$("#opcoes-pg label").forEach((l) => { l.hidden = false; });
    const primeira = $$("#opcoes-pg label").find((l) => !l.hidden);
    primeira.querySelector("input").checked = true;
    const avisoPg = (config.pagamentoAviso || "").trim();
    $("#pagamento-aviso").hidden = !avisoPg;
    $("#pagamento-aviso").textContent = avisoPg;
    atualizarPagamento();
  };

  // Retirada: horários, datas permitidas e informações do local
  const montarRetirada = () => {
    const [hi, mi] = String(config.retiradaHoraInicio || "09:00").split(":").map(Number);
    const [hf, mf] = String(config.retiradaHoraFim || "18:00").split(":").map(Number);
    const passoMin = Math.max(5, parseInt(config.retiradaIntervalo, 10) || 60);
    let opcoes = `<option value="" disabled selected>Hora</option>`;
    for (let m = hi * 60 + mi; m <= hf * 60 + mf; m += passoMin) opcoes += `<option value="${pad(Math.floor(m / 60))}:${pad(m % 60)}">${pad(Math.floor(m / 60))}:${pad(m % 60)}</option>`;
    form.hora.innerHTML = opcoes;
    const hoje = new Date();
    form.data.min = isoLocal(somaDias(hoje, Math.max(0, parseInt(config.retiradaAntecedenciaDias, 10) || 0)));
    form.data.max = isoLocal(somaDias(hoje, Math.max(1, parseInt(config.retiradaMaxDias, 10) || 30)));
    const dias = (config.retiradaDias || []).map(Number);
    const local = (config.retiradaEndereco || config.endereco || "").trim();
    $("#retirada-info").innerHTML = `<strong><i class="fa-solid fa-store"></i> Retirada na loja</strong>` +
      (local ? `<span>${esc(local)}</span>` : "") +
      `<span>${dias.length ? `${esc(descreverDias(dias))} · ` : ""}${esc(config.retiradaHoraInicio || "")} às ${esc(config.retiradaHoraFim || "")}</span>` +
      ((config.retiradaInstrucoes || "").trim() ? `<span>${esc(config.retiradaInstrucoes.trim())}</span>` : "");
  };

  const atualizarPagamento = () => {
    const forma = pagamentoEscolhido();
    form.troco.hidden = forma !== "Dinheiro";
    const chavePix = (config.pixChave || "").trim();
    const box = $("#pix-info");
    box.hidden = !(forma === "PIX" && chavePix);
    if (!box.hidden) box.innerHTML = `<span>Chave PIX: <b class="pix-chave">${esc(chavePix)}</b></span><button type="button" class="link-btn" data-copiar="${esc(chavePix)}"><i class="fa-regular fa-copy"></i> Copiar chave</button>`;
  };
  form.querySelectorAll('[name="pagamento"]').forEach((r) => r.addEventListener("change", atualizarPagamento));

  const atualizarModo = () => {
    const retirada = modoEscolhido() === "retirada";
    $("#campos-entrega").hidden = retirada;
    $("#campos-retirada").hidden = !retirada;
    form.endereco.required = !retirada;
    $("#regiao").required = !retirada && fretes.length > 0;
    form.data.required = retirada;
    form.hora.required = retirada;
    form.cep.required = !retirada && campoModo("cep") === "obrigatorio";
    form.complemento.required = !retirada && campoModo("complemento") === "obrigatorio";
    form.email.required = campoModo("email") === "obrigatorio";
    form.cpf.required = campoModo("cpf") === "obrigatorio";
    form.obs.required = campoModo("obs") === "obrigatorio";
    renderCarrinho();
  };
  form.querySelectorAll('[name="entrega"]').forEach((r) => r.addEventListener("change", atualizarModo));

  // ---- Etapas do carrinho: 1 Produtos → 2 Entrega/Retirada → 3 Pagamento ----
  function mostrarPasso() {
    $$(".passo").forEach((sec) => { sec.hidden = +sec.dataset.passo !== passo; });
    $$("#passos li").forEach((li) => {
      const k = +li.dataset.p;
      li.classList.toggle("atual", k === passo);
      li.classList.toggle("feito", k < passo);
      li.querySelector("span").innerHTML = k < passo ? '<i class="fa-solid fa-check"></i>' : String(k);
      if (k === passo) li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current");
    });
    $("#passo-voltar").hidden = passo === 1;
    $("#passo-avancar").innerHTML = passo === 3 ? '<i class="fab fa-whatsapp"></i> Finalizar pedido' : 'Continuar <i class="fa-solid fa-arrow-right"></i>';
    $("#mini-rotulo").textContent = passo === 1 ? "Subtotal" : "Total";
  }
  function irPara(n) {
    passo = n;
    mostrarPasso();
    if (passo === 3) desenharResumoEntrega();
    renderCarrinho();
    $(".drawer-body").scrollTop = 0;
    const primeiro = document.querySelector(`.passo[data-passo="${n}"] input:not([type="radio"]):not([hidden]), .passo[data-passo="${n}"] select:not([hidden])`);
    if (primeiro && n === 2 && !primeiro.value && window.matchMedia && !window.matchMedia("(pointer: coarse)").matches) primeiro.focus();
  }
  function desenharResumoEntrega() {
    const f = Object.fromEntries(new FormData(form));
    const r = calcular();
    const botao = `<button type="button" class="link-btn" data-ir="2">Alterar</button>`;
    $("#resumo-entrega").innerHTML = f.entrega === "retirada"
      ? `<i class="fa-solid fa-store"></i><div><strong>Retirada na loja</strong><span>${esc(f.nome)} · ${esc((f.data || "").split("-").reverse().join("/"))} às ${esc(f.hora || "")}</span></div>${botao}`
      : `<i class="fa-solid fa-truck-fast"></i><div><strong>Entrega${r.regiao ? " — " + esc(r.regiao.nome) : ""}</strong><span>${esc(f.nome)} · ${esc([f.endereco, f.complemento].filter(Boolean).join(", "))}</span></div>${botao}`;
  }
  const invalido = (el, msg) => {
    el.setCustomValidity(msg);
    el.reportValidity();
    el.addEventListener("input", () => el.setCustomValidity(""), { once: true });
    return false;
  };
  const validarPasso = (n) => {
    if (n === 1) {
      const r = calcular();
      if (!r.itens.length) { toast("Seu carrinho está vazio"); return false; }
      const minimo = Number(config.pedidoMinimo) || 0;
      if (minimo > 0 && r.subtotal < minimo) { toast(`Pedido mínimo de ${moeda(minimo)}. Faltam ${moeda(minimo - r.subtotal)}.`); return false; }
      return true;
    }
    const campos = $$(`.passo[data-passo="${n}"] input, .passo[data-passo="${n}"] select, .passo[data-passo="${n}"] textarea`)
      .filter((el) => el.type !== "radio" && !el.closest("[hidden]") && !el.hidden);
    for (const el of campos) if (!el.checkValidity()) { el.reportValidity(); return false; }
    if (n === 2) {
      if (form.nome.value.trim().length < 2) return invalido(form.nome, "Informe seu nome");
      if (digitos(form.telefone.value).length < 10) return invalido(form.telefone, "Informe o telefone com DDD");
      if (!form.cpf.closest("[hidden]") && form.cpf.value.trim() && ![11, 14].includes(digitos(form.cpf.value).length)) return invalido(form.cpf, "Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido");
      if (modoEscolhido() === "retirada") {
        const dias = (config.retiradaDias || []).map(Number);
        const dia = new Date(form.data.value + "T12:00:00");
        if (form.data.value < form.data.min) return invalido(form.data, "Escolha uma data a partir de " + form.data.min.split("-").reverse().join("/"));
        if (form.data.value > form.data.max) return invalido(form.data, "Data muito distante. Escolha até " + form.data.max.split("-").reverse().join("/"));
        if (dias.length && !dias.includes(dia.getDay())) return invalido(form.data, `Retirada indisponível neste dia. Dias de retirada: ${descreverDias(dias)}.`);
        const agora = new Date();
        if (form.data.value === isoLocal(agora) && form.hora.value <= `${pad(agora.getHours())}:${pad(agora.getMinutes())}`) return invalido(form.hora, "Escolha um horário depois do horário atual.");
      }
    }
    if (n === 3 && !form.troco.hidden && form.troco.value !== "") {
      const total = calcular().total;
      if (parseFloat(form.troco.value) < total) return invalido(form.troco, `O valor para troco deve ser de pelo menos ${moeda(total)}`);
    }
    return true;
  };
  const avancar = () => { if (validarPasso(passo)) irPara(passo + 1); };
  // O botão é sempre type="button" (trocar o tipo durante o clique faria o navegador enviar o formulário).
  // Na etapa 3 ele dispara o envio; o Enter nos campos usa o botão de envio oculto do formulário.
  $("#passo-avancar").addEventListener("click", () => {
    if (passo < 3) avancar();
    else form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  $("#passo-voltar").addEventListener("click", () => irPara(Math.max(1, passo - 1)));
  // só dá para voltar clicando nas etapas já concluídas
  $("#passos").addEventListener("click", (e) => { const li = e.target.closest("li.feito"); if (li) irPara(+li.dataset.p); });

  form.cep.addEventListener("input", () => {
    const d = form.cep.value.replace(/\D/g, "").slice(0, 8);
    form.cep.value = d.length > 5 ? d.slice(0, 5) + "-" + d.slice(5) : d;
  });
  form.telefone.addEventListener("input", () => {
    const d = form.telefone.value.replace(/\D/g, "").slice(0, 11);
    form.telefone.value = d.length > 6 ? `(${d.slice(0, 2)}) ${d.slice(2, d.length > 10 ? 7 : 6)}-${d.slice(d.length > 10 ? 7 : 6)}` : d.length > 2 ? `(${d.slice(0, 2)}) ${d.slice(2)}` : d;
  });
  $("#buscar-cep").addEventListener("click", async () => {
    const cep = form.cep.value.replace(/\D/g, "");
    if (cep.length !== 8) return toast("CEP inválido");
    try {
      const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const d = await r.json();
      if (d.erro) return toast("CEP não encontrado");
      form.endereco.value = [d.logradouro, d.bairro, `${d.localidade}/${d.uf}`].filter(Boolean).join(", ");
      // seleciona a região de frete cujo nome coincide com o bairro ou a cidade
      const bairro = normalizar(d.bairro), cidade = normalizar(d.localidade);
      const achou = fretes.find((f) => normalizar(f.nome) === bairro) || fretes.find((f) => normalizar(f.nome) === cidade)
        || fretes.find((f) => bairro && normalizar(f.nome).includes(bairro));
      if (achou) { $("#regiao").value = achou.id; renderCarrinho(); }
      form.endereco.focus();
    } catch { toast("Não foi possível buscar o CEP"); }
  });

  $("#aplicar-cupom").addEventListener("click", () => {
    const cod = $("#cupom").value.trim().toUpperCase();
    const msg = $("#cupom-msg");
    const c = cupons.find((x) => x.ativo !== false && x.codigo.toUpperCase() === cod);
    const { subtotal } = calcular();
    msg.className = "feedback erro";
    if (!cod) { cupom = null; msg.textContent = ""; }
    else if (!c) { cupom = null; msg.textContent = "Cupom inválido."; }
    else if (subtotal < c.minimo) { cupom = null; msg.textContent = `Pedido mínimo de ${moeda(c.minimo)} para este cupom.`; }
    else { cupom = c; msg.className = "feedback ok"; msg.textContent = `Cupom ${c.codigo} aplicado!`; }
    renderCarrinho();
  });

  // Código imprevisível (o acompanhamento público é protegido por ele): 8 caracteres, ~40 bits
  const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const codigoPedido = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => ALFABETO[b % ALFABETO.length]).join("");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (passo < 3) { avancar(); return; }
    for (const n of [1, 2, 3]) {
      if (!validarPasso(n)) { if (n !== passo) { irPara(n); validarPasso(n); } return; }
    }
    const botao = $("#passo-avancar");
    if (carrinho.length === 0) return toast("Carrinho vazio");
    botao.disabled = true;
    try {
      // revalida estoque e preços com o servidor
      produtos = await DB.produtos.listar();
      const antes = JSON.stringify(carrinho.map((i) => [chave(i), i.qtd]));
      const r = calcular();
      if (JSON.stringify(carrinho.map((i) => [chave(i), i.qtd])) !== antes || r.itens.length === 0) {
        renderGrid(); renderHome(); irPara(1);
        return toast("Alguns itens mudaram de estoque. Revise o carrinho.");
      }
      if (r.precisaRegiao && !r.regiao) { irPara(2); return toast("Escolha a região de entrega"); }

      const f = Object.fromEntries(new FormData(form));
      const codigo = codigoPedido();
      const cliente = { nome: f.nome.trim(), telefone: f.telefone };
      if ((f.email || "").trim()) cliente.email = f.email.trim();
      if ((f.cpf || "").trim()) cliente.cpf = digitos(f.cpf);
      const pedido = {
        codigo, criadoEm: new Date().toISOString(), status: "novo", estoqueBaixado: false,
        cliente,
        tipo: f.entrega,
        endereco: f.entrega === "entrega" ? [f.endereco, f.complemento, f.cep && "CEP " + f.cep].filter(Boolean).join(" — ") : "",
        regiao: r.regiao ? r.regiao.nome : "",
        retirada: f.entrega === "retirada" ? `${f.data} ${f.hora}` : "",
        pagamento: f.pagamento, troco: f.pagamento === "Dinheiro" ? f.troco : "", obs: f.obs || "",
        itens: r.itens.map((i) => ({ id: i.id, vid: i.vid, variante: i.nomeVar, nome: i.p.nome, preco: i.p.preco, qtd: i.qtd })),
        subtotal: r.subtotal, desconto: r.desconto, cupom: cupom ? cupom.codigo : "", frete: r.frete, total: r.total,
      };
      await DB.pedidos.criar(pedido);

      const chavePix = (config.pixChave || "").trim();
      const linkAcomp = new URL("acompanhar.html?c=" + codigo, location.href).href;
      const linhas = [
        `*Pedido #${codigo} — ${config.nomeLoja}*`, "",
        ...pedido.itens.map((i) => `• ${i.qtd}x ${i.nome}${i.variante ? ` (${i.variante})` : ""} — ${moeda(i.preco * i.qtd)}`), "",
        `Subtotal: ${moeda(r.subtotal)}`,
        r.desconto ? `Desconto (${pedido.cupom}): -${moeda(r.desconto)}` : null,
        `Entrega: ${r.retirada ? "Retirada" : r.frete ? moeda(r.frete) + (pedido.regiao ? ` (${pedido.regiao})` : "") : "Grátis"}`,
        `*Total: ${moeda(r.total)}*`, "",
        `Cliente: ${cliente.nome} (${cliente.telefone})`,
        cliente.email ? `E-mail: ${cliente.email}` : null,
        cliente.cpf ? `CPF/CNPJ: ${cliente.cpf}` : null,
        r.retirada ? `Retirada: ${f.data.split("-").reverse().join("/")} às ${f.hora}` : `Endereço: ${pedido.endereco}`,
        `Pagamento: ${pedido.pagamento}${pedido.troco ? ` (troco para ${moeda(pedido.troco)})` : ""}`,
        pedido.pagamento === "PIX" && chavePix ? `Chave PIX: ${chavePix}` : null,
        pedido.obs ? `Obs: ${pedido.obs}` : null,
        "", `Acompanhar: ${linkAcomp}`,
        (config.textoFinalWhats || "").trim() ? "" : null, (config.textoFinalWhats || "").trim() || null,
      ].filter((l) => l !== null);

      $("#sucesso-texto").textContent = config.textoSucesso || "Guarde o código para acompanhar:";
      $("#sucesso-codigo").textContent = codigo;
      $("#sucesso-link").href = "acompanhar.html?c=" + codigo;
      $("#sucesso-whats").href = `https://wa.me/${digitos(config.whatsapp)}?text=${encodeURIComponent(linhas.join("\n"))}`;
      const pixBox = $("#sucesso-pix");
      pixBox.hidden = !(pedido.pagamento === "PIX" && chavePix);
      if (!pixBox.hidden) pixBox.innerHTML = `<span>Pague <b>${moeda(r.total)}</b> via PIX para a chave:</span><b class="pix-chave">${esc(chavePix)}</b><button type="button" class="link-btn" data-copiar="${esc(chavePix)}"><i class="fa-regular fa-copy"></i> Copiar chave</button>`;
      try { localStorage.setItem("lo_ultimo_pedido", codigo); } catch { /* ignorado */ }

      carrinho = []; cupom = null; form.reset(); $("#cupom-msg").textContent = "";
      passo = 1; mostrarPasso();
      aplicarCheckout();
      atualizarModo();
      fecharDrawer();
      $("#modal-sucesso").hidden = false;
    } catch (err) {
      console.error(err);
      toast("Não foi possível enviar o pedido. Tente novamente.");
    } finally {
      botao.disabled = false;
    }
  });

  // ---- Carga inicial ----
  $("#grid").innerHTML = `<p class="vazio">Carregando...</p>`;
  try {
    [config, produtos, categorias, cupons, fretes] = await Promise.all([
      DB.config.obter(), DB.produtos.listar(), DB.categorias.listar(), DB.cupons.listar(), DB.fretes.listar(),
    ]);
  } catch (err) {
    console.error(err);
    $("#grid").innerHTML = `<p class="vazio">Não foi possível carregar a loja. Verifique a configuração do Firebase e as regras do Firestore.</p>`;
    return;
  }
  aplicarConfig();
  montarRegioes();
  aplicarCheckout();
  renderHome();
  renderChips();
  renderGrid();
  atualizarModo();
  rotear();
});
