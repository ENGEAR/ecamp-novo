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
  // (vazio — adicione os documentos aqui conforme o modelo acima)
];
