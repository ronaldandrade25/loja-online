// Configurações: tudo o que dá para ajustar no site de compra (aparência, página inicial, entrega e retirada,
// cadastro do cliente, pagamento e textos). Os valores ficam em configuracoes/geral e a loja os lê ao abrir.
window.Admin.modulos.push((A) => {
  const { $, toast, tentar } = A;
  const { esc, auth } = DB;

  const SECOES = [
    ["loja", "Loja e contato", "fa-store"],
    ["aparencia", "Aparência", "fa-palette"],
    ["inicio", "Página inicial", "fa-house"],
    ["entrega", "Entrega e retirada", "fa-truck-fast"],
    ["cadastro", "Cadastro do cliente", "fa-id-card"],
    ["pagamento", "Pagamento", "fa-credit-card"],
    ["textos", "Textos", "fa-font"],
  ];
  const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  let secaoAtual = "loja";

  // ---------- Componentes de formulário ----------
  const campo = (rot, nome, v, extra = "", dica = "") => `<label>${rot}<input name="${nome}" value="${esc(v ?? "")}" ${extra} />${dica ? `<small class="dica">${dica}</small>` : ""}</label>`;
  const numero = (rot, nome, v, extra = "", dica = "") => campo(rot, nome, v, `type="number" step="any" ${extra}`, dica);
  const area = (rot, nome, v, linhas = 2, dica = "") => `<label>${rot}<textarea name="${nome}" rows="${linhas}">${esc(v ?? "")}</textarea>${dica ? `<small class="dica">${dica}</small>` : ""}</label>`;
  const marcar = (rot, nome, on, dica = "") => `<label class="check"><input type="checkbox" name="${nome}" ${on ? "checked" : ""} /> <span>${rot}${dica ? `<small class="dica">${dica}</small>` : ""}</span></label>`;
  const escolha = (rot, nome, atual, opcoes, dica = "") => `<label>${rot}<select name="${nome}">${opcoes.map(([v, t]) => `<option value="${v}" ${String(v) === String(atual) ? "selected" : ""}>${t}</option>`).join("")}</select>${dica ? `<small class="dica">${dica}</small>` : ""}</label>`;
  const cor = (rot, nome, v) => `<label class="cor-campo">${rot}<span><input type="color" name="${nome}" value="${esc(v)}" /><code>${esc(v)}</code></span></label>`;
  const grade = (...itens) => `<div class="cfg-grade">${itens.join("")}</div>`;
  const titulo = (t, dica = "") => `<h3 class="cfg-sub">${t}</h3>${dica ? `<p class="dica">${dica}</p>` : ""}`;

  // ---------- Imagens (logo e banner ficam dentro do documento de configurações) ----------
  const redimensionar = (file, max, tipo, qualidade) => new Promise((ok, fail) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement("canvas");
      cv.width = Math.max(1, Math.round(img.width * k)); cv.height = Math.max(1, Math.round(img.height * k));
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      ok(cv.toDataURL(tipo, qualidade));
    };
    img.onerror = () => { URL.revokeObjectURL(url); fail(new Error("imagem inválida")); };
    img.src = url;
  });
  const imagemCampo = (chave, rot, dica, img) => `
    <div class="img-campo" data-img="${chave}">
      <label>${rot}<input type="file" accept="image/*" data-arquivo="${chave}" /></label>
      <label>ou endereço (URL) da imagem<input name="${chave}Endereco" placeholder="https://..." value="${img && !img.startsWith("data:") ? esc(img) : ""}" /></label>
      <img class="prev-img prev-${chave}" data-prev="${chave}" alt="" ${img ? `src="${esc(img)}"` : "hidden"} />
      <button type="button" class="btn sec peq" data-remover-img="${chave}" ${img ? "" : "hidden"}>Remover imagem</button>
      <small class="dica">${dica}</small>
    </div>`;

  // ---------- Site: QR Code, copiar link e abrir ----------
  // Endereço público da loja: o configurado ou a pasta onde o painel está (a loja é o index.html dela)
  const enderecoSite = (c) => {
    const manual = String(c.siteUrl || "").trim();
    if (manual) return /^https?:\/\//i.test(manual) ? manual : "https://" + manual;
    return location.protocol === "file:" ? "" : new URL("./", location.href).href;
  };
  const enderecoDeTeste = (u) => !u || /^https?:\/\/(localhost|127\.|0\.0\.0\.0|192\.168\.|10\.)/i.test(u);
  const copiarTexto = async (texto) => {
    try { await navigator.clipboard.writeText(texto); return true; }
    catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = texto; ta.style.cssText = "position:fixed;opacity:0;top:0;left:0";
        document.body.appendChild(ta); ta.select();
        const ok = document.execCommand("copy"); ta.remove(); return ok;
      } catch { return false; }
    }
  };
  // Monta o QR Code (margem de 4 módulos) como SVG nítido
  const montarQr = (texto) => {
    const qr = qrcode(0, "M"); qr.addData(texto); qr.make();
    const n = qr.getModuleCount(), m = 4, total = n + m * 2;
    let d = "";
    for (let r = 0; r < n; r++) {
      let c = 0;
      while (c < n) {
        if (qr.isDark(r, c)) { let f = c; while (f < n && qr.isDark(r, f)) f++; d += "M" + (c + m) + " " + (r + m) + "h" + (f - c) + "v1h-" + (f - c) + "z"; c = f; } else c++;
      }
    }
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + total + " " + total + '" shape-rendering="crispEdges" role="img" aria-label="QR Code do site"><rect width="' + total + '" height="' + total + '" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
    return { svg, n, total, margem: m, escuro: (r, c) => qr.isDark(r, c) };
  };
  const baixarQrPng = (qr) => {
    const escala = Math.max(8, Math.floor(1024 / qr.total)), tam = escala * qr.total;
    const cv = document.createElement("canvas"); cv.width = cv.height = tam;
    const g = cv.getContext && cv.getContext("2d");
    if (!g) return toast("Não foi possível gerar a imagem neste navegador");
    g.fillStyle = "#fff"; g.fillRect(0, 0, tam, tam); g.fillStyle = "#000";
    for (let r = 0; r < qr.n; r++) for (let c = 0; c < qr.n; c++) if (qr.escuro(r, c)) g.fillRect((c + qr.margem) * escala, (r + qr.margem) * escala, escala, escala);
    cv.toBlob((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = "qrcode-site.png"; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 3000);
      toast("QR Code baixado");
    }, "image/png");
  };
  const imprimirQr = (qr, url, loja) => {
    const w = window.open("", "_blank");
    if (!w) return toast("Permita pop-ups para imprimir");
    w.document.write("<!doctype html><html lang=\"pt-BR\"><head><meta charset=\"utf-8\"><title>QR Code — " + esc(loja) + "</title><style>" +
      "@page{margin:15mm}body{font-family:system-ui,Segoe UI,Arial,sans-serif;text-align:center;color:#111;margin:0}" +
      "h1{font-size:30px;margin:10px 0 4px}p{margin:6px 0;font-size:16px;color:#374151}.qr{width:min(120mm,80vw);margin:18px auto}.qr svg{width:100%;height:auto;display:block}" +
      ".url{font-size:15px;word-break:break-all;font-weight:600}.no{margin:16px}@media print{.no{display:none}}</style></head><body>" +
      "<h1>" + esc(loja) + "</h1><p>Aponte a câmera do celular para acessar nossa loja</p><div class=\"qr\">" + qr.svg + "</div><p class=\"url\">" + esc(url) + "</p>" +
      "<p class=\"no\"><button onclick=\"window.print()\">Imprimir</button></p><script>window.onload=function(){setTimeout(function(){window.print()},300)}<\/script></body></html>");
    w.document.close();
  };
  const abrirQr = (c) => {
    const url = enderecoSite(c);
    if (!url) return toast("Abra o painel por um endereço da internet (ou informe o endereço do site em Loja e contato).");
    let qr;
    try { qr = montarQr(url); } catch { return toast("Não foi possível gerar o QR Code deste endereço"); }
    A.abrirModal("QR Code do site", '<div class="qr-box"><div class="qr-img">' + qr.svg + '</div><p class="qr-url"><a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(url) + "</a></p>" +
      (enderecoDeTeste(url) ? '<p class="qr-aviso"><i class="fa-solid fa-triangle-exclamation"></i> Este é um endereço de teste (só funciona neste computador ou na sua rede). Para o QR Code funcionar para os clientes, informe o endereço público em <b>Loja e contato → Endereço do site</b>.</p>' : "") +
      '<div class="barra-acoes" style="justify-content:center"><button type="button" class="btn sec" id="qr-baixar"><i class="fa-solid fa-download"></i> Baixar PNG</button><button type="button" class="btn sec" id="qr-imprimir"><i class="fa-solid fa-print"></i> Imprimir</button><button type="button" class="btn sec" id="qr-copiar"><i class="fa-regular fa-copy"></i> Copiar link</button></div></div>',
      () => {}, { salvar: "Fechar", semCancelar: true });
    $("#qr-baixar").onclick = () => baixarQrPng(qr);
    $("#qr-imprimir").onclick = () => imprimirQr(qr, url, c.nomeLoja || "Loja");
    $("#qr-copiar").onclick = async () => toast((await copiarTexto(url)) ? "Link copiado" : "Não foi possível copiar. Copie manualmente: " + url);
  };
  // menu "Site" fecha ao clicar fora ou com Esc (ouvintes únicos)
  const fecharMenuSite = () => { const m = $("#site-menu"); if (m && !m.hidden) { m.hidden = true; $("#site-btn").setAttribute("aria-expanded", "false"); } };
  document.addEventListener("click", (e) => { if (!e.target.closest("#menu-site")) fecharMenuSite(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") fecharMenuSite(); });
  A.enderecoSite = enderecoSite;

  // ---------- Tela ----------
  A.telas.config = async () => {
    A.carregando("config");
    const c = await DB.config.obter();
    const padrao = DB.config.padrao();
    const dados = { logo: c.logoUrl && c.logoUrl.startsWith("data:") ? c.logoUrl : "", banner: c.bannerUrl && c.bannerUrl.startsWith("data:") ? c.bannerUrl : "" };
    const modos = [["oculto", "Não mostrar"], ["opcional", "Opcional"], ["obrigatorio", "Obrigatório"]];
    const linhaCampo = (nome, rot, dica) => `<div class="cfg-linha-campo"><div><b>${rot}</b>${dica ? `<small class="dica">${dica}</small>` : ""}</div>${escolha("", "campo_" + nome, c.campos[nome], modos)}</div>`;

    const secoes = {
      loja: `
        ${titulo("Dados da loja")}
        ${grade(campo("Nome da loja", "nomeLoja", c.nomeLoja, "required"), campo("Slogan", "slogan", c.slogan))}
        ${campo("Endereço (link) do site", "siteUrl", c.siteUrl, 'type="url" inputmode="url" placeholder="https://minhaloja.com.br"', "Usado no QR Code e no link copiado (botão Site, no alto desta tela). Em branco, usa o endereço atual do painel.")}
        ${titulo("Contato", "Aparece na seção Contato da página inicial. Deixe em branco o que não usar.")}
        ${grade(
          campo("WhatsApp (DDI + DDD + número, só dígitos)", "whatsapp", c.whatsapp, 'required inputmode="numeric"', "Recebe o resumo do pedido. Ex.: 5581999998888"),
          campo("Telefone (opcional)", "telefone", c.telefone, 'type="tel"'),
          campo("E-mail (opcional)", "email", c.email, 'type="email"'),
          campo("Instagram (@usuario ou link)", "instagram", c.instagram),
          campo("Facebook (usuario ou link)", "facebook", c.facebook))}
        ${titulo("Localização")}
        ${grade(campo("Endereço da loja", "endereco", c.endereco), campo("Horário de funcionamento", "horario", c.horario))}
        ${marcar("Mostrar mapa na página inicial", "mostrarMapa", c.mostrarMapa, "O mapa aparece quando houver endereço.")}
        ${marcar("Mostrar o botão flutuante do WhatsApp", "zapFlutuante", c.zapFlutuante, "Botão verde fixo no canto da tela, em todas as páginas da loja.")}`,

      aparencia: `
        ${titulo("Cores", "O texto sobre as cores principais muda sozinho entre claro e escuro para continuar legível.")}
        <div class="prev-loja" id="prev-loja" aria-label="Pré-visualização">
          <div class="pl-topo"><b id="pl-nome">${esc(c.nomeLoja)}</b><span>Início</span><span class="pl-ativo">Produtos</span><span>Contato</span></div>
          <div class="pl-corpo">
            <span class="pl-chip">Categoria</span>
            <span class="pl-card"><span class="pl-tag">-20%</span><b class="pl-preco">R$ 79,90</b><button type="button" class="pl-btn">Adicionar</button></span>
          </div>
          <div class="pl-rodape">Rodapé da loja</div>
        </div>
        ${grade(cor("Cor principal (topo, botões)", "corPrimaria", c.corPrimaria), cor("Cor secundária (rodapé, avisos)", "corSecundaria", c.corSecundaria),
                cor("Cor de destaque (selos de desconto)", "corDestaque", c.corDestaque), cor("Cor de fundo da página", "corFundo", c.corFundo), cor("Cor do texto", "corTexto", c.corTexto))}
        <button type="button" class="btn sec peq" id="cores-padrao">Restaurar cores padrão</button>
        ${titulo("Estilo")}
        ${grade(escolha("Fonte", "fonte", c.fonte, [["sistema", "Padrão (moderna do sistema)"], ["elegante", "Elegante (com serifa)"], ["moderna", "Arredondada"]]),
                escolha("Cantos dos botões e cartões", "cantos", c.cantos, [["reto", "Retos"], ["suave", "Suaves"], ["arredondado", "Bem arredondados"]]))}
        ${titulo("Logo")}
        ${imagemCampo("logo", "Logo da loja (substitui o ícone do topo)", "Fundo transparente funciona melhor (PNG). Ela é reduzida automaticamente.", c.logoUrl)}
        ${titulo("Banner da página inicial", "Com uma imagem de banner, a loja mostra só a imagem (sem título, texto nem botão sobre ela). Os três campos abaixo aparecem apenas enquanto não houver imagem.")}
        ${imagemCampo("banner", "Imagem do banner", "Use uma imagem larga (ex.: 1600×500). Ela é reduzida para caber no banco de dados; para fotos grandes prefira colar o endereço (URL) de uma imagem hospedada.", c.bannerUrl)}
        ${grade(campo("Título do banner", "bannerTitulo", c.bannerTitulo, "", "Em branco: usa o nome da loja."), campo("Texto do banner", "bannerTexto", c.bannerTexto, "", "Em branco: usa o slogan."), campo("Texto do botão do banner", "bannerBotao", c.bannerBotao))}`,

      inicio: `
        ${titulo("Seções da página inicial", "A página inicial mostra, nesta ordem: banner, categorias, produtos em destaque, localização e contato.")}
        ${grade(marcar("Categorias", "mostrarCategorias", c.mostrarCategorias), marcar("Produtos em destaque", "mostrarDestaques", c.mostrarDestaques),
                marcar("Localização", "mostrarLocalizacao", c.mostrarLocalizacao), marcar("Contato", "mostrarContato", c.mostrarContato))}
        ${titulo("Títulos e textos")}
        ${grade(campo("Título das categorias", "tituloCategorias", c.tituloCategorias), campo("Título dos destaques", "tituloDestaques", c.tituloDestaques),
                numero("Quantidade de produtos em destaque", "qtdDestaques", c.qtdDestaques, 'min="1" max="24" step="1"', "Marque os destaques em Produtos → editar produto. Sem nenhum marcado, aparecem os disponíveis."),
                campo("Título da localização", "tituloLocalizacao", c.tituloLocalizacao), campo("Título do contato", "tituloContato", c.tituloContato))}
        ${area("Texto da seção de contato", "textoContato", c.textoContato)}
        ${titulo("Página de produtos")}
        ${grade(campo("Título da página", "tituloProdutos", c.tituloProdutos), campo("Frase acima do título", "subtituloProdutos", c.subtituloProdutos, "", "Ex.: Catálogo completo. Em branco: não aparece."),
                marcar("Botão de WhatsApp nos produtos", "mostrarZapProdutos", c.mostrarZapProdutos, "Abre uma conversa já perguntando sobre o produto."))}`,

      entrega: `
        ${titulo("Formas de receber o pedido", "O cliente escolhe entre as opções ativas. Se só uma estiver ativa, ela é usada direto.")}
        ${grade(marcar("Entrega", "entregaAtiva", c.entregaAtiva), marcar("Retirada na loja", "retiradaAtiva", c.retiradaAtiva))}
        ${titulo("Entrega")}
        ${grade(
          numero("Frete padrão (R$)", "taxaEntrega", c.taxaEntrega, 'min="0"', "Usado quando não há regiões cadastradas."),
          numero("Frete grátis a partir de (R$)", "freteGratisAcima", c.freteGratisAcima, 'min="0"', "0 = nunca."),
          numero("Pedido mínimo (R$)", "pedidoMinimo", c.pedidoMinimo, 'min="0"', "0 = sem mínimo. Vale para entrega e retirada."))}
        ${area("Aviso na etapa de entrega", "entregaAviso", c.entregaAviso, 2, "Ex.: Entregamos de segunda a sábado, após confirmação do pagamento.")}
        <p class="dica"><i class="fa-solid fa-circle-info"></i> Valores por bairro/cidade ficam em <a href="#" id="ir-fretes">Fretes</a>.</p>
        ${titulo("Retirada na loja")}
        ${grade(campo("Endereço da retirada", "retiradaEndereco", c.retiradaEndereco, "", "Em branco: usa o endereço da loja."), area("Instruções de retirada", "retiradaInstrucoes", c.retiradaInstrucoes, 2, "Ex.: Apresente o código do pedido no balcão."))}
        <div class="dias-semana"><span>Dias de retirada</span>${DIAS.map((d, i) => `<label class="check"><input type="checkbox" name="dia_${i}" ${(c.retiradaDias || []).map(Number).includes(i) ? "checked" : ""} /> ${d}</label>`).join("")}</div>
        ${grade(
          campo("Horário inicial", "retiradaHoraInicio", c.retiradaHoraInicio, 'type="time" required'),
          campo("Horário final", "retiradaHoraFim", c.retiradaHoraFim, 'type="time" required'),
          escolha("Intervalo entre horários", "retiradaIntervalo", c.retiradaIntervalo, [[15, "15 minutos"], [30, "30 minutos"], [45, "45 minutos"], [60, "1 hora"], [90, "1h30"], [120, "2 horas"]]),
          numero("Antecedência mínima (dias)", "retiradaAntecedenciaDias", c.retiradaAntecedenciaDias, 'min="0" step="1"', "0 = pode retirar no mesmo dia."),
          numero("Agendar com até (dias)", "retiradaMaxDias", c.retiradaMaxDias, 'min="1" step="1"'))}`,

      cadastro: `
        ${titulo("Dados pedidos ao cliente", "Define quais campos aparecem na etapa de entrega do carrinho e se são obrigatórios.")}
        <div class="cfg-campos">
          <div class="cfg-linha-campo"><div><b>Nome</b><small class="dica">Sempre obrigatório</small></div><span class="status s-ativo">Obrigatório</span></div>
          <div class="cfg-linha-campo"><div><b>WhatsApp</b><small class="dica">Sempre obrigatório (usado para avisar sobre o pedido)</small></div><span class="status s-ativo">Obrigatório</span></div>
          <div class="cfg-linha-campo"><div><b>Endereço</b><small class="dica">Obrigatório nas entregas</small></div><span class="status s-ativo">Na entrega</span></div>
          ${linhaCampo("email", "E-mail")}
          ${linhaCampo("cpf", "CPF / CNPJ", "Para quem precisa emitir nota")}
          ${linhaCampo("cep", "CEP", "Com busca automática do endereço")}
          ${linhaCampo("complemento", "Complemento do endereço")}
          ${linhaCampo("obs", "Observações do pedido", "Etapa de pagamento")}
        </div>`,

      pagamento: `
        ${titulo("Formas de pagamento aceitas")}
        ${grade(marcar("PIX", "pg_pix", c.pagamentos.pix), marcar("Cartão de crédito", "pg_credito", c.pagamentos.credito), marcar("Cartão de débito", "pg_debito", c.pagamentos.debito), marcar("Dinheiro (com troco)", "pg_dinheiro", c.pagamentos.dinheiro))}
        ${titulo("PIX e avisos")}
        ${campo("Chave PIX", "pixChave", c.pixChave, "", "Mostrada ao cliente quando ele escolhe PIX (com botão copiar) e na mensagem do pedido.")}
        ${area("Aviso na etapa de pagamento", "pagamentoAviso", c.pagamentoAviso, 2, "Ex.: O pagamento é feito na entrega ou na retirada.")}`,

      textos: `
        ${titulo("Mensagens do pedido")}
        ${area("Mensagem de pedido registrado", "textoSucesso", c.textoSucesso, 2, "Aparece para o cliente quando ele finaliza a compra.")}
        ${area("Frase final no WhatsApp do pedido", "textoFinalWhats", c.textoFinalWhats, 2, "Adicionada no fim da mensagem enviada à loja. Ex.: Obrigado pela preferência!")}
        ${titulo("Rodapé")}
        ${campo("Texto do rodapé", "rodapeTexto", c.rodapeTexto, "", "Em branco: © ano — nome da loja.")}`,
    };

    $("#tab-config").innerHTML = `
      <div class="cab"><h1>Configurações do site</h1><div class="menu-site" id="menu-site">
        <button type="button" class="btn" id="site-btn" aria-haspopup="menu" aria-expanded="false"><i class="fa-solid fa-globe"></i> Site <i class="fa-solid fa-chevron-down"></i></button>
        <div class="menu-pop" id="site-menu" role="menu" hidden>
          <button type="button" role="menuitem" data-site="qr"><i class="fa-solid fa-qrcode"></i> QR Code</button>
          <button type="button" role="menuitem" data-site="copiar"><i class="fa-regular fa-copy"></i> Copiar link</button>
          <button type="button" role="menuitem" data-site="abrir"><i class="fa-solid fa-arrow-up-right-from-square"></i> Abrir site</button>
          <div class="menu-url" id="site-url"></div>
        </div>
      </div></div>
      <p class="dica" style="margin-bottom:10px">Tudo o que o cliente vê e preenche na loja é ajustado aqui. As mudanças aparecem na loja ao recarregar a página.</p>
      <div class="cfg-abas" id="cfg-abas" role="tablist">${SECOES.map(([k, n, ic]) => `<button type="button" role="tab" data-secao="${k}" class="${k === secaoAtual ? "ativo" : ""}"><i class="fa-solid ${ic}"></i> ${n}</button>`).join("")}</div>
      <form class="painel cfg-form" id="form-config" novalidate>
        ${SECOES.map(([k]) => `<section class="cfg-secao" data-secao="${k}" ${k === secaoAtual ? "" : "hidden"}>${secoes[k]}</section>`).join("")}
        <div class="cfg-barra"><span class="dica" id="cfg-estado"></span><button class="btn" id="cfg-salvar"><i class="fa-solid fa-floppy-disk"></i> Salvar configurações</button></div>
      </form>
      <div class="painel" id="painel-impressora" ${secaoAtual === "loja" ? "" : "hidden"} style="margin-top:16px;max-width:900px">
        <h3 style="margin-bottom:4px"><i class="fab fa-bluetooth-b"></i> Impressora e avisos de pedido</h3>
        <p class="dica" style="margin-bottom:12px">A conexão vale só para este navegador/aparelho. Ligue a impressora e deixe o painel aberto para imprimir sozinho.</p>

        <div class="imp-status" id="imp-status"></div>
        <div class="barra-acoes" style="margin:10px 0">
          <button type="button" class="btn" id="imp-ble"><i class="fab fa-bluetooth-b"></i> Conectar impressora Bluetooth</button>
          <button type="button" class="btn sec" id="imp-serial"><i class="fa-solid fa-plug"></i> Conectar por porta serial</button>
          <button type="button" class="btn sec" id="imp-teste"><i class="fa-solid fa-print"></i> Imprimir teste</button>
          <button type="button" class="btn sec" id="imp-desconectar"><i class="fa-solid fa-link-slash"></i> Desconectar</button>
        </div>
        <details class="imp-ajuda"><summary>Qual botão usar? Compatibilidade</summary>
          <ul>
            <li><b>Conectar impressora Bluetooth</b>: impressoras térmicas Bluetooth <b>BLE</b> (Bluetooth de baixa energia). Funciona no Chrome ou Edge, no computador e no Android.</li>
            <li><b>Conectar por porta serial</b>: impressoras Bluetooth <b>clássicas</b> (as mais comuns de 58 mm). No Windows, primeiro pareie a impressora em Configurações → Bluetooth; ela cria uma porta COM, que você escolhe aqui. Só no Chrome ou Edge do computador.</li>
            <li>iPhone/iPad (Safari) não permitem conectar impressoras direto pelo navegador.</li>
            <li>Se a impressora estiver instalada no sistema, também dá para usar "Imprimir / PDF" nos pedidos e o botão de imprimir cupom do PDV, que abrem a janela de impressão normal.</li>
          </ul>
        </details>

        <div class="cfg-grade" style="margin-top:12px">
          ${escolha("Largura do papel", "impressoraLargura", c.impressoraLargura, [[32, "58 mm (32 colunas)"], [48, "80 mm (48 colunas)"]])}
        </div>
        <h4 class="cfg-sub">Impressão automática</h4>
        ${marcar("Imprimir automaticamente quando chegar um pedido pelo site", "impressaoAutoSite", c.impressaoAutoSite, "Imprime o pedido assim que ele chega, com o painel aberto.")}
        ${marcar("Imprimir automaticamente o cupom das vendas do PDV", "impressaoAutoPdv", c.impressaoAutoPdv, "Imprime o cupom assim que a venda é concluída.")}
        <h4 class="cfg-sub">Avisos de pedido do site</h4>
        ${marcar("Avisar quando chegar um pedido pelo site", "avisoPedidoSite", c.avisoPedidoSite, "Mostra um aviso na tela, pisca o título da aba e (se permitido) envia uma notificação do navegador.")}
        ${marcar("Tocar um som no aviso", "avisoSom", c.avisoSom)}
        <div class="barra-acoes" style="margin-top:8px">
          <button type="button" class="btn sec" id="aviso-permissao"><i class="fa-regular fa-bell"></i> Ativar notificações do navegador</button>
          <button type="button" class="btn sec" id="aviso-teste">Testar aviso</button>
          <span class="dica" id="aviso-estado"></span>
        </div>
        <p class="dica" style="margin-top:8px">Os avisos funcionam enquanto o painel estiver aberto no navegador (pode ficar em segundo plano). Com o painel fechado não há aviso.</p>
      </div>`;

    const form = $("#form-config");
    $("#site-url").textContent = enderecoSite(c) || "Endereço indisponível (painel aberto como arquivo)";
    $("#site-btn").onclick = () => { const m = $("#site-menu"), abrir = m.hidden; m.hidden = !abrir; $("#site-btn").setAttribute("aria-expanded", String(abrir)); if (abrir) $("#site-url").textContent = enderecoSite(c) || "Endereço indisponível (painel aberto como arquivo)"; };
    $("#site-menu").onclick = async (e) => {
      const b = e.target.closest("[data-site]");
      if (!b) return;
      fecharMenuSite();
      const url = enderecoSite(c);
      if (b.dataset.site === "qr") return abrirQr(c);
      if (!url) return toast("Abra o painel por um endereço da internet (ou informe o endereço do site em Loja e contato).");
      if (b.dataset.site === "copiar") toast((await copiarTexto(url)) ? "Link copiado" : "Não foi possível copiar. Copie manualmente: " + url);
      if (b.dataset.site === "abrir") window.open(url, "_blank", "noopener");
    };
    const sujo = () => { $("#cfg-estado").textContent = "Alterações não salvas"; };
    form.addEventListener("input", sujo);
    form.addEventListener("change", sujo);

    // navegação entre seções
    const abrirSecao = (k) => {
      secaoAtual = k;
      document.querySelectorAll("#cfg-abas button").forEach((b) => b.classList.toggle("ativo", b.dataset.secao === k));
      form.querySelectorAll(".cfg-secao").forEach((s) => { s.hidden = s.dataset.secao !== k; });
      $("#painel-impressora").hidden = k !== "loja"; // impressora e avisos só aparecem na primeira aba
      const ativa = document.querySelector("#cfg-abas .ativo");
      if (ativa && ativa.scrollIntoView) ativa.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
    };
    $("#cfg-abas").onclick = (e) => { const b = e.target.closest("[data-secao]"); if (b) abrirSecao(b.dataset.secao); };
    const irFretes = $("#ir-fretes");
    if (irFretes) irFretes.onclick = (e) => { e.preventDefault(); A.abrirTab("fretes"); };

    // pré-visualização de cores / estilo
    const prev = $("#prev-loja");
    const atualizarPrevia = () => {
      const v = (n) => form.elements[n].value;
      const p = v("corPrimaria"), s = v("corSecundaria"), d = v("corDestaque");
      prev.style.setProperty("--p", p); prev.style.setProperty("--op", DB.contraste(p));
      prev.style.setProperty("--s", s); prev.style.setProperty("--os", DB.contraste(s));
      prev.style.setProperty("--d", d); prev.style.setProperty("--od", DB.contraste(d));
      prev.style.setProperty("--f", v("corFundo")); prev.style.setProperty("--t", v("corTexto"));
      prev.style.setProperty("--rr", { reto: "4px", suave: "10px", arredondado: "20px" }[v("cantos")] || "10px");
      prev.style.fontFamily = { sistema: "system-ui, sans-serif", elegante: "Georgia, serif", moderna: '"Trebuchet MS", sans-serif' }[v("fonte")];
      $("#pl-nome").textContent = v("nomeLoja") || "Loja";
      form.querySelectorAll('input[type="color"]').forEach((i) => { const code = i.parentElement.querySelector("code"); if (code) code.textContent = i.value; });
    };
    form.addEventListener("input", atualizarPrevia);
    atualizarPrevia();
    $("#cores-padrao").onclick = () => {
      ["corPrimaria", "corSecundaria", "corDestaque", "corFundo", "corTexto"].forEach((n) => { form.elements[n].value = padrao[n]; });
      atualizarPrevia(); sujo();
    };

    // logo e banner
    const mostrarImagem = (k, src) => {
      const img = form.querySelector(`[data-prev="${k}"]`), rem = form.querySelector(`[data-remover-img="${k}"]`);
      if (src) img.src = src; else img.removeAttribute("src");
      img.hidden = !src; rem.hidden = !src;
    };
    form.addEventListener("change", async (e) => {
      const arq = e.target.closest("[data-arquivo]");
      if (!arq || !arq.files[0]) return;
      const k = arq.dataset.arquivo, file = arq.files[0];
      try {
        let data;
        if (k === "logo") data = await redimensionar(file, 360, file.type === "image/png" ? "image/png" : "image/jpeg", 0.85);
        else {
          data = "";
          for (const [max, q] of [[1600, 0.82], [1600, 0.68], [1280, 0.6], [1000, 0.55]]) {
            data = await redimensionar(file, max, "image/jpeg", q);
            if (data.length < 520000) break;
          }
          if (data.length >= 700000) { toast("Imagem muito pesada. Use uma menor ou cole o endereço (URL) dela."); return; }
        }
        dados[k] = data;
        form.elements[k + "Endereco"].value = "";
        mostrarImagem(k, data);
      } catch { toast("Arquivo de imagem inválido"); }
    });
    form.addEventListener("input", (e) => { if (e.target.name === "logoEndereco" || e.target.name === "bannerEndereco") { const k = e.target.name.replace("Endereco", ""); if (e.target.value) { dados[k] = ""; mostrarImagem(k, e.target.value); } } });
    form.addEventListener("click", (e) => {
      const r = e.target.closest("[data-remover-img]");
      if (!r) return;
      const k = r.dataset.removerImg;
      dados[k] = ""; form.elements[k + "Endereco"].value = ""; form.querySelector(`[data-arquivo="${k}"]`).value = "";
      mostrarImagem(k, ""); sujo();
    });

    // salvar
    const erro = (secao, nome, msg) => {
      abrirSecao(secao);
      const el = form.elements[nome];
      toast(msg);
      if (el && el.focus) el.focus();
      return false;
    };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const f = (n) => (form.elements[n].value || "").trim();
      const on = (n) => form.elements[n].checked;
      const novo = { ...c };
      Object.assign(novo, {
        nomeLoja: f("nomeLoja"), slogan: f("slogan"), siteUrl: f("siteUrl"), whatsapp: f("whatsapp").replace(/\D/g, ""), telefone: f("telefone"), email: f("email"),
        instagram: f("instagram"), facebook: f("facebook"), endereco: f("endereco"), horario: f("horario"), mostrarMapa: on("mostrarMapa"), zapFlutuante: on("zapFlutuante"),
        corPrimaria: f("corPrimaria"), corSecundaria: f("corSecundaria"), corDestaque: f("corDestaque"), corFundo: f("corFundo"), corTexto: f("corTexto"),
        fonte: f("fonte"), cantos: f("cantos"),
        logoUrl: f("logoEndereco") || dados.logo, bannerUrl: f("bannerEndereco") || dados.banner,
        bannerTitulo: f("bannerTitulo"), bannerTexto: f("bannerTexto"), bannerBotao: f("bannerBotao"),
        mostrarCategorias: on("mostrarCategorias"), mostrarDestaques: on("mostrarDestaques"), mostrarLocalizacao: on("mostrarLocalizacao"), mostrarContato: on("mostrarContato"),
        tituloCategorias: f("tituloCategorias"), tituloDestaques: f("tituloDestaques"), qtdDestaques: Math.min(24, Math.max(1, parseInt(f("qtdDestaques"), 10) || 8)),
        tituloLocalizacao: f("tituloLocalizacao"), tituloContato: f("tituloContato"), textoContato: f("textoContato"),
        tituloProdutos: f("tituloProdutos"), subtituloProdutos: f("subtituloProdutos"), mostrarZapProdutos: on("mostrarZapProdutos"),
        entregaAtiva: on("entregaAtiva"), retiradaAtiva: on("retiradaAtiva"),
        taxaEntrega: Math.max(0, parseFloat(f("taxaEntrega")) || 0), freteGratisAcima: Math.max(0, parseFloat(f("freteGratisAcima")) || 0), pedidoMinimo: Math.max(0, parseFloat(f("pedidoMinimo")) || 0),
        entregaAviso: f("entregaAviso"), retiradaEndereco: f("retiradaEndereco"), retiradaInstrucoes: f("retiradaInstrucoes"),
        retiradaDias: DIAS.map((_, i) => i).filter((i) => on("dia_" + i)),
        retiradaHoraInicio: f("retiradaHoraInicio"), retiradaHoraFim: f("retiradaHoraFim"), retiradaIntervalo: parseInt(f("retiradaIntervalo"), 10) || 60,
        retiradaAntecedenciaDias: Math.max(0, parseInt(f("retiradaAntecedenciaDias"), 10) || 0), retiradaMaxDias: Math.max(1, parseInt(f("retiradaMaxDias"), 10) || 30),
        campos: Object.fromEntries(["email", "cpf", "cep", "complemento", "obs"].map((n) => [n, f("campo_" + n)])),
        pagamentos: { pix: on("pg_pix"), credito: on("pg_credito"), debito: on("pg_debito"), dinheiro: on("pg_dinheiro") },
        pixChave: f("pixChave"), pagamentoAviso: f("pagamentoAviso"),
        textoSucesso: f("textoSucesso"), textoFinalWhats: f("textoFinalWhats"), rodapeTexto: f("rodapeTexto"),
      });
      if (!novo.nomeLoja) return erro("loja", "nomeLoja", "Informe o nome da loja");
      if (novo.siteUrl) {
        const bruto = /^https?:\/\//i.test(novo.siteUrl) ? novo.siteUrl : "https://" + novo.siteUrl;
        try { const u = new URL(bruto); if (!u.hostname.includes(".") && u.hostname !== "localhost") throw new Error("host"); novo.siteUrl = bruto; }
        catch { return erro("loja", "siteUrl", "Endereço do site inválido (ex.: https://minhaloja.com.br)"); }
      }
      if (novo.whatsapp.length < 10 || novo.whatsapp.length > 15) return erro("loja", "whatsapp", "WhatsApp inválido (use DDI + DDD + número, só dígitos)");
      if (!novo.entregaAtiva && !novo.retiradaAtiva) return erro("entrega", "entregaAtiva", "Ative pelo menos uma forma de receber: entrega ou retirada");
      if (!Object.values(novo.pagamentos).some(Boolean)) return erro("pagamento", "pg_pix", "Ative pelo menos uma forma de pagamento");
      if (novo.retiradaAtiva) {
        if (!novo.retiradaDias.length) return erro("entrega", "dia_1", "Escolha pelo menos um dia de retirada");
        if (!novo.retiradaHoraInicio || !novo.retiradaHoraFim || novo.retiradaHoraFim <= novo.retiradaHoraInicio) return erro("entrega", "retiradaHoraFim", "O horário final da retirada deve ser depois do inicial");
      }
      if (JSON.stringify(novo).length > 950000) { abrirSecao("aparencia"); return toast("As imagens deixam a configuração grande demais. Use imagens menores ou endereços (URL)."); }
      $("#cfg-salvar").disabled = true;
      if (await tentar(() => DB.config.salvar(novo), "Não foi possível salvar as configurações")) {
        Object.assign(c, novo);
        A.configMudou(novo);
        A.pintar(novo.corPrimaria); try { localStorage.setItem("lo_admin_cor", novo.corPrimaria || ""); } catch { /* ignorado */ }
        $("#side-nome").textContent = novo.nomeLoja;
        $("#cfg-estado").textContent = "Salvo";
        toast("Configurações salvas");
      }
      $("#cfg-salvar").disabled = false;
    };

    // ---- impressora e avisos: cada opção é salva na hora ----
    const salvarOpcao = async (chave, valor) => {
      if (!(await tentar(() => DB.config.salvar({ ...c, [chave]: valor }), "Não foi possível salvar"))) return false;
      c[chave] = valor; A.configMudou({ [chave]: valor });
      toast("Salvo");
      return true;
    };
    const painel = $("#painel-impressora");
    ["impressaoAutoSite", "impressaoAutoPdv", "avisoPedidoSite", "avisoSom"].forEach((n) => {
      painel.querySelector(`[name="${n}"]`).onchange = async (e) => { if (!(await salvarOpcao(n, e.target.checked))) e.target.checked = !e.target.checked; };
    });
    painel.querySelector('[name="impressoraLargura"]').onchange = (e) => salvarOpcao("impressoraLargura", parseInt(e.target.value, 10) === 48 ? 48 : 32);

    const imp = A.impressora, sup = imp.suporte();
    const atualizarStatus = () => {
      const ok = imp.conectada();
      $("#imp-status").innerHTML = ok
        ? `<span class="status s-ativo"><i class="fab fa-bluetooth-b"></i> Conectada</span> <b>${esc(imp.nome())}</b>`
        : `<span class="status s-inativo">Desconectada</span> <span class="dica">Nenhuma impressora conectada neste navegador.</span>`;
      $("#imp-desconectar").hidden = !ok;
      $("#imp-teste").disabled = !ok;
    };
    if (A._desinscreverImpressora) A._desinscreverImpressora();
    A._desinscreverImpressora = imp.aoMudar(atualizarStatus);
    atualizarStatus();
    $("#imp-ble").disabled = !sup.ble; $("#imp-ble").title = sup.ble ? "" : "Este navegador não suporta Bluetooth (use Chrome ou Edge)";
    $("#imp-serial").disabled = !sup.serial; $("#imp-serial").title = sup.serial ? "" : "Este navegador não suporta porta serial (use Chrome ou Edge no computador)";

    const conectar = (fn, ok) => async (e) => {
      const botao = e.currentTarget; // guarda antes do await (depois dele o evento já terminou)
      botao.disabled = true;
      try { await fn(); toast(ok); }
      catch (err) { if (err && err.name !== "NotFoundError") toast(err.message || "Não foi possível conectar"); } // NotFoundError = o usuário fechou a janela de escolha
      finally { botao.disabled = false; atualizarStatus(); $("#imp-ble").disabled = !sup.ble; $("#imp-serial").disabled = !sup.serial; }
    };
    $("#imp-ble").onclick = conectar(() => imp.conectarBle(), "Impressora conectada");
    $("#imp-serial").onclick = conectar(() => imp.conectarSerial(), "Impressora conectada");
    $("#imp-desconectar").onclick = async () => { await imp.desconectar(); toast("Impressora desconectada"); };
    $("#imp-teste").onclick = async () => { try { await imp.testar(); toast("Teste enviado para a impressora"); } catch (err) { toast("Não foi possível imprimir: " + (err.message || "erro")); } };

    const estadoNotif = () => {
      $("#aviso-estado").textContent = !("Notification" in window) ? "Este navegador não suporta notificações."
        : Notification.permission === "granted" ? "Notificações do navegador: ativadas."
        : Notification.permission === "denied" ? "Notificações bloqueadas no navegador (libere nas permissões do site)." : "Notificações do navegador: ainda não ativadas.";
    };
    estadoNotif();
    $("#aviso-permissao").onclick = async () => {
      if (!("Notification" in window)) return toast("Este navegador não suporta notificações.");
      try { await Notification.requestPermission(); } catch { /* ignorado */ }
      estadoNotif();
    };
    $("#aviso-teste").onclick = () => A.avisoTeste();
  };
});
