// Aba Estoque: painel (indicadores e gráficos), lista com ajustes, contagem de inventário e histórico de movimentações.
// Toda mudança feita aqui (e as vendas/pedidos) é gravada em "movimentos" por DB.produtos.ajustarEstoque/definirEstoque.
window.Admin.modulos.push((A) => {
  const { $, toast, tentar, abrirModal, carregando, dataBR } = A;
  const { moeda, esc } = DB;
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const pad = (n) => String(n).padStart(2, "0");

  const SUBS = [["painel", "Painel", "fa-chart-column"], ["itens", "Estoque", "fa-boxes-stacked"], ["contagem", "Contagem", "fa-clipboard-check"], ["mov", "Movimentações", "fa-clock-rotate-left"]];
  let sub = "painel";
  const filtro = { busca: "", cat: "todas", sit: "todas", ordem: "nome", variacoes: true };
  const filtroCont = { busca: "", cat: "todas" };
  const filtroMov = { dias: "30", tipo: "todos", busca: "", produtoId: "" };
  let ultimo = { mapa: new Map(), cfg: {} }; // últimas linhas carregadas (para as ações dos botões)

  const TIPOS = {
    entrada: ["Entrada", "s-ativo"], saida: ["Saída", "s-cancelado"], ajuste: ["Ajuste", "s-confirmado"], inventario: ["Inventário", "s-novo"],
    venda_pdv: ["Venda PDV", "s-enviado"], pedido_site: ["Pedido do site", "s-enviado"], cancelamento_pdv: ["Cancel. PDV", "s-confirmado"], estorno_pedido: ["Estorno pedido", "s-confirmado"],
  };
  const rotuloTipo = (t) => (TIPOS[t] || [t || "Movimento", "s-inativo"]);
  const GRUPOS_TIPO = { todos: null, entrada: ["entrada"], saida: ["saida"], ajuste: ["ajuste", "inventario"], vendas: ["venda_pdv", "pedido_site"], estornos: ["cancelamento_pdv", "estorno_pedido"] };

  // ---------- dados ----------
  const base = async () => {
    const [produtos, categorias, cfg] = await Promise.all([DB.produtos.listar(), DB.categorias.listar(), DB.config.obter()]);
    return { produtos, categorias, cats: Object.fromEntries(categorias.map((c) => [c.id, c.nome])), cfg };
  };
  const minimoDe = (p, cfg) => (Number.isFinite(p.estoqueMinimo) ? p.estoqueMinimo : Number.isFinite(cfg.estoqueMinimoPadrao) ? cfg.estoqueMinimoPadrao : 5);
  const situacao = (l) => (l.estoque <= 0 ? "zerado" : l.estoque <= l.min ? "baixo" : "ok");
  const chaveDe = (l) => l.p.id + "|" + l.vid;

  // uma linha por produto (ou por variação); produtos com variações ganham também uma linha "pai" com o total
  const linhasDoProduto = (p, cfg) => {
    const min = minimoDe(p, cfg), custo = Number.isFinite(p.custo) ? p.custo : null;
    const comum = { p, nome: p.nome, min, custo, preco: num(p.preco) };
    if (Array.isArray(p.variantes) && p.variantes.length) {
      return {
        pai: { ...comum, pai: true, vid: "", estoque: num(p.estoque), filhos: p.variantes.length },
        folhas: p.variantes.map((v) => ({ ...comum, vid: v.id, variante: v.nome, estoque: num(v.estoque), filha: true })),
      };
    }
    return { pai: null, folhas: [{ ...comum, vid: "", estoque: num(p.estoque) }] };
  };
  const todasFolhas = (produtos, cfg) => produtos.flatMap((p) => linhasDoProduto(p, cfg).folhas);
  const totaisDe = (folhas) => folhas.reduce((t, l) => {
    t.unid += l.estoque; t.vVenda += l.estoque * l.preco;
    if (l.custo != null) { t.vCusto += l.estoque * l.custo; t.lucro += l.estoque * (l.preco - l.custo); } else t.semCusto++;
    const s = situacao(l); if (s === "zerado") t.zerados++; else if (s === "baixo") t.baixos++; else t.ok++;
    return t;
  }, { unid: 0, vVenda: 0, vCusto: 0, lucro: 0, semCusto: 0, zerados: 0, baixos: 0, ok: 0 });

  const nomeDe = (l) => l.nome + (l.variante ? ` — ${l.variante}` : "");
  const selo = (l) => {
    const s = situacao(l);
    return `<span class="status ${s === "zerado" ? "s-cancelado" : s === "baixo" ? "s-confirmado" : "s-ativo"}">${s === "zerado" ? "Sem estoque" : s === "baixo" ? "Baixo" : "Normal"}</span>`;
  };
  const baixarCsv = (nome, linhas) => {
    const cel = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + linhas.map((l) => l.map(cel).join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    a.download = nome; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const vl = (v) => String(Math.round(v * 100) / 100).replace(".", ",");

  // contador do menu: itens sem estoque ou abaixo do mínimo
  A.atualizarPillEstoque = async () => {
    try {
      const { produtos, cfg } = await base();
      const t = totaisDe(todasFolhas(produtos, cfg)), n = t.zerados + t.baixos;
      const el = $("#pill-estoque");
      el.hidden = n === 0; el.textContent = n; el.title = `${t.zerados} sem estoque, ${t.baixos} com estoque baixo`;
    } catch { /* ignorado */ }
  };
  const aoEntrarAnterior = A.aoEntrar;
  A.aoEntrar = async () => { if (aoEntrarAnterior) await aoEntrarAnterior(); A.atualizarPillEstoque(); };

  // ---------- exportação ----------
  const SIT_ROTULO = { zerado: "Sem estoque", baixo: "Baixo", ok: "Normal" };
  const dhAgora = () => new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  // linhas da tabela exportada: uma por produto/variação, na mesma ordem que aparece na tela
  const linhaExport = (l, cats) => ({
    codigo: l.p.codigo || "", produto: l.nome, variacao: l.variante || "", categoria: cats[l.p.categoria] || "Sem categoria",
    estoque: l.estoque, minimo: l.min, custo: l.custo, preco: l.preco,
    valorCusto: l.custo != null ? l.estoque * l.custo : null, valorVenda: l.estoque * l.preco, situacao: situacao(l),
  });
  const totaisExport = (rows) => rows.reduce((t, r) => ({
    estoque: t.estoque + r.estoque, valorCusto: t.valorCusto + (r.valorCusto || 0), valorVenda: t.valorVenda + r.valorVenda,
    zerados: t.zerados + (r.situacao === "zerado" ? 1 : 0), baixos: t.baixos + (r.situacao === "baixo" ? 1 : 0), semCusto: t.semCusto + (r.custo == null ? 1 : 0),
  }), { estoque: 0, valorCusto: 0, valorVenda: 0, zerados: 0, baixos: 0, semCusto: 0 });

  // --- ZIP sem compressão (formato do .xlsx) ---
  const TABELA_CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (bytes) => { let c = 0xffffffff; for (let i = 0; i < bytes.length; i++) c = TABELA_CRC[(c ^ bytes[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const zipar = (arquivos) => {
    const enc = new TextEncoder(), partes = [], central = [];
    let pos = 0;
    arquivos.forEach(([nome, texto]) => {
      const nomeB = enc.encode(nome), dados = enc.encode(texto), crc = crc32(dados);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true);
      local.setUint16(10, 0, true); local.setUint16(12, 33, true); local.setUint32(14, crc, true); local.setUint32(18, dados.length, true); local.setUint32(22, dados.length, true);
      local.setUint16(26, nomeB.length, true); local.setUint16(28, 0, true);
      partes.push(new Uint8Array(local.buffer), nomeB, dados);
      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true); cd.setUint16(10, 0, true);
      cd.setUint16(12, 0, true); cd.setUint16(14, 33, true); cd.setUint32(16, crc, true); cd.setUint32(20, dados.length, true); cd.setUint32(24, dados.length, true);
      cd.setUint16(28, nomeB.length, true); cd.setUint32(42, pos, true);
      central.push(new Uint8Array(cd.buffer), nomeB);
      pos += 30 + nomeB.length + dados.length;
    });
    const tamCentral = central.reduce((s2, p) => s2 + p.length, 0);
    const fim = new DataView(new ArrayBuffer(22));
    fim.setUint32(0, 0x06054b50, true); fim.setUint16(8, arquivos.length, true); fim.setUint16(10, arquivos.length, true); fim.setUint32(12, tamCentral, true); fim.setUint32(16, pos, true);
    const todos = [...partes, ...central, new Uint8Array(fim.buffer)];
    const saida = new Uint8Array(todos.reduce((s2, p) => s2 + p.length, 0));
    let o = 0; todos.forEach((p) => { saida.set(p, o); o += p.length; });
    return saida;
  };

  // --- planilha Excel formatada ---
  const xml = (v) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const letra = (i) => { let n = i + 1, r = ""; while (n > 0) { r = String.fromCharCode(65 + ((n - 1) % 26)) + r; n = Math.floor((n - 1) / 26); } return r; };
  // estilos (índices usados em s="..."): 1 título, 2 subtítulo, 3 cabeçalho, 4 texto, 5 inteiro, 6 moeda, 7 normal, 8 baixo, 9 sem estoque, 10 total (texto), 11 total inteiro, 12 total moeda, 13 rótulo do resumo, 14 valor do resumo (moeda), 15 valor do resumo (inteiro)
  const ESTILOS = String.raw`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;R$&quot;\ #,##0.00"/></numFmts>
<fonts count="6">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="16"/><color rgb="FF111827"/><name val="Calibri"/></font>
<font><i/><sz val="10"/><color rgb="FF6B7280"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FF374151"/><name val="Calibri"/></font>
</fonts>
<fills count="7">
<fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF4F46E5"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFDCFCE7"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFEF3C7"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFEE2E2"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE5E7EB"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFD1D5DB"/></left><right style="thin"><color rgb="FFD1D5DB"/></right><top style="thin"><color rgb="FFD1D5DB"/></top><bottom style="thin"><color rgb="FFD1D5DB"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="16">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="1" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="4" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="3" fontId="4" fillId="6" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>
<xf numFmtId="164" fontId="4" fillId="6" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>
<xf numFmtId="0" fontId="5" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>
<xf numFmtId="164" fontId="4" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>
<xf numFmtId="3" fontId="4" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
  const celula = (c, r, valor, estilo) => {
    const ref = letra(c) + r;
    if (valor === null || valor === undefined || valor === "") return `<c r="${ref}" s="${estilo}"/>`;
    if (typeof valor === "number") return `<c r="${ref}" s="${estilo}"><v>${Number.isFinite(valor) ? Math.round(valor * 100) / 100 : 0}</v></c>`;
    return `<c r="${ref}" s="${estilo}" t="inlineStr"><is><t xml:space="preserve">${xml(valor)}</t></is></c>`;
  };
  const planilha = (linhas, larguras, extra = {}) => {
    const dados = linhas.map((cels, i) => `<row r="${i + 1}"${extra.alturas && extra.alturas[i + 1] ? ` ht="${extra.alturas[i + 1]}" customHeight="1"` : ""}>${cels.map(([v, e], c) => celula(c, i + 1, v, e)).join("")}</row>`).join("");
    const ultima = letra(Math.max(...linhas.map((l) => l.length)) - 1) + linhas.length;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<dimension ref="A1:${ultima}"/>
<sheetViews><sheetView workbookViewId="0" showGridLines="0">${extra.congelar ? `<pane ySplit="${extra.congelar}" topLeftCell="A${extra.congelar + 1}" activePane="bottomLeft" state="frozen"/>` : ""}</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="18"/>
<cols>${larguras.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>
<sheetData>${dados}</sheetData>${extra.filtro ? `<autoFilter ref="${extra.filtro}"/>` : ""}
<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>
<pageSetup paperSize="9" orientation="landscape" fitToHeight="0"/>
</worksheet>`;
  };
  const gerarXlsx = (rows, meta) => {
    const cab = ["Código", "Produto", "Variação", "Categoria", "Estoque", "Mínimo", "Custo unit.", "Preço de venda", "Valor a custo", "Valor de venda", "Situação"];
    const T = totaisExport(rows);
    const estSit = { ok: 7, baixo: 8, zerado: 9 };
    const linhas = [
      [[`Estoque — ${meta.loja}`, 1]],
      [[`Gerado em ${meta.quando} · ${rows.length} item(ns)${meta.filtros ? " · " + meta.filtros : ""}`, 2]],
      [],
      cab.map((c) => [c, 3]),
      ...rows.map((r) => [[r.codigo, 4], [r.produto, 4], [r.variacao, 4], [r.categoria, 4], [r.estoque, 5], [r.minimo, 5], [r.custo, 6], [r.preco, 6], [r.valorCusto, 6], [r.valorVenda, 6], [SIT_ROTULO[r.situacao], estSit[r.situacao]]]),
      [["TOTAL", 10], ["", 10], ["", 10], ["", 10], [T.estoque, 11], ["", 10], ["", 10], ["", 10], [T.valorCusto, 12], [T.valorVenda, 12], ["", 10]],
    ];
    const ultimaDados = 4 + rows.length;
    const aba1 = planilha(linhas, [14, 34, 18, 20, 10, 10, 14, 16, 16, 16, 14], { congelar: 4, filtro: `A4:K${Math.max(ultimaDados, 4)}`, alturas: { 4: 26 } });
    const par = (r, v, e) => [[r, 13], [v, e]];
    const aba2 = planilha([
      [["Resumo do estoque", 1]], [[`Gerado em ${meta.quando}`, 2]], [],
      par("Itens listados", rows.length, 15), par("Unidades em estoque", T.estoque, 15), par("Valor a custo", T.valorCusto, 14), par("Valor a preço de venda", T.valorVenda, 14),
      par("Lucro potencial (itens com custo)", rows.reduce((s2, r) => s2 + (r.custo != null ? r.estoque * (r.preco - r.custo) : 0), 0), 14),
      par("Itens sem estoque", T.zerados, 15), par("Itens com estoque baixo", T.baixos, 15), par("Itens sem custo cadastrado", T.semCusto, 15),
    ], [36, 20]);
    const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    return zipar([
      ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
      ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
      ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${R}"><bookViews><workbookView/></bookViews><sheets><sheet name="Estoque" sheetId="1" r:id="rId1"/><sheet name="Resumo" sheetId="2" r:id="rId2"/></sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">Estoque!$A$4:$K$${Math.max(ultimaDados, 4)}</definedName></definedNames></workbook>`],
      ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${R}/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="${R}/styles" Target="styles.xml"/></Relationships>`],
      ["xl/styles.xml", ESTILOS], ["xl/worksheets/sheet1.xml", aba1], ["xl/worksheets/sheet2.xml", aba2],
    ]);
  };
  const baixarXlsx = (rows, meta) => {
    const blob = new Blob([gerarXlsx(rows, meta)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `estoque_${new Date().toISOString().slice(0, 10)}.xlsx`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  };

  // --- versão para imprimir / salvar como PDF (mesma tabela da aba) ---
  const imprimirTabela = (rows, meta) => {
    const T = totaisExport(rows), m = (v) => moeda(v);
    const w = window.open("", "_blank");
    if (!w) return toast("Permita pop-ups para imprimir ou salvar o PDF");
    const classe = { ok: "ok", baixo: "baixo", zerado: "zero" };
    w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Estoque — ${esc(meta.loja)}</title>
      <style>
        @page { size: A4 landscape; margin: 10mm; }
        body { font-family: system-ui, "Segoe UI", Arial, sans-serif; color: #111827; margin: 0; font-size: 11px; }
        h1 { font-size: 20px; margin: 0 0 2px; } .sub { color: #6b7280; margin-bottom: 10px; }
        .kpis { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
        .kpi { border: 1px solid #d1d5db; border-radius: 8px; padding: 6px 12px; } .kpi span { display: block; color: #6b7280; font-size: 9px; text-transform: uppercase; letter-spacing: .04em; } .kpi b { font-size: 14px; }
        table { width: 100%; border-collapse: collapse; }
        th { background: #4f46e5; color: #fff; padding: 6px 7px; text-align: left; font-size: 10px; } th.n, td.n { text-align: right; }
        td { padding: 5px 7px; border-bottom: 1px solid #e5e7eb; } tbody tr:nth-child(even) td { background: #f9fafb; }
        thead { display: table-header-group; } tr { break-inside: avoid; }
        .sit { display: inline-block; padding: 1px 8px; border-radius: 999px; font-weight: 700; font-size: 10px; }
        .sit.ok { background: #dcfce7; color: #166534; } .sit.baixo { background: #fef3c7; color: #92400e; } .sit.zero { background: #fee2e2; color: #991b1b; }
        tfoot td { font-weight: 700; background: #e5e7eb; border-top: 2px solid #111827; }
        .no { margin: 14px 0; } @media print { .no { display: none; } }
      </style></head><body>
      <h1>Estoque — ${esc(meta.loja)}</h1>
      <div class="sub">Gerado em ${esc(meta.quando)} · ${rows.length} item(ns)${meta.filtros ? " · " + esc(meta.filtros) : ""}</div>
      <div class="kpis">
        <div class="kpi"><span>Unidades</span><b>${T.estoque.toLocaleString("pt-BR")}</b></div>
        <div class="kpi"><span>Valor a custo</span><b>${m(T.valorCusto)}</b></div>
        <div class="kpi"><span>Valor de venda</span><b>${m(T.valorVenda)}</b></div>
        <div class="kpi"><span>Sem estoque</span><b>${T.zerados}</b></div>
        <div class="kpi"><span>Estoque baixo</span><b>${T.baixos}</b></div>
      </div>
      <table><thead><tr><th>Código</th><th>Produto</th><th>Variação</th><th>Categoria</th><th class="n">Estoque</th><th class="n">Mín.</th><th class="n">Custo</th><th class="n">Preço</th><th class="n">Valor a custo</th><th class="n">Valor de venda</th><th>Situação</th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td>${esc(r.codigo)}</td><td>${esc(r.produto)}</td><td>${esc(r.variacao)}</td><td>${esc(r.categoria)}</td><td class="n">${r.estoque}</td><td class="n">${r.minimo}</td><td class="n">${r.custo != null ? m(r.custo) : "—"}</td><td class="n">${m(r.preco)}</td><td class="n">${r.valorCusto != null ? m(r.valorCusto) : "—"}</td><td class="n">${m(r.valorVenda)}</td><td><span class="sit ${classe[r.situacao]}">${SIT_ROTULO[r.situacao]}</span></td></tr>`).join("")}
      </tbody><tfoot><tr><td colspan="4">TOTAL</td><td class="n">${T.estoque.toLocaleString("pt-BR")}</td><td></td><td></td><td></td><td class="n">${m(T.valorCusto)}</td><td class="n">${m(T.valorVenda)}</td><td></td></tr></tfoot></table>
      <p class="no"><button onclick="window.print()">Imprimir / Salvar PDF</button></p>
      <script>window.onload=function(){setTimeout(function(){window.print()},400)}<\/script></body></html>`);
    w.document.close();
  };
  A.estoqueExport = { gerarXlsx, crc32 }; // exposto para conferência

  // ---------- estrutura da aba ----------
  A.telas.estoque = async () => {
    $("#tab-estoque").innerHTML = `
      <div class="cab"><h1>Estoque</h1></div>
      <div class="seg est-sub" id="est-sub" role="tablist">${SUBS.map(([k, n, ic]) => `<button type="button" role="tab" data-sub="${k}" class="${k === sub ? "ativo" : ""}"><i class="fa-solid ${ic}"></i> ${n}</button>`).join("")}</div>
      <div id="est-corpo"></div>`;
    $("#est-sub").onclick = (e) => {
      const b = e.target.closest("[data-sub]");
      if (!b) return;
      sub = b.dataset.sub;
      document.querySelectorAll("#est-sub button").forEach((x) => x.classList.toggle("ativo", x === b));
      desenhar();
    };
    $("#est-corpo").onclick = aoClicar;
    await desenhar();
  };
  const desenhar = () => { $("#est-corpo").innerHTML = `<p class="vazio">Carregando...</p>`; return ({ painel, itens, contagem, mov })[sub]().catch((e) => { console.error(e); $("#est-corpo").innerHTML = `<p class="vazio">Erro ao carregar o estoque. Verifique as regras do Firestore.</p>`; }); };
  const recarregar = () => A.telas.estoque();

  // botões de ação (Entrada, Saída, Ajustar, Histórico) em qualquer sub-aba
  const aoClicar = (e) => {
    const b = e.target.closest("[data-ent], [data-sai], [data-aj], [data-hist]");
    if (!b) return;
    const chave = b.dataset.ent || b.dataset.sai || b.dataset.aj || b.dataset.hist;
    const l = ultimo.mapa.get(chave);
    if (!l) return;
    if (b.dataset.hist) { filtroMov.produtoId = l.p.id; filtroMov.busca = ""; sub = "mov"; return recarregar(); }
    abrirAjuste(l, b.dataset.ent ? "entrada" : b.dataset.sai ? "saida" : "ajuste");
  };
  const botoesAcao = (l) => `<button class="btn peq" data-ent="${esc(chaveDe(l))}" title="Entrada de mercadoria"><i class="fa-solid fa-plus"></i></button>
    <button class="btn sec peq" data-sai="${esc(chaveDe(l))}" title="Saída de estoque"><i class="fa-solid fa-minus"></i></button>
    <button class="btn sec peq" data-aj="${esc(chaveDe(l))}" title="Ajustar para um valor"><i class="fa-solid fa-pen"></i></button>
    <button class="btn sec peq" data-hist="${esc(chaveDe(l))}" title="Histórico do produto"><i class="fa-solid fa-clock-rotate-left"></i></button>`;
  const registrar = (linhas) => { ultimo.mapa = new Map(linhas.filter((l) => !l.pai).map((l) => [chaveDe(l), l])); };

  // ---------- modal de ajuste ----------
  const MOTIVOS = {
    entrada: ["Compra / reposição", "Devolução de cliente", "Transferência recebida", "Bonificação do fornecedor", "Outro"],
    saida: ["Perda / avaria", "Furto / extravio", "Brinde / amostra", "Uso interno", "Transferência enviada", "Devolução ao fornecedor", "Outro"],
    ajuste: ["Correção de contagem", "Erro de cadastro", "Outro"],
  };
  const abrirAjuste = (l, modo) => {
    const atual = l.estoque;
    const titulos = { entrada: "Entrada de mercadoria", saida: "Saída de estoque", ajuste: "Ajustar estoque" };
    abrirModal(titulos[modo], `
      <div class="detalhe"><p><b>${esc(nomeDe(l))}</b></p><p>Estoque atual: <b>${atual}</b> un. · mínimo ${l.min}</p></div>
      ${modo === "ajuste"
        ? `<label>Novo estoque (quantidade correta)<input name="novo" id="aj-novo" type="number" min="0" step="1" value="${atual}" required /></label>`
        : `<label>Quantidade<input name="qtd" id="aj-qtd" type="number" min="1" step="1" required autofocus /></label>`}
      ${modo === "entrada" ? `<div class="grid2">
          <label>Custo unitário (R$) — opcional<input name="custo" type="number" min="0" step="0.01" value="${l.custo ?? ""}" /></label>
          <label class="check" style="align-self:end"><input type="checkbox" name="atualizarCusto" /> Atualizar o custo do produto</label></div>` : ""}
      <label>Motivo<select name="motivo">${MOTIVOS[modo].map((m) => `<option>${m}</option>`).join("")}</select></label>
      <label>Observação (opcional)<input name="obs" placeholder="Ex.: nota fiscal 1234" /></label>
      ${modo === "ajuste" ? `<label>Estoque mínimo deste produto (alerta)<input name="min" type="number" min="0" step="1" value="${l.p.estoqueMinimo ?? ""}" placeholder="padrão (${ultimo.cfg.estoqueMinimoPadrao ?? 5})" /></label>` : ""}
      <p class="dica" id="aj-previa"></p>`,
      async (d) => {
        const id = l.p.id, info = { motivo: d.motivo, obs: (d.obs || "").trim() };
        if (modo === "ajuste") {
          const novo = parseInt(d.novo, 10);
          if (!(novo >= 0)) return false;
          const minimo = d.min === "" ? null : Math.max(0, parseInt(d.min, 10) || 0);
          const mudouMin = (minimo ?? null) !== (l.p.estoqueMinimo ?? null);
          if (novo === atual && !mudouMin) { toast("Nada para alterar"); return false; }
          if (!(await tentar(async () => {
            if (novo !== atual) await DB.produtos.definirEstoque(id, novo, l.vid, { ...info, tipo: "ajuste" });
            if (mudouMin) await DB.produtos.atualizarCampos(id, { estoqueMinimo: minimo });
          }))) return false;
        } else {
          const qtd = parseInt(d.qtd, 10);
          if (!(qtd >= 1)) return false;
          if (modo === "saida" && qtd > atual) { toast(`A saída (${qtd}) é maior que o estoque atual (${atual}).`); return false; }
          const custo = d.custo === "" || d.custo === undefined ? null : parseFloat(d.custo);
          if (!(await tentar(() => DB.produtos.ajustarEstoque(id, modo === "entrada" ? qtd : -qtd, l.vid, { ...info, tipo: modo, custoUnit: custo, atualizarCusto: d.atualizarCusto === "on" })))) return false;
        }
        toast("Estoque atualizado"); recarregar();
      }, { salvar: "Confirmar" });
    const form = $("#modal-form"), previa = $("#aj-previa");
    if (form._previaAjuste) form.removeEventListener("input", form._previaAjuste); // o formulário do modal é compartilhado: tira o ouvinte da abertura anterior
    const atualizarPrevia = () => {
      const campo = form.elements.qtd || form.elements.novo;
      if (!campo || !previa.isConnected) return;
      const v = parseInt(campo.value, 10);
      if (!(v >= 0)) { previa.textContent = ""; return; }
      const depois = modo === "ajuste" ? v : modo === "entrada" ? atual + v : Math.max(0, atual - v);
      previa.innerHTML = `Estoque: <b>${atual}</b> → <b>${depois}</b> un.${depois <= 0 ? ' <span style="color:var(--erro)">(sem estoque)</span>' : depois <= l.min ? ' <span style="color:var(--aviso)">(abaixo do mínimo)</span>' : ""}`;
    };
    form._previaAjuste = atualizarPrevia;
    form.addEventListener("input", atualizarPrevia); atualizarPrevia();
  };

  // ============================================================
  // Painel
  // ============================================================
  const painel = async () => {
    const agora = new Date(), ini = new Date(agora.getTime() - 30 * 86400000);
    const [dados, movs, vendas, pedidos] = await Promise.all([
      base(), DB.movimentos.listarEntre("criadoEm", ini.toISOString(), agora.toISOString()),
      DB.vendas.listarEntre("criadoEm", ini.toISOString(), agora.toISOString()), DB.pedidos.listarEntre("criadoEm", ini.toISOString(), agora.toISOString()),
    ]);
    const { produtos, cats, cfg } = dados;
    ultimo.cfg = cfg;
    const folhas = todasFolhas(produtos, cfg);
    registrar(folhas);
    const t = totaisDe(folhas);

    // vendidos nos últimos 30 dias, por produto/variação
    const vendidos = {};
    const somar = (itens) => (itens || []).forEach((i) => { const k = i.id + "|" + (i.vid || ""); vendidos[k] = (vendidos[k] || 0) + num(i.qtd); });
    vendas.filter((v) => v.status !== "cancelada").forEach((v) => somar(v.itens));
    pedidos.filter((p) => p.status !== "cancelado").forEach((p) => somar(p.itens));

    // reposição: zerados e baixos, os que acabam primeiro vêm antes
    const repor = folhas.filter((l) => situacao(l) !== "ok").map((l) => {
      const v30 = vendidos[chaveDe(l)] || 0, porDia = v30 / 30;
      return { l, v30, dias: porDia > 0 ? l.estoque / porDia : null, sugestao: Math.max(0, Math.ceil(v30) + l.min - l.estoque) };
    }).sort((a, b) => (situacao(a.l) === "zerado" ? 0 : 1) - (situacao(b.l) === "zerado" ? 0 : 1) || (a.dias ?? 1e9) - (b.dias ?? 1e9) || a.l.estoque - b.l.estoque).slice(0, 12);
    // parado: tem estoque e não vendeu nada em 30 dias
    const parados = folhas.filter((l) => l.estoque > 0 && !(vendidos[chaveDe(l)] > 0))
      .map((l) => ({ l, valor: l.estoque * (l.custo ?? l.preco) })).sort((a, b) => b.valor - a.valor).slice(0, 8);
    const valorParado = folhas.filter((l) => l.estoque > 0 && !(vendidos[chaveDe(l)] > 0)).reduce((s, l) => s + l.estoque * (l.custo ?? l.preco), 0);

    // valor por categoria (preço de venda)
    const porCat = {};
    folhas.forEach((l) => { const c = cats[l.p.categoria] || "Sem categoria"; porCat[c] = porCat[c] || { valor: 0, qtd: 0 }; porCat[c].valor += l.estoque * l.preco; porCat[c].qtd += l.estoque; });
    const rankCat = Object.entries(porCat).map(([rotulo, v]) => ({ rotulo, ...v })).sort((a, b) => b.valor - a.valor);

    // entradas e saídas por dia (30 dias)
    const dias = Array.from({ length: 30 }, (_, i) => { const d = new Date(ini.getFullYear(), ini.getMonth(), ini.getDate() + 1 + i); return { d, k: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }; });
    const idx = new Map(dias.map((x, i) => [x.k, i]));
    const ent = dias.map(() => 0), sai = dias.map(() => 0);
    movs.forEach((m) => { const dt = new Date(m.criadoEm), i = idx.get(`${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`); if (i == null) return; if (m.qtd > 0) ent[i] += m.qtd; else sai[i] += -m.qtd; });
    const rotDias = dias.map((x) => `${pad(x.d.getDate())}/${pad(x.d.getMonth() + 1)}`);
    const G = A.graficos;

    const tot = Math.max(1, folhas.length);
    const seg = (n, cls, rot) => (n ? `<span class="${cls}" style="width:${((n / tot) * 100).toFixed(2)}%" data-tip="${esc(rot + ": " + n)}"></span>` : "");
    const kpi = (r, v, extra = "", dica = "") => `<div class="kpi" ${dica ? `title="${esc(dica)}"` : ""}><span>${r}</span><strong>${v}</strong>${extra}</div>`;

    $("#est-corpo").innerHTML = `
      <div class="kpis">
        ${kpi("Unidades em estoque", t.unid.toLocaleString("pt-BR"), `<small class="delta">${produtos.length} produtos · ${folhas.length} itens</small>`)}
        ${kpi("Valor a custo", moeda(t.vCusto), t.semCusto ? `<small class="delta">${t.semCusto} itens sem custo cadastrado</small>` : "", "Soma de estoque × custo (só itens com custo cadastrado)")}
        ${kpi("Valor a preço de venda", moeda(t.vVenda))}
        ${kpi("Lucro potencial", moeda(t.lucro), `<small class="delta">se tudo for vendido (itens com custo)</small>`)}
        ${kpi("Sem estoque", `<span style="color:${t.zerados ? "var(--erro)" : "inherit"}">${t.zerados}</span>`)}
        ${kpi("Estoque baixo", `<span style="color:${t.baixos ? "var(--aviso)" : "inherit"}">${t.baixos}</span>`, `<small class="delta">até o mínimo de cada item</small>`)}
        ${kpi("Estoque parado", moeda(valorParado), `<small class="delta">sem venda há 30 dias</small>`, "Valor dos itens com estoque que não venderam nos últimos 30 dias")}
      </div>

      <div class="rel-grid">
        <section class="painel">
          <h3>Situação do estoque <small>(${folhas.length} itens)</small></h3>
          <div class="sit-barra" role="img" aria-label="Sem estoque ${t.zerados}, baixo ${t.baixos}, normal ${t.ok}">${seg(t.zerados, "sb-zero", "Sem estoque")}${seg(t.baixos, "sb-baixo", "Estoque baixo")}${seg(t.ok, "sb-ok", "Normal")}</div>
          <ul class="sit-leg">
            <li><i class="fa-solid fa-circle-xmark" style="color:var(--erro)"></i> Sem estoque <b>${t.zerados}</b></li>
            <li><i class="fa-solid fa-triangle-exclamation" style="color:var(--aviso)"></i> Estoque baixo <b>${t.baixos}</b></li>
            <li><i class="fa-solid fa-circle-check" style="color:var(--ok)"></i> Normal <b>${t.ok}</b></li>
          </ul>
        </section>
        <section class="painel">
          <h3>Valor em estoque por categoria <small>(preço de venda)</small></h3>
          ${G.ranking(rankCat, { unidade: " un." })}
        </section>
        <section class="painel cheio">
          <h3>Entradas × saídas de unidades <small>(últimos 30 dias)</small></h3>
          ${G.barras(rotDias, [{ nome: "Entradas", cls: "s1", valores: ent }, { nome: "Saídas", cls: "s2", valores: sai }], { fmt: (v) => `${v} un.`, prefixo: "" })}
        </section>
        <section class="painel cheio">
          <h3>Precisam de reposição <small>(zerados e abaixo do mínimo)</small></h3>
          ${repor.length ? `<table class="tabela-cartoes"><thead><tr><th>Produto</th><th>Estoque</th><th>Mínimo</th><th>Vendas 30 dias</th><th>Dura</th><th>Sugestão de compra</th><th></th></tr></thead><tbody>
            ${repor.map(({ l, v30, dias: dura, sugestao }) => `<tr>
              <td data-label="Nome"><span class="cli-nome"><b>${esc(nomeDe(l))}</b>${selo(l)}</span></td>
              <td data-label="Estoque"><b>${l.estoque}</b></td><td data-label="Mínimo">${l.min}</td><td data-label="Vendas 30 dias">${v30}</td>
              <td data-label="Dura">${dura == null ? "—" : dura < 1 ? "menos de 1 dia" : Math.round(dura) + " dias"}</td>
              <td data-label="Sugestão">${sugestao ? `<b>${sugestao} un.</b>` : "—"}</td>
              <td class="acoes">${botoesAcao(l)}</td></tr>`).join("")}</tbody></table>
            <p class="dica">A sugestão cobre as vendas dos últimos 30 dias e recompõe o estoque mínimo.</p>`
            : `<p class="vazio" style="padding:14px"><i class="fa-solid fa-circle-check" style="color:var(--ok)"></i> Nenhum item abaixo do mínimo.</p>`}
        </section>
        <section class="painel">
          <h3>Estoque parado <small>(sem venda em 30 dias)</small></h3>
          ${parados.length ? `<ul class="lista-simples">${parados.map(({ l, valor }) => `<li><span>${esc(nomeDe(l))} <small class="dica">${l.estoque} un.</small></span><b>${moeda(valor)}</b></li>`).join("")}</ul>` : `<p class="vazio" style="padding:14px">Tudo teve saída nos últimos 30 dias.</p>`}
        </section>
        <section class="painel">
          <h3>Últimas movimentações</h3>
          ${movs.length ? `<ul class="lista-simples">${[...movs].sort((a, b) => b.criadoEm.localeCompare(a.criadoEm)).slice(0, 8).map((m) => `<li><span>${esc(m.produtoNome)}${m.variante ? ` — ${esc(m.variante)}` : ""} <small class="dica">${esc(rotuloTipo(m.tipo)[0])} · ${dataBR(m.criadoEm)}</small></span><b class="${m.qtd > 0 ? "mov-pos" : "mov-neg"}">${m.qtd > 0 ? "+" : ""}${m.qtd}</b></li>`).join("")}</ul>
            <button type="button" class="btn sec peq" data-sub-ir="mov" style="margin-top:8px">Ver todas</button>` : `<p class="vazio" style="padding:14px">Nenhuma movimentação nos últimos 30 dias.</p>`}
        </section>
      </div>`;
    const ver = $("#est-corpo").querySelector("[data-sub-ir]");
    if (ver) ver.onclick = () => { sub = "mov"; recarregar(); };
  };

  // ============================================================
  // Lista de estoque (ver tudo e ajustar)
  // ============================================================
  const itens = async () => {
    const dados = await base();
    const { produtos, categorias, cats, cfg } = dados;
    ultimo.cfg = cfg;
    const cartao = (l) => {
      const val = l.estoque * l.preco;
      const nomeCel = l.filha ? `<span class="cli-nome"><b>↳ ${esc(l.variante)}</b></span>` : `<span class="cli-nome"><b>${esc(l.nome)}</b>${l.pai ? `<small class="dica">${l.filhos} variações</small>` : l.p.codigo ? `<small class="dica">${esc(l.p.codigo)}</small>` : ""}</span>`;
      const img = l.filha ? "" : `<img class="thumb-est" src="${esc(l.p.imagem || DB.placeholder("📦", "#e5e7eb"))}" alt="" />`;
      return `<tr class="${l.pai ? "linha-pai" : l.filha ? "linha-filha" : ""}">
        <td data-label="Nome"><div class="cel-prod">${img}${nomeCel}</div></td>
        <td data-label="Categoria">${l.filha ? "" : esc(cats[l.p.categoria] || "—")}</td>
        <td data-label="Estoque"><b>${l.estoque}</b></td>
        <td data-label="Mínimo">${l.min}</td>
        <td data-label="Custo">${l.custo != null ? moeda(l.custo) : "—"}</td>
        <td data-label="Valor">${moeda(val)}${l.custo != null ? `<small class="dica"> custo ${moeda(l.estoque * l.custo)}</small>` : ""}</td>
        <td data-label="Situação">${l.pai ? "" : selo(l)}</td>
        <td class="acoes">${l.pai ? "" : botoesAcao(l)}</td></tr>`;
    };
    let exportavel = { rows: [], filtros: "" }; // o que está na tela (filtrado e ordenado)
    const montar = () => {
      const b = filtro.busca.trim().toLowerCase();
      let grupos = produtos.filter((p) => (filtro.cat === "todas" || p.categoria === filtro.cat) && (!b || (p.nome + " " + (p.codigo || "")).toLowerCase().includes(b)))
        .map((p) => ({ p, ...linhasDoProduto(p, cfg) }))
        .map((g) => ({ ...g, vis: g.folhas.filter((l) => filtro.sit === "todas" || situacao(l) === filtro.sit) })).filter((g) => g.vis.length);
      const valorG = (g) => g.folhas.reduce((s, l) => s + l.estoque * l.preco, 0);
      const ord = { nome: (a, c) => a.p.nome.localeCompare(c.p.nome, "pt-BR"), menor: (a, c) => num(a.p.estoque) - num(c.p.estoque), valor: (a, c) => valorG(c) - valorG(a) }[filtro.ordem];
      grupos.sort(ord);
      const linhas = grupos.flatMap((g) => (g.pai ? [g.pai, ...(filtro.variacoes ? g.vis : [])] : g.vis));
      registrar(linhas);
      const folhasVis = grupos.flatMap((g) => g.vis), t = totaisDe(folhasVis);
      const descFiltros = [filtro.busca.trim() && `busca "${filtro.busca.trim()}"`, filtro.cat !== "todas" && `categoria ${cats[filtro.cat] || ""}`, filtro.sit !== "todas" && `situação ${SIT_ROTULO[filtro.sit]}`].filter(Boolean).join(", ");
      exportavel = { rows: folhasVis.map((l) => linhaExport(l, cats)), filtros: descFiltros };
      $("#est-resumo").innerHTML = `${grupos.length} produto(s) · <b>${t.unid.toLocaleString("pt-BR")}</b> un. · valor de venda <b>${moeda(t.vVenda)}</b>${t.vCusto ? ` · custo <b>${moeda(t.vCusto)}</b>` : ""}`;
      $("#est-tabela").innerHTML = linhas.length
        ? `<table class="tabela-cartoes tabela-estoque"><thead><tr><th>Produto</th><th>Categoria</th><th>Estoque</th><th>Mínimo</th><th>Custo</th><th>Valor</th><th>Situação</th><th></th></tr></thead><tbody>${linhas.map(cartao).join("")}</tbody></table>`
        : `<p class="vazio">Nenhum produto encontrado.</p>`;
    };
    $("#est-corpo").innerHTML = `
      <div class="filtros est-filtros">
        <input id="est-busca" placeholder="Buscar produto ou código..." value="${esc(filtro.busca)}" />
        <select id="est-cat"><option value="todas">Todas as categorias</option>${categorias.sort((a, c) => a.nome.localeCompare(c.nome, "pt-BR")).map((c) => `<option value="${esc(c.id)}" ${filtro.cat === c.id ? "selected" : ""}>${esc(c.nome)}</option>`).join("")}</select>
        <select id="est-sit">${[["todas", "Todas as situações"], ["zerado", "Sem estoque"], ["baixo", "Estoque baixo"], ["ok", "Normal"]].map(([v, n]) => `<option value="${v}" ${filtro.sit === v ? "selected" : ""}>${n}</option>`).join("")}</select>
        <select id="est-ord">${[["nome", "Ordem: nome"], ["menor", "Ordem: menor estoque"], ["valor", "Ordem: maior valor"]].map(([v, n]) => `<option value="${v}" ${filtro.ordem === v ? "selected" : ""}>${n}</option>`).join("")}</select>
      </div>
      <div class="est-barra">
        <label class="check"><input type="checkbox" id="est-var" ${filtro.variacoes ? "checked" : ""} /> Mostrar variações</label>
        <label class="min-padrao">Mínimo padrão <input type="number" id="min-padrao" min="0" step="1" value="${cfg.estoqueMinimoPadrao ?? 5}" /></label>
        <span class="est-exportar">
          <button type="button" class="btn peq" id="est-xlsx" title="Planilha do Excel formatada, com os filtros aplicados"><i class="fa-solid fa-file-excel"></i> Excel</button>
          <button type="button" class="btn sec peq" id="est-pdf" title="Abre a tabela para imprimir ou salvar em PDF"><i class="fa-solid fa-file-pdf"></i> PDF / Imprimir</button>
          <button type="button" class="btn sec peq" id="est-csv"><i class="fa-solid fa-file-csv"></i> CSV</button>
        </span>
        <span class="dica" id="est-resumo" style="margin-left:auto"></span>
      </div>
      <div id="est-tabela"></div>`;
    montar();
    const busca = $("#est-busca");
    busca.oninput = () => { filtro.busca = busca.value; clearTimeout(busca._t); busca._t = setTimeout(montar, 200); };
    $("#est-cat").onchange = (e) => { filtro.cat = e.target.value; montar(); };
    $("#est-sit").onchange = (e) => { filtro.sit = e.target.value; montar(); };
    $("#est-ord").onchange = (e) => { filtro.ordem = e.target.value; montar(); };
    $("#est-var").onchange = (e) => { filtro.variacoes = e.target.checked; montar(); };
    $("#min-padrao").onchange = async (e) => {
      const v = Math.max(0, parseInt(e.target.value, 10) || 0);
      if (await tentar(() => DB.config.salvar({ ...cfg, estoqueMinimoPadrao: v }))) { cfg.estoqueMinimoPadrao = v; A.configMudou({ estoqueMinimoPadrao: v }); toast("Mínimo padrão salvo"); montar(); A.atualizarPillEstoque(); }
    };
    const metaExport = () => ({ loja: cfg.nomeLoja || "Loja", quando: dhAgora(), filtros: exportavel.filtros });
    const exigirLinhas = () => { if (!exportavel.rows.length) { toast("Não há itens na lista para exportar."); return false; } return true; };
    $("#est-xlsx").onclick = () => { if (exigirLinhas()) { baixarXlsx(exportavel.rows, metaExport()); toast("Planilha gerada"); } };
    $("#est-pdf").onclick = () => { if (exigirLinhas()) imprimirTabela(exportavel.rows, metaExport()); };
    $("#est-csv").onclick = () => {
      if (!exigirLinhas()) return;
      const cab = ["Código", "Produto", "Variação", "Categoria", "Estoque", "Mínimo", "Custo", "Preço", "Valor a custo", "Valor de venda", "Situação"];
      baixarCsv(`estoque_${new Date().toISOString().slice(0, 10)}.csv`, [cab, ...exportavel.rows.map((r) => [r.codigo, r.produto, r.variacao, r.categoria, r.estoque, r.minimo, r.custo != null ? vl(r.custo) : "", vl(r.preco), r.valorCusto != null ? vl(r.valorCusto) : "", vl(r.valorVenda), SIT_ROTULO[r.situacao]])]);
    };
  };

  // ============================================================
  // Contagem (inventário)
  // ============================================================
  const contagem = async () => {
    const { produtos, categorias, cats, cfg } = await base();
    ultimo.cfg = cfg;
    const todas = todasFolhas(produtos, cfg).sort((a, b) => nomeDe(a).localeCompare(nomeDe(b), "pt-BR"));
    const visiveis = () => { const b = filtroCont.busca.trim().toLowerCase(); return todas.filter((l) => (filtroCont.cat === "todas" || l.p.categoria === filtroCont.cat) && (!b || (nomeDe(l) + " " + (l.p.codigo || "")).toLowerCase().includes(b))); };
    $("#est-corpo").innerHTML = `
      <div class="painel" style="margin-bottom:12px">
        <h3 style="margin-bottom:4px"><i class="fa-solid fa-clipboard-check"></i> Contagem de estoque (inventário)</h3>
        <p class="dica">Conte os itens na prateleira e digite a quantidade encontrada. Só os itens que você preencher e que forem diferentes do sistema serão ajustados (cada ajuste fica no histórico como "Inventário").</p>
      </div>
      <div class="filtros est-filtros">
        <input id="ct-busca" placeholder="Filtrar produto ou código..." value="${esc(filtroCont.busca)}" />
        <select id="ct-cat"><option value="todas">Todas as categorias</option>${[...categorias].sort((a, c) => a.nome.localeCompare(c.nome, "pt-BR")).map((c) => `<option value="${esc(c.id)}" ${filtroCont.cat === c.id ? "selected" : ""}>${esc(c.nome)}</option>`).join("")}</select>
        <button type="button" class="btn sec peq" id="ct-preencher">Preencher com o estoque atual</button>
        <button type="button" class="btn sec peq" id="ct-folha"><i class="fa-solid fa-file-csv"></i> Folha de contagem (CSV)</button>
      </div>
      <div id="ct-tabela"></div>
      <div class="cfg-barra"><span class="dica" id="ct-resumo">Nenhuma diferença informada.</span><button type="button" class="btn" id="ct-aplicar" disabled><i class="fa-solid fa-check"></i> Aplicar contagem</button></div>`;
    const valores = new Map(); // chave -> texto digitado (preservado ao filtrar)
    const diferencas = () => todas.map((l) => { const t = valores.get(chaveDe(l)); if (t === undefined || t === "") return null; const n = parseInt(t, 10); return Number.isFinite(n) && n >= 0 && n !== l.estoque ? { l, novo: n, dif: n - l.estoque } : null; }).filter(Boolean);
    const celDif = (l) => { const t = valores.get(chaveDe(l)); if (t === undefined || t === "") return "—"; const n = parseInt(t, 10); if (!(n >= 0)) return `<span style="color:var(--erro)">inválido</span>`; const d = n - l.estoque; return d === 0 ? `<span style="color:var(--ok)">OK</span>` : `<b class="${d > 0 ? "mov-pos" : "mov-neg"}">${d > 0 ? "+" : ""}${d}</b>`; };
    const resumo = () => {
      const d = diferencas(), liq = d.reduce((s, x) => s + x.dif, 0);
      $("#ct-resumo").innerHTML = d.length ? `<b>${d.length}</b> item(ns) com diferença · saldo <b class="${liq >= 0 ? "mov-pos" : "mov-neg"}">${liq > 0 ? "+" : ""}${liq}</b> un.` : "Nenhuma diferença informada.";
      $("#ct-aplicar").disabled = !d.length;
    };
    const desenharTabela = () => {
      const L = visiveis();
      registrar(todas);
      $("#ct-tabela").innerHTML = L.length ? `<table class="tabela-cartoes"><thead><tr><th>Produto</th><th>No sistema</th><th>Contado</th><th>Diferença</th></tr></thead><tbody>${L.map((l) => `<tr>
        <td data-label="Nome"><span class="cli-nome"><b>${esc(nomeDe(l))}</b>${l.p.codigo ? `<small class="dica">${esc(l.p.codigo)}</small>` : ""}</span></td>
        <td data-label="No sistema"><b>${l.estoque}</b></td>
        <td data-label="Contado"><input class="in-cont" type="number" min="0" step="1" inputmode="numeric" data-cont="${esc(chaveDe(l))}" value="${esc(valores.get(chaveDe(l)) ?? "")}" placeholder="${l.estoque}" /></td>
        <td data-label="Diferença" data-dif="${esc(chaveDe(l))}">${celDif(l)}</td></tr>`).join("")}</tbody></table>` : `<p class="vazio">Nenhum item encontrado.</p>`;
    };
    desenharTabela(); resumo();
    $("#ct-tabela").addEventListener("input", (e) => {
      const inp = e.target.closest("[data-cont]");
      if (!inp) return;
      valores.set(inp.dataset.cont, inp.value);
      const l = ultimo.mapa.get(inp.dataset.cont);
      inp.closest("tr").querySelector("[data-dif]").innerHTML = celDif(l);
      resumo();
    });
    const busca = $("#ct-busca");
    busca.oninput = () => { filtroCont.busca = busca.value; clearTimeout(busca._t); busca._t = setTimeout(desenharTabela, 200); };
    $("#ct-cat").onchange = (e) => { filtroCont.cat = e.target.value; desenharTabela(); };
    $("#ct-preencher").onclick = () => { visiveis().forEach((l) => valores.set(chaveDe(l), String(l.estoque))); desenharTabela(); resumo(); };
    $("#ct-folha").onclick = () => baixarCsv(`folha-contagem_${new Date().toISOString().slice(0, 10)}.csv`, [["Produto", "Código", "No sistema", "Contado"], ...todas.map((l) => [nomeDe(l), l.p.codigo || "", l.estoque, ""])]);
    $("#ct-aplicar").onclick = async () => {
      const d = diferencas();
      if (!d.length) return;
      const liq = d.reduce((s, x) => s + x.dif, 0);
      if (!confirm(`Aplicar a contagem?\n\n${d.length} item(ns) serão ajustados (saldo ${liq > 0 ? "+" : ""}${liq} unidades) e registrados no histórico como Inventário.`)) return;
      const botao = $("#ct-aplicar"); botao.disabled = true;
      let feitos = 0;
      const ok = await tentar(async () => {
        for (const { l, novo } of d) { await DB.produtos.definirEstoque(l.p.id, novo, l.vid, { tipo: "inventario", motivo: "Contagem de estoque" }); feitos++; }
      }, `A contagem parou após ${feitos} item(ns). Confira o histórico e tente de novo.`);
      if (ok) toast(`Contagem aplicada: ${feitos} item(ns) ajustados`);
      recarregar(); A.atualizarPillEstoque();
    };
  };

  // ============================================================
  // Movimentações (histórico)
  // ============================================================
  const mov = async () => {
    const agora = new Date(), ini = new Date(agora.getTime() - Number(filtroMov.dias) * 86400000);
    const todas = (await DB.movimentos.listarEntre("criadoEm", ini.toISOString(), agora.toISOString())).sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
    const grupo = GRUPOS_TIPO[filtroMov.tipo], b = filtroMov.busca.trim().toLowerCase();
    const lista = todas.filter((m) => (!grupo || grupo.includes(m.tipo)) && (!filtroMov.produtoId || m.produtoId === filtroMov.produtoId)
      && (!b || `${m.produtoNome} ${m.variante || ""} ${m.motivo || ""} ${m.ref || ""} ${m.obs || ""}`.toLowerCase().includes(b)));
    const entradas = lista.filter((m) => m.qtd > 0).reduce((s, m) => s + m.qtd, 0), saidas = lista.filter((m) => m.qtd < 0).reduce((s, m) => s - m.qtd, 0);
    const filtrado = filtroMov.produtoId ? (todas.find((m) => m.produtoId === filtroMov.produtoId) || {}).produtoNome : "";
    $("#est-corpo").innerHTML = `
      <div class="filtros est-filtros">
        <select id="mv-dias">${[["7", "Últimos 7 dias"], ["30", "Últimos 30 dias"], ["90", "Últimos 90 dias"], ["365", "Último ano"]].map(([v, n]) => `<option value="${v}" ${filtroMov.dias === v ? "selected" : ""}>${n}</option>`).join("")}</select>
        <select id="mv-tipo">${[["todos", "Todos os tipos"], ["entrada", "Entradas"], ["saida", "Saídas"], ["ajuste", "Ajustes e inventário"], ["vendas", "Vendas (PDV e site)"], ["estornos", "Cancelamentos e estornos"]].map(([v, n]) => `<option value="${v}" ${filtroMov.tipo === v ? "selected" : ""}>${n}</option>`).join("")}</select>
        <input id="mv-busca" placeholder="Buscar produto, motivo ou pedido..." value="${esc(filtroMov.busca)}" />
        <button type="button" class="btn sec peq" id="mv-csv"><i class="fa-solid fa-file-csv"></i> CSV</button>
      </div>
      ${filtrado ? `<p class="chip-filtro">Produto: <b>${esc(filtrado)}</b> <button type="button" id="mv-limpar" aria-label="Remover filtro de produto">&times;</button></p>` : ""}
      <p class="dica" style="margin-bottom:8px">${lista.length} movimentação(ões) · entradas <b class="mov-pos">+${entradas}</b> · saídas <b class="mov-neg">-${saidas}</b> un.${lista.length > 300 ? " · mostrando as 300 mais recentes" : ""}</p>
      ${lista.length ? `<table class="tabela-cartoes"><thead><tr><th>Data</th><th>Produto</th><th>Tipo</th><th>Quantidade</th><th>Estoque</th><th>Motivo</th><th>Por</th></tr></thead><tbody>
        ${lista.slice(0, 300).map((m) => { const [rot, cls] = rotuloTipo(m.tipo); return `<tr>
          <td data-label="Data">${dataBR(m.criadoEm)}</td>
          <td data-label="Nome"><span class="cli-nome"><b>${esc(m.produtoNome)}</b>${m.variante ? `<small class="dica">${esc(m.variante)}</small>` : ""}</span></td>
          <td data-label="Tipo"><span class="status ${cls}">${esc(rot)}</span></td>
          <td data-label="Qtd"><b class="${m.qtd > 0 ? "mov-pos" : "mov-neg"}">${m.qtd > 0 ? "+" : ""}${m.qtd}</b></td>
          <td data-label="Estoque">${m.antes} → <b>${m.depois}</b></td>
          <td data-label="Motivo">${esc(m.motivo || "—")}${m.obs ? `<br><small class="dica">${esc(m.obs)}</small>` : ""}</td>
          <td data-label="Por"><small>${esc((m.por || "—").split("@")[0])}</small></td></tr>`; }).join("")}</tbody></table>` : `<p class="vazio">Nenhuma movimentação neste filtro.</p>`}`;
    $("#mv-dias").onchange = (e) => { filtroMov.dias = e.target.value; recarregar(); };
    $("#mv-tipo").onchange = (e) => { filtroMov.tipo = e.target.value; recarregar(); };
    const busca = $("#mv-busca");
    busca.oninput = () => { filtroMov.busca = busca.value; clearTimeout(busca._t); busca._t = setTimeout(async () => { await recarregar(); const n = $("#mv-busca"); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 400); };
    const limpar = $("#mv-limpar");
    if (limpar) limpar.onclick = () => { filtroMov.produtoId = ""; recarregar(); };
    $("#mv-csv").onclick = () => baixarCsv(`movimentacoes_${new Date().toISOString().slice(0, 10)}.csv`, [
      ["Data", "Produto", "Variação", "Tipo", "Quantidade", "Antes", "Depois", "Motivo", "Observação", "Referência", "Usuário"],
      ...lista.map((m) => [new Date(m.criadoEm).toLocaleString("pt-BR"), m.produtoNome, m.variante || "", rotuloTipo(m.tipo)[0], m.qtd, m.antes, m.depois, m.motivo || "", m.obs || "", m.ref || "", m.por || ""]),
    ]);
  };
});
