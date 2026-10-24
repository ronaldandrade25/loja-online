// Camada de dados compartilhada pela loja e pelo admin (Firebase: Firestore + Auth).
(function () {
  const cfg = window.firebaseConfig;
  const configurado = !!(cfg && cfg.apiKey && !/^COLE/.test(cfg.apiKey));

  if (!configurado) {
    document.addEventListener("DOMContentLoaded", () => {
      const aviso = document.createElement("div");
      aviso.style.cssText = "position:fixed;inset:0;z-index:999;background:#fff;color:#111;display:grid;place-items:center;padding:24px;text-align:center;font-family:system-ui,sans-serif";
      aviso.innerHTML = "<div><h2>Firebase não configurado</h2><p style='margin-top:8px'>Edite o arquivo <b>firebase-config.js</b> com os dados do seu projeto.<br>Passo a passo em <b>README.md</b>.</p></div>";
      document.body.appendChild(aviso);
    });
  } else {
    firebase.initializeApp(cfg);
  }

  const fs = configurado ? firebase.firestore() : null;
  const auth = configurado && firebase.auth ? firebase.auth() : null;

  // Todas as opções editáveis em Admin → Configurações. Os valores abaixo valem enquanto nada foi salvo.
  const CONFIG_PADRAO = {
    // Loja e contato
    nomeLoja: "Loja Online",
    slogan: "Tudo o que você precisa, em um só lugar",
    whatsapp: "5500000000000",
    telefone: "",
    email: "",
    instagram: "",
    facebook: "",
    endereco: "",
    horario: "Seg a Sex, 9h às 18h",
    mostrarMapa: true,
    siteUrl: "",           // endereço público da loja (QR Code e link copiado); em branco = endereço atual do painel
    zapFlutuante: true,
    // Aparência
    corPrimaria: "#4f46e5",
    corSecundaria: "#111827",
    corDestaque: "#dc2626",
    corFundo: "#f6f7fb",
    corTexto: "#1f2937",
    fonte: "sistema",        // sistema | elegante | moderna
    cantos: "suave",         // reto | suave | arredondado
    logoUrl: "",
    bannerUrl: "",
    bannerTitulo: "",
    bannerTexto: "",
    bannerBotao: "Ver produtos",
    // Página inicial
    mostrarCategorias: true,
    mostrarDestaques: true,
    mostrarLocalizacao: true,
    mostrarContato: true,
    tituloCategorias: "Categorias",
    tituloDestaques: "Produtos em destaque",
    qtdDestaques: 8,
    tituloLocalizacao: "Localização",
    tituloContato: "Contato",
    textoContato: "Fale com a gente pelo WhatsApp.",
    // Página de produtos
    tituloProdutos: "Produtos",
    subtituloProdutos: "Catálogo completo",
    mostrarZapProdutos: true,
    // Entrega e retirada
    entregaAtiva: true,
    retiradaAtiva: true,
    taxaEntrega: 10,
    freteGratisAcima: 200,
    entregaAviso: "",
    pedidoMinimo: 0,
    retiradaEndereco: "",
    retiradaInstrucoes: "",
    retiradaDias: [1, 2, 3, 4, 5, 6],
    retiradaHoraInicio: "09:00",
    retiradaHoraFim: "18:00",
    retiradaIntervalo: 60,
    retiradaAntecedenciaDias: 0,
    retiradaMaxDias: 30,
    // Cadastro do cliente no pedido (oculto | opcional | obrigatorio). Nome e WhatsApp são sempre obrigatórios.
    campos: { email: "oculto", cpf: "oculto", cep: "opcional", complemento: "opcional", obs: "opcional" },
    // Pagamento
    pagamentos: { pix: true, credito: true, debito: true, dinheiro: true },
    pixChave: "",
    pagamentoAviso: "",
    // Estoque
    estoqueMinimoPadrao: 5,  // alerta de estoque baixo quando o produto não tem mínimo próprio
    // Impressora térmica e avisos de pedido (painel administrativo)
    impressaoAutoSite: false,
    impressaoAutoPdv: false,
    impressoraLargura: 32,   // colunas: 32 (papel 58 mm) ou 48 (papel 80 mm)
    avisoPedidoSite: true,
    avisoSom: true,
    // Textos
    textoSucesso: "Recebemos seu pedido! Guarde o código para acompanhar.",
    textoFinalWhats: "",
    rodapeTexto: "",
  };
  const mesclarConfig = (salvo) => ({
    ...CONFIG_PADRAO, ...salvo,
    campos: { ...CONFIG_PADRAO.campos, ...((salvo && salvo.campos) || {}) },
    pagamentos: { ...CONFIG_PADRAO.pagamentos, ...((salvo && salvo.pagamentos) || {}) },
  });

  // ---- Tema (cores, fonte, cantos) usado pela loja e pela página de acompanhamento ----
  const FONTES = {
    sistema: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    elegante: 'Georgia, "Times New Roman", serif',
    moderna: '"Trebuchet MS", "Segoe UI", Tahoma, sans-serif',
  };
  const CANTOS = { reto: ["4px", "2px"], suave: ["12px", "8px"], arredondado: ["22px", "14px"] };
  const corValida = (c, padrao) => (/^#[0-9a-f]{6}$/i.test(c || "") ? c : padrao);
  const luminancia = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  // cor de texto (clara ou escura) com melhor contraste sobre o fundo informado
  const contraste = (hex) => { const L = luminancia(corValida(hex, "#000000")); return 1.05 / (L + 0.05) >= (L + 0.05) / 0.05 ? "#ffffff" : "#111827"; };
  const aplicarTema = (c) => {
    const p = corValida(c.corPrimaria, CONFIG_PADRAO.corPrimaria), s = corValida(c.corSecundaria, CONFIG_PADRAO.corSecundaria);
    const root = document.documentElement.style;
    root.setProperty("--primaria", p);
    root.setProperty("--secundaria", s);
    root.setProperty("--on-primaria", contraste(p));
    root.setProperty("--on-secundaria", contraste(s));
    root.setProperty("--destaque", corValida(c.corDestaque, CONFIG_PADRAO.corDestaque));
    root.setProperty("--on-destaque", contraste(corValida(c.corDestaque, CONFIG_PADRAO.corDestaque)));
    root.setProperty("--bg", corValida(c.corFundo, CONFIG_PADRAO.corFundo));
    root.setProperty("--texto", corValida(c.corTexto, CONFIG_PADRAO.corTexto));
    root.setProperty("--fonte", FONTES[c.fonte] || FONTES.sistema);
    const [r1, r2] = CANTOS[c.cantos] || CANTOS.suave;
    root.setProperty("--raio", r1);
    root.setProperty("--raio-pq", r2);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", p);
  };

  const placeholder = (emoji, cor) =>
    "data:image/svg+xml;utf8," + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="${cor}"/><text x="50%" y="52%" font-size="150" text-anchor="middle" dominant-baseline="middle">${emoji}</text></svg>`
    );

  // Remove campos undefined (Firestore não aceita)
  const limpar = (o) => JSON.parse(JSON.stringify(o));

  const colecao = (nome) => ({
    async listar() {
      const snap = await fs.collection(nome).get();
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
    },
    async obter(id) {
      const d = await fs.collection(nome).doc(id).get();
      return d.exists ? { ...d.data(), id: d.id } : null;
    },
    async salvar(item) {
      const { id: idAtual, ...dados } = item;
      const ref = idAtual ? fs.collection(nome).doc(idAtual) : fs.collection(nome).doc();
      await ref.set(limpar(dados));
      return { ...dados, id: ref.id };
    },
    async remover(id) { await fs.collection(nome).doc(id).delete(); },
    // Documentos cujo campo (string ISO ou YYYY-MM-DD) está entre `de` e `ate` (inclusive)
    async listarEntre(campo, de, ate) {
      const snap = await fs.collection(nome).where(campo, ">=", de).where(campo, "<=", ate).get();
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
    },
  });

  const produtos = colecao("produtos");
  // Ajusta estoque de forma transacional (delta pode ser negativo).
  // Se o produto tem variantes, ajusta a variante `vid` e recalcula o total do produto.
  // Toda alteração de estoque feita por aqui deixa um registro em "movimentos" (histórico de estoque).
  // info: { tipo, motivo, obs, ref, custoUnit, atualizarCusto }
  const movimentoDe = (p, id, vid, antes, depois, info) => ({
    produtoId: id, produtoNome: p.nome, vid: vid || "", variante: vid ? ((p.variantes || []).find((v) => v.id === vid) || {}).nome || "" : "",
    tipo: info.tipo || "ajuste", qtd: depois - antes, antes, depois, motivo: info.motivo || "", obs: info.obs || "", ref: info.ref || "",
    custoUnit: info.custoUnit ?? null, por: (auth && auth.currentUser && auth.currentUser.email) || "", criadoEm: new Date().toISOString(),
  });
  // Aplica o novo estoque (da variação `vid` ou do produto) dentro de uma transação e registra a movimentação
  const gravarEstoque = (id, calcular, vid, info) => {
    const ref = fs.collection("produtos").doc(id);
    return fs.runTransaction(async (tx) => {
      const d = await tx.get(ref);
      if (!d.exists) return null;
      const p = d.data();
      const temVar = vid && Array.isArray(p.variantes) && p.variantes.some((v) => v.id === vid);
      const antes = temVar ? p.variantes.find((v) => v.id === vid).estoque : (p.estoque || 0);
      const depois = Math.max(0, Math.round(calcular(antes)));
      const campos = {};
      if (temVar) {
        const variantes = p.variantes.map((v) => (v.id === vid ? { ...v, estoque: depois } : v));
        campos.variantes = variantes; campos.estoque = variantes.reduce((s, v) => s + v.estoque, 0);
      } else campos.estoque = depois;
      if (info.atualizarCusto && info.custoUnit != null) campos.custo = info.custoUnit;
      tx.update(ref, campos);
      if (depois !== antes) tx.set(fs.collection("movimentos").doc(), limpar(movimentoDe(p, id, vid, antes, depois, info)));
      return { antes, depois };
    });
  };
  // Soma (ou subtrai, com delta negativo) ao estoque
  produtos.ajustarEstoque = (id, delta, vid, info = {}) => gravarEstoque(id, (antes) => antes + delta, vid, info);
  // Define o estoque como um valor absoluto (contagem / correção)
  produtos.definirEstoque = (id, novo, vid, info = {}) => gravarEstoque(id, () => novo, vid, info);
  // Atualiza só alguns campos (não sobrescreve o resto do produto)
  produtos.atualizarCampos = (id, campos) => fs.collection("produtos").doc(id).update(limpar(campos));
  const movimentos = colecao("movimentos");
  // Registro avulso (ex.: estoque inicial no cadastro ou alteração pelo formulário do produto)
  movimentos.registrar = (produto, vid, antes, depois, info = {}) => (antes === depois ? Promise.resolve() : movimentos.salvar(limpar(movimentoDe(produto, produto.id, vid, antes, depois, info))));

  // Pedido (privado, só o admin lê) + acompanhamento (público, só por código, sem dados pessoais).
  // O código do pedido é o ID dos dois documentos.
  const pedidos = colecao("pedidos");
  const resumoPublico = (p) => ({
    codigo: p.codigo, status: p.status, tipo: p.tipo, criadoEm: p.criadoEm, atualizadoEm: new Date().toISOString(),
    total: p.total, nome: (p.cliente?.nome || "").split(" ")[0],
    itens: (p.itens || []).map((i) => ({ nome: i.nome + (i.variante ? ` (${i.variante})` : ""), qtd: i.qtd })),
  });
  pedidos.criar = async (pedido) => {
    const batch = fs.batch();
    batch.set(fs.collection("pedidos").doc(pedido.codigo), limpar(pedido));
    batch.set(fs.collection("acompanhamento").doc(pedido.codigo), limpar(resumoPublico(pedido)));
    await batch.commit();
    return pedido.codigo;
  };
  // Admin: grava o pedido e espelha o status no acompanhamento
  pedidos.atualizar = async (pedido) => {
    const { id, ...dados } = pedido;
    const batch = fs.batch();
    batch.set(fs.collection("pedidos").doc(id), limpar(dados));
    batch.set(fs.collection("acompanhamento").doc(id), limpar(resumoPublico(pedido)), { merge: true });
    await batch.commit();
  };
  pedidos.excluir = async (id) => {
    const batch = fs.batch();
    batch.delete(fs.collection("pedidos").doc(id));
    batch.delete(fs.collection("acompanhamento").doc(id));
    await batch.commit();
  };
  // Consulta pública por código (tempo real)
  const acompanhar = (codigo, aoMudar, aoErro) =>
    fs.collection("acompanhamento").doc(codigo).onSnapshot((d) => aoMudar(d.exists ? d.data() : null), aoErro);

  // Banner de exemplo (gradiente com ícones), usado só na carga de dados de exemplo
  const bannerExemplo = () => {
    const icones = ["💎", "⌚", "👜", "🕶️", "🎧", "🎀", "👛", "📿"];
    const itens = Array.from({ length: 27 }, (_, i) => {
      const x = 60 + (i % 9) * 172 + (Math.floor(i / 9) % 2) * 60, y = 90 + Math.floor(i / 9) * 125 + (i % 2) * 34, t = 44 + ((i * 29) % 28);
      return `<text x="${x}" y="${y}" font-size="${t}" opacity="0.${2 + (i % 3)}" transform="rotate(${(i * 23) % 40 - 20} ${x} ${y})">${icones[i % icones.length]}</text>`;
    }).join("");
    return "data:image/svg+xml;utf8," + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="420" viewBox="0 0 1600 420"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4f46e5"/><stop offset="1" stop-color="#db2777"/></linearGradient></defs><rect width="1600" height="420" fill="url(#g)"/>${itens}</svg>`);
  };

  // ---- Catálogo de exemplo: loja de acessórios ----
  // [id, nome, ícone, emoji da foto de exemplo, cor de fundo da foto]
  const CATEGORIAS_EXEMPLO = [
    ["bijuterias", "Bijuterias", "fa-gem", "💎", "#fce7f3"], ["relogios", "Relógios", "fa-clock", "⌚", "#dbeafe"], ["bolsas", "Bolsas e Mochilas", "fa-bag-shopping", "👜", "#ffedd5"],
    ["oculos", "Óculos", "fa-glasses", "🕶️", "#e2e8f0"], ["carteiras", "Cintos e Carteiras", "fa-wallet", "👛", "#fef3c7"], ["tech", "Capinhas e Tech", "fa-mobile-screen", "🎧", "#e0e7ff"],
    ["cabelo", "Cabelo", "fa-ribbon", "🎀", "#ffe4e6"],
  ];
  // [nome, categoria, preço, preço antigo, custo, estoque, emoji, cor de fundo, descrição, destaque, variações [[nome, estoque]]]
  const PRODUTOS_EXEMPLO = [
    ["Colar Ponto de Luz Folheado", "bijuterias", 79.9, 109.9, 32, 25, "💎", "#fce7f3", "Folheado a ouro 18k com zircônia. Acompanha embalagem para presente.", true],
    ["Brinco Argola Dourada", "bijuterias", 39.9, 0, 14, 40, "✨", "#fef3c7", "Argola média banhada a ouro, leve e hipoalergênica."],
    ["Pulseira Riviera Zircônia", "bijuterias", 89.9, 119.9, 38, 18, "📿", "#ede9fe", "Pulseira com zircônias brilhantes e fecho de segurança."],
    ["Anel Solitário Ajustável", "bijuterias", 49.9, 0, 18, 0, "💍", "#e0e7ff", "Regulagem de tamanho, não precisa trocar.", false, [["Dourado", 15], ["Prata", 15]]],
    ["Conjunto Colar e Brincos Pérola", "bijuterias", 99.9, 139.9, 41, 12, "🤍", "#f1f5f9", "Pérolas sintéticas de alto brilho. Conjunto com 3 peças.", true],
    ["Relógio Feminino Slim", "relogios", 189.9, 249.9, 85, 0, "⌚", "#ffe4e6", "Caixa de 32 mm, pulseira de aço e resistência a respingos.", true, [["Rosé", 8], ["Prata", 7], ["Dourado", 7]]],
    ["Relógio Masculino Esportivo", "relogios", 159.9, 0, 70, 0, "⌚", "#dbeafe", "Cronógrafo, pulseira de silicone e caixa de 44 mm.", false, [["Preto", 10], ["Azul", 8]]],
    ["Smartband Fitness", "relogios", 129.9, 169.9, 58, 15, "🏃", "#dcfce7", "Monitor de passos, sono e batimentos. Bateria de até 10 dias."],
    ["Bolsa Tiracolo Pequena", "bolsas", 119.9, 159.9, 52, 0, "👜", "#ffedd5", "Alça removível, forro interno e fecho magnético.", true, [["Preta", 8], ["Caramelo", 8], ["Rosa", 6]]],
    ["Mochila Casual Impermeável", "bolsas", 139.9, 0, 60, 14, "🎒", "#dcfce7", "Compartimento para notebook de 15\" e saída para fone."],
    ["Necessaire Organizadora", "bolsas", 34.9, 0, 12, 35, "👝", "#fce7f3", "Três divisões e zíper reforçado. Ideal para viagem."],
    ["Óculos de Sol Aviador", "oculos", 89.9, 129.9, 32, 0, "🕶️", "#e2e8f0", "Lentes com proteção UV400 e haste metálica.", true, [["Preto", 10], ["Dourado", 10], ["Prata", 6]]],
    ["Óculos de Sol Gatinho", "oculos", 79.9, 0, 28, 20, "😎", "#fce7f3", "Armação acetato e lentes com proteção UV400."],
    ["Óculos Anti Luz Azul", "oculos", 99.9, 0, 35, 16, "👓", "#e0e7ff", "Reduz o cansaço visual em telas. Acompanha estojo."],
    ["Cinto de Couro Sintético", "carteiras", 59.9, 0, 22, 0, "🪢", "#fef3c7", "Fivela clássica em metal e acabamento costurado.", false, [["90 cm", 8], ["100 cm", 10], ["110 cm", 8]]],
    ["Carteira Masculina Slim", "carteiras", 69.9, 89.9, 25, 22, "💼", "#e2e8f0", "Porta-cartões e divisória para notas. Couro ecológico."],
    ["Carteira Feminina com Zíper", "carteiras", 79.9, 0, 29, 18, "👛", "#ffe4e6", "Zíper em volta, 10 compartimentos para cartões."],
    ["Capinha Transparente Reforçada", "tech", 29.9, 0, 8, 0, "📱", "#f1f5f9", "Bordas elevadas que protegem câmera e tela.", false, [["iPhone 13", 12], ["iPhone 14", 12], ["Galaxy S23", 10]]],
    ["Fone de Ouvido Bluetooth TWS", "tech", 119.9, 159.9, 52, 25, "🎧", "#e0e7ff", "Bluetooth 5.3, estojo carregador e até 20h de bateria.", true],
    ["Carregador Portátil 10.000 mAh", "tech", 99.9, 0, 44, 20, "🔋", "#fef9c3", "Duas saídas USB e carregamento rápido. Indicador de bateria."],
    ["Kit Xuxinhas de Cetim (10 un.)", "cabelo", 19.9, 0, 5, 60, "🎀", "#fce7f3", "Cores variadas, não marcam o cabelo."],
    ["Presilha Garra Grande", "cabelo", 24.9, 0, 7, 45, "🦋", "#ede9fe", "Acabamento fosco, firme e confortável."],
    ["Tiara Laço", "cabelo", 29.9, 39.9, 9, 30, "👑", "#ffe4e6", "Tiara acolchoada com laço, conforto o dia todo."],
  ];

  // Acrescenta ao lote as categorias de exemplo e os produtos cujo nome ainda não existe. Devolve quantos produtos entraram.
  // Categorias que já existem não são tocadas (para não desfazer nome, foto ou subcategorias editados).
  const adicionarExemplosNoLote = (batch, nomesExistentes, codigosExistentes, categoriasExistentes = new Set()) => {
    CATEGORIAS_EXEMPLO.forEach(([id, nome, icone, emoji, cor]) => {
      if (!categoriasExistentes.has(id)) batch.set(fs.collection("categorias").doc(id), { nome, icone, imagem: placeholder(emoji, cor) });
    });
    let novos = 0;
    PRODUTOS_EXEMPLO.forEach(([nome, categoria, preco, precoAntigo, custo, estoque, emoji, cor, descricao, destaque, variacoes], i) => {
      if (nomesExistentes.has(nome.toLowerCase())) return;
      const codigo = "ACC" + String(i + 1).padStart(3, "0");
      const produto = {
        nome, categoria, preco, precoAntigo, custo, estoque, descricao, destaque: !!destaque, ativo: true,
        imagem: placeholder(emoji, cor), codigo: codigosExistentes.has(codigo.toLowerCase()) ? "" : codigo, variantes: [],
      };
      if (variacoes) {
        produto.variantes = variacoes.map(([vn, ve], k) => ({ id: "v" + (k + 1), nome: vn, estoque: ve }));
        produto.estoque = produto.variantes.reduce((t, v) => t + v.estoque, 0);
      }
      batch.set(fs.collection("produtos").doc(), limpar(produto));
      novos++;
    });
    return novos;
  };

  window.DB = {
    configurado,
    fs,
    auth,
    produtos,
    categorias: colecao("categorias"),
    cupons: colecao("cupons"),
    pedidos,
    fretes: colecao("fretes"),
    movimentos,
    vendas: colecao("vendas"),
    caixas: colecao("caixas"),
    contas: colecao("contas"),
    clientes: colecao("clientes"),
    acompanhar,
    // Número sequencial atômico (ex.: vendas do PDV). Só o admin pode chamar.
    async proximoNumero(nome) {
      const ref = fs.collection("configuracoes").doc("contadores");
      return fs.runTransaction(async (tx) => {
        const d = await tx.get(ref);
        const n = ((d.exists && d.data()[nome]) || 0) + 1;
        tx.set(ref, { [nome]: n }, { merge: true });
        return n;
      });
    },
    config: {
      async obter() {
        const d = await fs.collection("configuracoes").doc("geral").get();
        return mesclarConfig(d.exists ? d.data() : {});
      },
      async salvar(c) { await fs.collection("configuracoes").doc("geral").set(limpar(mesclarConfig(c))); },
      padrao: () => mesclarConfig({}),
    },
    placeholder,
    aplicarTema,
    contraste,
    moeda: (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }),
    esc: (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),

    // Dados de exemplo (usado pelo admin quando a loja está vazia): loja de acessórios completa
    async semear() {
      const batch = fs.batch();
      adicionarExemplosNoLote(batch, new Set(), new Set());
      [["Centro", 8, "1 a 2 dias"], ["Bairros próximos", 12, "2 a 3 dias"], ["Demais regiões", 20, "3 a 5 dias"]]
        .forEach(([nome, valor, prazo]) => batch.set(fs.collection("fretes").doc(), { nome, valor, prazo, ativo: true }));
      batch.set(fs.collection("cupons").doc(), { codigo: "BEMVINDO10", tipo: "percentual", valor: 10, minimo: 0, ativo: true });
      batch.set(fs.collection("cupons").doc(), { codigo: "FRETE20", tipo: "fixo", valor: 20, minimo: 100, ativo: true });
      batch.set(fs.collection("configuracoes").doc("geral"), limpar({ ...mesclarConfig({}), nomeLoja: "Loja de Acessórios", slogan: "Acessórios para todos os estilos", bannerUrl: bannerExemplo() }));
      await batch.commit();
    },

    // Acrescenta os produtos de exemplo (acessórios) a uma loja que já tem dados, sem apagar nada
    // e sem repetir produtos de mesmo nome. Devolve quantos foram adicionados.
    async adicionarExemplos() {
      const existentes = await produtos.listar();
      const categoriasAtuais = await colecao("categorias").listar();
      const batch = fs.batch();
      const novos = adicionarExemplosNoLote(
        batch,
        new Set(existentes.map((p) => (p.nome || "").toLowerCase())),
        new Set(existentes.map((p) => (p.codigo || "").toLowerCase()).filter(Boolean)),
        new Set(categoriasAtuais.map((c) => c.id)),
      );
      await batch.commit();
      return novos;
    },
  };
})();
