// Temporadas sazonais do jogo. Por enquanto só o Natal: fica ativo sozinho de 1/dez a 6/jan (Dia de Reis),
// cobrindo o período de festa inteiro mesmo virando o ano. XMAS_FORCE=1 força ligado a qualquer hora (testes).
function isXmasActive() {
  if (process.env.XMAS_FORCE === '1') return true;
  if (process.env.XMAS_FORCE === '0') return false;
  const d = new Date(), m = d.getMonth(), day = d.getDate(); // mês 0-indexado (11 = dezembro)
  return m === 11 || (m === 0 && day <= 6);
}

module.exports = { isXmasActive };
