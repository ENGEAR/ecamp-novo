/**
 * biblioteca-dados.js — Manifesto da Biblioteca (normas e procedimentos).
 *
 * FONTE ÚNICA da lista de documentos. É lido em DOIS lugares:
 *   • pelo app (js/biblioteca.js) para montar a tela da Biblioteca;
 *   • pelo service worker, que pré-guarda cada PDF no cache → acesso OFFLINE.
 * Por isso ele se pendura em `self` (funciona tanto na janela quanto no SW),
 * e NÃO depende de window/EC.
 *
 * Para adicionar um documento:
 *   1) coloque o PDF na pasta  normas/
 *   2) adicione uma linha aqui no array (mantendo o modelo abaixo)
 *   3) bump da versão (VERSAO_CACHE no service-worker.js + VERSAO_APP no app.js)
 *
 * Campos de cada item:
 *   tipo    : 'norma' | 'procedimento'
 *   escopo  : 'Ruído' | 'Vibração' | 'QAR Externo' | 'Opacidade' |
 *             'QAR Interno' | 'Outro' | 'Geral'
 *   metodo  : texto livre (ex.: 'NBR 10151', 'Ferroviário', 'Opacímetro') — ''
 *             quando não se aplica
 *   titulo  : nome que aparece na lista
 *   arquivo : caminho relativo do PDF (ex.: 'normas/nbr-10151.pdf')
 *
 * Exemplo:
 *   { tipo: 'norma', escopo: 'Ruído', metodo: 'NBR 10151',
 *     titulo: 'ABNT NBR 10151:2019', arquivo: 'normas/nbr-10151.pdf' },
 */
self.ECAMP_BIBLIOTECA = [
  /* ===================== PROCEDIMENTOS (POPs) ===================== */
  // Ruído
  { tipo: 'procedimento', escopo: 'Ruído', metodo: 'NBR 10151', titulo: 'POP 001 — Ruído externo e interno (NBR 10151) — rev.07', arquivo: 'normas/procedimentos/proc_ruido_externo e interno (10151)_POP 001_rev07.pdf' },
  { tipo: 'procedimento', escopo: 'Ruído', metodo: 'NBR 10152', titulo: 'POP 004 — Ruído interno (NBR 10152) — rev.03', arquivo: 'normas/procedimentos/proc_ruido_interno (10152)_POP 004_rev03.pdf' },
  { tipo: 'procedimento', escopo: 'Ruído', metodo: 'Ferroviário e Aeronáutico', titulo: 'POP 015 — Ruído ferroviário e aeronáutico — rev.02', arquivo: 'normas/procedimentos/proc_ruido_ferroviario e aeronautico_POP 015_rev02.pdf' },
  // Vibração
  { tipo: 'procedimento', escopo: 'Vibração', metodo: 'NBR 9653', titulo: 'POP 002 — Sismografia (ABNT NBR 9653) — rev.07', arquivo: 'normas/procedimentos/proc_sismografia_ABNT 9653_POP 002_rev07.pdf' },
  { tipo: 'procedimento', escopo: 'Vibração', metodo: 'CETESB', titulo: 'POP 013 — Sismografia (CETESB) — rev.03', arquivo: 'normas/procedimentos/proc_sismografia_cetesb_POP 013_rev03.pdf' },
  // QAR Externo
  { tipo: 'procedimento', escopo: 'QAR Externo', metodo: 'PTS', titulo: 'POP 005 — PTS — rev.02', arquivo: 'normas/procedimentos/proc_qarext_PTS_POP 005_rev02.pdf' },
  { tipo: 'procedimento', escopo: 'QAR Externo', metodo: 'Partículas sedimentáveis', titulo: 'POP 006 — Partículas sedimentáveis — rev.03', arquivo: 'normas/procedimentos/proc_qarext_particulas sedimentaveis_POP 006_rev03.pdf' },
  { tipo: 'procedimento', escopo: 'QAR Externo', metodo: 'Poeira sedimentável', titulo: 'POP 010 — Poeira sedimentável — rev.01', arquivo: 'normas/procedimentos/proc_qarext_poeira sedimentável_POP 010_rev01.pdf' },
  { tipo: 'procedimento', escopo: 'QAR Externo', metodo: 'Gases (NO2 e SO2)', titulo: 'POP 009 — Gases (NO2 e SO2) — rev.01', arquivo: 'normas/procedimentos/proc_qarext_gases NO2 e SO2_POP 009_rev01.pdf' },
  { tipo: 'procedimento', escopo: 'QAR Externo', metodo: 'Analisador contínuo', titulo: 'POP 016 — Analisador contínuo — rev.00', arquivo: 'normas/procedimentos/proc_qarext_analisador continuo_POP 016_rev00.pdf' },
  { tipo: 'procedimento', escopo: 'QAR Externo', metodo: 'Calibração de vazão', titulo: 'POP 008 — Calibração de vazão (bolhômetro) — rev.00', arquivo: 'normas/procedimentos/proc_qarest_calibração vazão bolhametro_POP 008_rev00.pdf' },
  // QAR Interno
  { tipo: 'procedimento', escopo: 'QAR Interno', metodo: 'MQAI', titulo: 'POP 007 — Ar interno / MQAI — rev.02', arquivo: 'normas/procedimentos/proc_qarint_ambiente interno_POP 007_rev02.pdf' },
  // Opacidade
  { tipo: 'procedimento', escopo: 'Opacidade', metodo: 'Opacímetro', titulo: 'POP 014 — Fuligem (Opacímetro) — rev.00', arquivo: 'normas/procedimentos/proc_fuligem_opacimetro_POP 014_rev00.pdf' },
  { tipo: 'procedimento', escopo: 'Opacidade', metodo: 'Ringelmann', titulo: 'POP 003 — Fuligem (Ringelmann) — rev.04', arquivo: 'normas/procedimentos/proc_fuligem_ringelmann_POP 003_rev04.pdf' },
  // Geral
  { tipo: 'procedimento', escopo: 'Geral', metodo: '', titulo: 'POP 017 — Cadastros — rev.00', arquivo: 'normas/procedimentos/proc_geral_cadastros_POP017_rev00.pdf' },
  { tipo: 'procedimento', escopo: 'Geral', metodo: '', titulo: 'POP 012 — Normas de direção — rev.00', arquivo: 'normas/procedimentos/proc_geral_normas de direção_POP 012_rev00.pdf' },

  /* ===================== NORMAS ===================== */
  // (a incluir quando os PDFs das normas forem adicionados à pasta normas/)
];
