/**
 * dados-os-mock.js — Lista de OS de EXEMPLO (mock) para desenvolvimento
 *
 * A lista real virá do SGE (seção 4.4 da especificação); a ponte de leitura
 * ainda será definida. Enquanto isso, o fluxo de serviços usa esta lista fixa.
 *
 * Os campos espelham o modelo de OS da ENGEAR (seção "Descrição do serviço,
 * metodologia e valor da logística"):
 *
 * Interface (namespace global EC.osMock):
 *   EC.osMock → array de OS, cada uma com:
 *     numero      : nº da OS               (ex.: '2026-0158')
 *     cliente     : nome do cliente
 *     endereco    : endereço do local do serviço
 *     resumo      : resumo do serviço (texto curto)
 *     escopo      : escopo/norma do serviço (ex.: 'Ruído Ambiental – NBR 10151')
 *     qtdePontos  : quantidade de pontos prevista (o técnico pode editar)
 *     metodo      : metodologia + procedimento interno (norma e POP)
 *     periodo     : período previsto (datas / dias de medição / campanhas)
 *     observacao  : observações da OS
 *
 * Quando a ponte com o SGE existir, este arquivo será substituído pela
 * leitura real — mantendo os mesmos campos.
 */
window.EC = window.EC || {};

EC.osMock = [
  {
    numero: '2026-0158',
    cliente: 'Mineração Alfa Ltda',
    endereco: 'Rodovia BR-040, km 12 — Sete Lagoas/MG',
    resumo: 'Monitoramento de ruído ambiental na divisa com área residencial',
    escopo: 'Ruído Ambiental – NBR 10151',
    qtdePontos: 3,
    metodo: 'ABNT NBR 10151:2019 · Procedimento interno: POP 001',
    periodo: 'Campanha única — 1 dia de medição (período diurno e noturno)',
    observacao: 'Acesso pela portaria principal; avisar a segurança na chegada.'
  },
  {
    numero: '2026-0163',
    cliente: 'Construtora Beta S.A.',
    endereco: 'Av. dos Andradas, 4500 — Belo Horizonte/MG',
    resumo: 'Sismografia de desmonte de rocha — obra de fundação',
    escopo: 'Sismografia – NBR 9653',
    qtdePontos: 2,
    metodo: 'ABNT NBR 9653:2018 · Procedimento interno: POP 002',
    periodo: 'Campanha 1 — 1 dia | Campanha 2 — 1 dia',
    observacao: 'Confirmar horário do desmonte com o responsável da obra.'
  },
  {
    numero: '2026-0171',
    cliente: 'Indústria Gama Alimentos',
    endereco: 'Distrito Industrial, Quadra 8 — Contagem/MG',
    resumo: 'Qualidade do ar externo — particulados no entorno da caldeira',
    escopo: 'Qualidade do Ar Externo – PTS e PM10',
    qtdePontos: 4,
    metodo: 'ABNT NBR 9547 / NBR 13412 · Procedimento interno: POP 010',
    periodo: 'Campanha única — 4 dias de amostragem (24 h por ponto)',
    observacao: 'Local de instalação com tomada confirmada; levar cabo de extensão.'
  },
  {
    numero: '2026-0185',
    cliente: 'Hospital Delta',
    endereco: 'Rua das Acácias, 120 — Nova Lima/MG',
    resumo: 'Qualidade do ar interno (MQAI) — bloco cirúrgico',
    escopo: 'Qualidade do Ar Interno – MQAI (RE 09/2003 ANVISA)',
    qtdePontos: 5,
    metodo: 'RE ANVISA 09/2003 · Procedimento interno: POP 015',
    periodo: 'Campanha única — 1 dia (ambientes climatizados)',
    observacao: 'Coleta microbiológica; logística de retorno das amostras ao laboratório no mesmo dia.'
  }
];
