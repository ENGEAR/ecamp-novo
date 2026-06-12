/**
 * dados-os-mock.js — Lista de OS de EXEMPLO (mock) para a Fase 1
 *
 * A lista real de OS virá do SGE (seção 4.4 da especificação); a ponte de
 * leitura ainda será definida. Enquanto isso, o fluxo de serviços usa esta
 * lista fixa para desenvolver e testar.
 *
 * Interface (namespace global EC.osMock):
 *   EC.osMock → array de OS, cada uma com:
 *     numero     : nº da OS               (ex.: '2026-0158')
 *     cliente    : nome do cliente
 *     endereco   : endereço do local do serviço
 *     resumo     : resumo do serviço
 *     qtdePontos : quantidade de pontos prevista (o técnico pode editar na 1.2)
 *
 * Quando a ponte com o SGE existir (dependência externa nº 9 da especificação),
 * este arquivo será substituído pela leitura real — mantendo os mesmos campos.
 */
window.EC = window.EC || {};

EC.osMock = [
  {
    numero: '2026-0158',
    cliente: 'Mineração Alfa Ltda',
    endereco: 'Rodovia BR-040, km 12 — Sete Lagoas/MG',
    resumo: 'Monitoramento de ruído ambiental na divisa com área residencial (NBR 10151)',
    qtdePontos: 3
  },
  {
    numero: '2026-0163',
    cliente: 'Construtora Beta S.A.',
    endereco: 'Av. dos Andradas, 4500 — Belo Horizonte/MG',
    resumo: 'Sismografia de desmonte de rocha — obra de fundação (NBR 9653)',
    qtdePontos: 2
  },
  {
    numero: '2026-0171',
    cliente: 'Indústria Gama Alimentos',
    endereco: 'Distrito Industrial, Quadra 8 — Contagem/MG',
    resumo: 'Qualidade do ar externo — particulados PTS e PM10 no entorno da caldeira',
    qtdePontos: 4
  },
  {
    numero: '2026-0185',
    cliente: 'Hospital Delta',
    endereco: 'Rua das Acácias, 120 — Nova Lima/MG',
    resumo: 'Qualidade do ar interno (MQAI) — ambientes climatizados do bloco cirúrgico',
    qtdePontos: 5
  }
];
