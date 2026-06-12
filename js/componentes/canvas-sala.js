/**
 * canvas-sala.js — Desenho do layout da sala (ruído interno)
 *
 * Canvas com barra de ferramentas para o técnico desenhar a planta da sala:
 * pontos de medição, paredes, móveis, portas/janelas, traço livre, textos,
 * borracha e limpar tudo. O desenho fica guardado como uma LISTA DE OBJETOS
 * (serializável no localStorage) e pode ser exportado como imagem (dataURL)
 * para o PDF na Fase 3.
 *
 * Interface (namespace global EC.canvasSala):
 *   EC.canvasSala.criar(container, opcoes) → instância
 *     container            : HTMLElement
 *     opcoes.dadosIniciais : { objetos: [...] } salvo anteriormente (opcional)
 *     opcoes.aoMudar       : callback (objetos) a cada alteração (opcional)
 *   instância.exportar() → { objetos, dataUrl }   — dataUrl = PNG do desenho
 *
 * Modos: ponto, parede H, parede V, sofá, cômoda, televisão, cama,
 * guarda-roupa, porta, janela, lápis, borracha, texto, limpar tudo.
 */
window.EC = window.EC || {};

EC.canvasSala = (function () {
  'use strict';

  const MOVEIS = {
    sofa: { rotulo: 'Sofá', l: 90, a: 38 },
    comoda: { rotulo: 'Cômoda', l: 70, a: 32 },
    tv: { rotulo: 'TV', l: 60, a: 24 },
    cama: { rotulo: 'Cama', l: 80, a: 56 },
    guardaroupa: { rotulo: 'Guarda-roupa', l: 84, a: 32 },
    porta: { rotulo: 'Porta', l: 52, a: 16 },
    janela: { rotulo: 'Janela', l: 64, a: 14 }
  };

  const FERRAMENTAS = [
    { modo: 'ponto', rotulo: '📍 Ponto' },
    { modo: 'paredeH', rotulo: '▬ Parede H' },
    { modo: 'paredeV', rotulo: '▮ Parede V' },
    { modo: 'sofa', rotulo: '🛋️ Sofá' },
    { modo: 'comoda', rotulo: '🗄️ Cômoda' },
    { modo: 'tv', rotulo: '📺 Televisão' },
    { modo: 'cama', rotulo: '🛏️ Cama' },
    { modo: 'guardaroupa', rotulo: '👕 Guarda-roupa' },
    { modo: 'porta', rotulo: '🚪 Porta' },
    { modo: 'janela', rotulo: '🪟 Janela' },
    { modo: 'lapis', rotulo: '✏️ Lápis' },
    { modo: 'texto', rotulo: '🔤 Texto' },
    { modo: 'borracha', rotulo: '🧽 Borracha' }
  ];

  function criar(container, opcoes) {
    opcoes = opcoes || {};
    let objetos = (opcoes.dadosIniciais && opcoes.dadosIniciais.objetos) || [];
    let modo = 'ponto';
    let tracoAtual = null; // traço do lápis em andamento

    container.innerHTML =
      '<div class="comp-canvas-sala">' +
      '  <div class="canvas-barra">' +
      FERRAMENTAS.map(function (f) {
        return '<button type="button" class="canvas-ferramenta" data-modo="' + f.modo + '">' + f.rotulo + '</button>';
      }).join('') +
      '    <button type="button" class="canvas-ferramenta canvas-limpar">🗑️ Limpar tudo</button>' +
      '  </div>' +
      '  <canvas class="canvas-desenho" height="320"></canvas>' +
      '  <p class="texto-apoio canvas-dica">Escolha uma ferramenta e toque no desenho para inserir. Borracha: toque no item para apagar.</p>' +
      '</div>';

    const canvas = container.querySelector('.canvas-desenho');
    const ctx = canvas.getContext('2d');

    function ajustarLargura() {
      canvas.width = Math.max(300, canvas.parentElement.clientWidth - 2);
      redesenhar();
    }

    function marcarFerramentaAtiva() {
      container.querySelectorAll('.canvas-ferramenta').forEach(function (botao) {
        botao.classList.toggle('canvas-ferramenta-ativa', botao.dataset.modo === modo);
      });
    }

    container.querySelectorAll('.canvas-ferramenta[data-modo]').forEach(function (botao) {
      botao.addEventListener('click', function () {
        modo = botao.dataset.modo;
        marcarFerramentaAtiva();
      });
    });

    container.querySelector('.canvas-limpar').addEventListener('click', function () {
      if (objetos.length && !confirm('Apagar todo o desenho da sala?')) return;
      objetos = [];
      mudou();
    });

    function posicao(evento) {
      const r = canvas.getBoundingClientRect();
      const fonte = evento.touches ? evento.touches[0] : evento;
      // largura/altura 0 (tela em transição) viraria divisão por zero
      const escalaX = r.width > 0 ? canvas.width / r.width : 1;
      const escalaY = r.height > 0 ? canvas.height / r.height : 1;
      return {
        x: Math.round((fonte.clientX - r.left) * escalaX),
        y: Math.round((fonte.clientY - r.top) * escalaY)
      };
    }

    function caixaDoObjeto(o) {
      if (o.t === 'ponto') return { x: o.x - 14, y: o.y - 14, l: 28, a: 28 };
      if (o.t === 'paredeH') return { x: o.x - 45, y: o.y - 5, l: 90, a: 10 };
      if (o.t === 'paredeV') return { x: o.x - 5, y: o.y - 45, l: 10, a: 90 };
      if (o.t === 'movel') { const m = MOVEIS[o.sub]; return { x: o.x - m.l / 2, y: o.y - m.a / 2, l: m.l, a: m.a }; }
      if (o.t === 'texto') return { x: o.x - 4, y: o.y - 14, l: Math.max(40, (o.txt || '').length * 8), a: 20 };
      return null; // lápis tratado à parte
    }

    function apagarEm(p) {
      for (let i = objetos.length - 1; i >= 0; i--) {
        const o = objetos[i];
        if (o.t === 'lapis') {
          const perto = o.pts.some(function (pt) { return Math.abs(pt[0] - p.x) < 12 && Math.abs(pt[1] - p.y) < 12; });
          if (perto) { objetos.splice(i, 1); return true; }
        } else {
          const c = caixaDoObjeto(o);
          if (c && p.x >= c.x && p.x <= c.x + c.l && p.y >= c.y && p.y <= c.y + c.a) {
            objetos.splice(i, 1);
            return true;
          }
        }
      }
      return false;
    }

    function aoTocar(evento) {
      evento.preventDefault();
      const p = posicao(evento);

      if (modo === 'lapis') {
        tracoAtual = { t: 'lapis', pts: [[p.x, p.y]] };
        objetos.push(tracoAtual);
        redesenhar();
        return;
      }
      if (modo === 'borracha') {
        if (apagarEm(p)) mudou();
        return;
      }
      if (modo === 'texto') {
        const txt = prompt('Texto a inserir no desenho:');
        if (txt) { objetos.push({ t: 'texto', x: p.x, y: p.y, txt: txt }); mudou(); }
        return;
      }
      if (modo === 'ponto') {
        objetos.push({ t: 'ponto', x: p.x, y: p.y });
        mudou();
        return;
      }
      if (modo === 'paredeH' || modo === 'paredeV') {
        objetos.push({ t: modo, x: p.x, y: p.y });
        mudou();
        return;
      }
      if (MOVEIS[modo]) {
        objetos.push({ t: 'movel', sub: modo, x: p.x, y: p.y });
        mudou();
      }
    }

    function aoArrastar(evento) {
      if (!tracoAtual) return;
      evento.preventDefault();
      const p = posicao(evento);
      tracoAtual.pts.push([p.x, p.y]);
      redesenhar();
    }

    function aoSoltar() {
      if (tracoAtual) { tracoAtual = null; mudou(); }
    }

    canvas.addEventListener('mousedown', aoTocar);
    canvas.addEventListener('mousemove', aoArrastar);
    window.addEventListener('mouseup', aoSoltar);
    canvas.addEventListener('touchstart', aoTocar, { passive: false });
    canvas.addEventListener('touchmove', aoArrastar, { passive: false });
    canvas.addEventListener('touchend', aoSoltar);

    function redesenhar() {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = '#d7dce5';
      ctx.strokeRect(0, 0, canvas.width, canvas.height);

      let numeroPonto = 0;
      objetos.forEach(function (o) {
        if (o.t === 'ponto') {
          numeroPonto++;
          ctx.fillStyle = '#16276e';
          ctx.beginPath();
          ctx.arc(o.x, o.y, 12, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 11px Arial';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('P' + numeroPonto, o.x, o.y);
        } else if (o.t === 'paredeH' || o.t === 'paredeV') {
          ctx.fillStyle = '#5b6470';
          if (o.t === 'paredeH') ctx.fillRect(o.x - 45, o.y - 3, 90, 6);
          else ctx.fillRect(o.x - 3, o.y - 45, 6, 90);
        } else if (o.t === 'movel') {
          const m = MOVEIS[o.sub];
          ctx.fillStyle = '#e8f3fb';
          ctx.strokeStyle = '#2d9cdb';
          ctx.fillRect(o.x - m.l / 2, o.y - m.a / 2, m.l, m.a);
          ctx.strokeRect(o.x - m.l / 2, o.y - m.a / 2, m.l, m.a);
          ctx.fillStyle = '#16276e';
          ctx.font = '10px Arial';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(m.rotulo, o.x, o.y);
        } else if (o.t === 'lapis') {
          ctx.strokeStyle = '#1d2330';
          ctx.lineWidth = 2;
          ctx.beginPath();
          o.pts.forEach(function (pt, i) {
            if (i === 0) ctx.moveTo(pt[0], pt[1]);
            else ctx.lineTo(pt[0], pt[1]);
          });
          ctx.stroke();
          ctx.lineWidth = 1;
        } else if (o.t === 'texto') {
          ctx.fillStyle = '#1d2330';
          ctx.font = '13px Arial';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'alphabetic';
          ctx.fillText(o.txt, o.x, o.y);
        }
      });
    }

    function mudou() {
      redesenhar();
      if (typeof opcoes.aoMudar === 'function') opcoes.aoMudar(objetos);
    }

    ajustarLargura();
    marcarFerramentaAtiva();

    return {
      exportar: function () {
        redesenhar();
        return { objetos: objetos, dataUrl: canvas.toDataURL('image/png') };
      }
    };
  }

  return { criar: criar };
})();
