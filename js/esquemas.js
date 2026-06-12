/**
 * esquemas.js — FONTE ÚNICA DA VERDADE dos dados por tipo de monitoramento
 * (seção 11.3 da especificação do eCamp)
 *
 * Papel deste módulo:
 *   Para cada tipo de monitoramento (ruido, sismo, qar, opacidade, qarint,
 *   outro), este arquivo guardará um ESQUEMA: a lista ordenada de
 *   `campo → coluna` daquele tipo. Esse esquema será usado por DOIS lados:
 *
 *   1. `montarLinhaPorTipo()` — para montar a linha de dados enviada à
 *      planilha `monitoramento.xlsx` (Fase 7, sincronização).
 *   2. A criação/garantia da aba correspondente na planilha, com a linha de
 *      cabeçalho idêntica, na primeira sincronização daquele tipo.
 *
 *   Como os dois lados leem do MESMO objeto, a planilha nasce exatamente no
 *   formato que o app envia — nunca há divergência entre o que o app grava
 *   e a estrutura da aba. O mesmo vale para `pre_campo.xlsx` (romaneio).
 *
 * REGRA: não espalhar definição de colunas pelo código. Toda mudança de
 * campo/coluna acontece SOMENTE aqui.
 *
 * Formato previsto de cada esquema (exemplo ilustrativo, ainda não em uso):
 *   ruido: {
 *     aba: 'Ruido',
 *     colunas: [
 *       { campo: 'os',          coluna: 'Nº OS' },
 *       { campo: 'cliente',     coluna: 'Cliente' },
 *       { campo: 'tecnico',     coluna: 'Técnico' },
 *       ...
 *     ]
 *   }
 *
 * Preenchimento por fase:
 *   Fase 2 — esquema de `ruido` (tipo piloto).
 *   Fase 4 — esquemas de `sismo`, `qar`, `opacidade`, `qarint` e `outro`.
 */
window.EC = window.EC || {};

EC.esquemas = {
  // ruido:     preenchido na Fase 2 (piloto)
  // sismo:     preenchido na Fase 4
  // qar:       preenchido na Fase 4
  // opacidade: preenchido na Fase 4
  // qarint:    preenchido na Fase 4
  // outro:     preenchido na Fase 4
};
