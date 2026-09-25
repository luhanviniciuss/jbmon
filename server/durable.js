// Gravações duráveis: nova tentativa em falhas transitórias do banco e, se ainda assim falhar,
// a operação fica numa fila em memória que é reenviada até dar certo (nunca é descartada).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pending = []; // { label, fn }

async function retry(fn, { tries = 5, delay = 150 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await sleep(delay * (i + 1));
    }
  }
  throw last;
}

// `fn` deve montar a operação do zero a cada chamada (ela pode ser repetida).
async function durable(label, fn) {
  try {
    return await retry(fn);
  } catch (e) {
    console.error(`[db] "${label}" falhou (${e.message}); reenfileirado para nova tentativa`);
    pending.push({ label, fn });
    return null;
  }
}

async function flushPending() {
  while (pending.length) {
    try {
      await retry(pending[0].fn, { tries: 3 });
      pending.shift();
    } catch {
      return false;
    }
  }
  return true;
}

setInterval(() => { if (pending.length) flushPending(); }, 5000).unref();

module.exports = { retry, durable, flushPending, pendingCount: () => pending.length };
