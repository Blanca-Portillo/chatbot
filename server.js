const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 3000);
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'cambia_este_token';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const APP_SECRET = process.env.APP_SECRET;
const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

fs.mkdirSync(DATA_DIR, { recursive: true });

function defaultState() {
  return {
    profit: 542.5,
    lastLatencyMs: 0,
    catalog: {
      arroz: { name: 'Arroz blanco', unit: 'bolsas', buyPrice: 0.82, salePrice: 1.25, stock: 6, max: 24 },
      aceite: { name: 'Aceite', unit: 'botellas', buyPrice: 1.55, salePrice: 2.25, stock: 2, max: 16 },
      frijol: { name: 'Frijol rojo', unit: 'libras', buyPrice: 0.72, salePrice: 1.10, stock: 12, max: 40 },
      sodas: { name: 'Sodas en lata', unit: 'unidades', buyPrice: 0.55, salePrice: 0.85, stock: 7, max: 30 }
    },
    stock: {},
    subscriptions: [],
    transactions: [
      { id: 1, type: 'resumen', title: 'Estado inicial del negocio', detail: 'Ganancia base $542.50 cargada', time: 'Inicio' }
    ],
    messages: [
      { from: 'bot', text: 'Listo chele. Escribe o dicta una venta o ingreso de mercadería para guardar en el PMV.' }
    ]
  };
}

function loadState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return defaultState();
    return { ...defaultState(), ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) };
  } catch (error) {
    return defaultState();
  }
}

let state = loadState();

function saveState() {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function normalize(text) {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseItems(text) {
  const lower = normalize(text);
  const found = [];
  Object.entries(state.catalog).sort((a, b) => b[1].name.length - a[1].name.length).forEach(([key, item]) => {
    const name = normalize(item.name);
    if (!name) return;

    const aliases = [name, name.split(' ')[0], key];
    let quantity = 0;
    let matched = false;

    aliases.forEach(alias => {
      if (matched || !alias) return;
      const escapedName = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (!new RegExp(`(^|\\b)${escapedName}(es|s)?(\\b|$)`).test(lower)) return;
      matched = true;
      const before = lower.match(new RegExp(`(\\d+)\\s+(?:[a-z]+\\s+){0,3}${escapedName}(?:es|s)?\\b`));
      const after = lower.match(new RegExp(`${escapedName}(?:es|s)?\\b\\s*(?:de\\s+)?(\\d+)`));
      quantity = before ? Number(before[1]) : after ? Number(after[1]) : 1;
    });

    if (quantity > 0) found.push({ key, quantity });
  });
  return found;
}

function processCommand(rawText) {
  const started = Date.now();
  const text = String(rawText).trim();
  const lower = normalize(text);
  const restock = /\b(entraron|compre|compraron|trajo|trajeron|llegaron|ingresaron|ingreso|sumar|agreguen|agregar)\b/.test(lower);
  const query = /\b(cuanto|ganado|balance|semana|resumen)\b/.test(lower);
  const items = parseItems(text);
  let reply;
  let txType = 'consulta';
  let txTitle = text;
  let txDetail = '';

  if (query && items.length === 0) {
    reply = `Tu ganancia acumulada actual es de $${state.profit.toFixed(2)} y tienes ${state.transactions.length} movimientos guardados.`;
    txDetail = `Balance consultado: $${state.profit.toFixed(2)}`;
  } else if (items.length) {
    if (restock) {
      const parts = [];
      let cost = 0;
      items.forEach(({ key, quantity }) => {
        const item = state.catalog[key];
        item.stock = (item.stock || 0) + quantity;
        const itemCost = Number((quantity * item.buyPrice).toFixed(2));
        cost += itemCost;
        parts.push(`+${quantity} ${item.name.toLowerCase()}`);
      });
      state.profit = Math.max(0, Number((state.profit - cost).toFixed(2)));
      reply = `Mercadería sumada: ${parts.join(', ')} (costo -$${cost.toFixed(2)}). Inventario guardado.`;
      txType = 'compra';
      txTitle = `Ingreso: ${parts.join(', ')}`;
      txDetail = `Costo mercadería: -$${cost.toFixed(2)}`;
    } else {
      const parts = [];
      let total = 0;
      let grossProfit = 0;
      items.forEach(({ key, quantity }) => {
        const item = state.catalog[key];
        const actual = Math.min(quantity, item.stock || 0);
        item.stock = Math.max(0, (item.stock || 0) - quantity);
        const subtotal = Number((actual * item.salePrice).toFixed(2));
        grossProfit += Number((actual * (item.salePrice - item.buyPrice)).toFixed(2));
        total += subtotal;
        parts.push(`${actual}x ${item.name} ($${subtotal.toFixed(2)})`);
      });
      state.profit = Number((state.profit + grossProfit).toFixed(2));
      const low = Object.values(state.catalog).filter(item => item.stock <= 3).map(item => `${item.name} (${item.stock})`);
      reply = `Anotado: ${parts.join(' y ')}. Total: $${total.toFixed(2)}.${low.length ? ` Stock bajo: ${low.join(', ')}.` : ''}`;
      txType = 'venta';
      txTitle = `Venta: ${parts.join(', ')}`;
      txDetail = `Ingreso: +$${total.toFixed(2)}`;
    }
  } else {
    reply = 'No detecté el producto con una cantidad. Prueba: "Vendí 2 arroces" o "Entraron 10 frijoles".';
    txType = 'nota';
    txDetail = 'Mensaje registrado sin cambio de stock';
  }

  state.lastLatencyMs = Math.max(1, Date.now() - started);
  state.messages.push({ from: 'me', text });
  state.messages.push({ from: 'bot', text: reply });
  state.messages = state.messages.slice(-14);
  state.transactions.unshift({
    id: Date.now(),
    type: txType,
    title: txTitle,
    detail: txDetail,
    time: new Date().toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' })
  });
  state.transactions = state.transactions.slice(0, 30);
  saveState();
  return { reply, state };
}

async function sendWhatsAppText(to, text) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    console.warn('WhatsApp no configurado: faltan WHATSAPP_TOKEN o PHONE_NUMBER_ID');
    return;
  }
  const response = await fetch(`https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: false, body: text }
    })
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`WhatsApp API ${response.status}: ${detail}`);
  }
}

function verifySignature(rawBody, signature) {
  if (!APP_SECRET) return true;
  if (!signature) return false;
  const crypto = require('crypto');
  const expected = `sha256=${crypto.createHmac('sha256', APP_SECRET).update(rawBody).digest('hex')}`;
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);
  return expectedBuffer.length === signatureBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      try {
        resolve({ raw, parsed: JSON.parse(raw.toString('utf8') || '{}') });
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

const publicTypes = new Set(['.html', '.css', '.js', '.json', '.png', '.jpg', '.jpeg', '.svg', '.ico']);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/api/health') {
      sendJson(res, 200, {
        status: 'ok',
        whatsappConfigured: Boolean(WHATSAPP_TOKEN && PHONE_NUMBER_ID),
        uptimeSeconds: Math.floor(process.uptime())
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/webhook') {
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge');
      if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(challenge || '');
      } else {
        sendJson(res, 403, { error: 'Verificación rechazada' });
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/webhook') {
      const body = await readJson(req);
      if (!verifySignature(body.raw, req.headers['x-hub-signature-256'])) {
        sendJson(res, 403, { error: 'Firma inválida' });
        return;
      }
      const payload = body.parsed;
      res.writeHead(200);
      res.end('EVENT_RECEIVED');

      for (const entry of payload.entry || []) {
        for (const change of entry.changes || []) {
          const value = change.value || {};
          for (const message of value.messages || []) {
            const to = message.from;
            let text = '';
            if (message.type === 'text') text = message.text && message.text.body;
            if (message.type === 'audio' || message.type === 'voice') {
              text = '';
            }
            try {
              if (!text) {
                await sendWhatsAppText(to, 'Recibí tu audio. Por ahora escríbeme el movimiento, por ejemplo: "Vendí 2 arroces".');
                continue;
              }
              const result = processCommand(text);
              await sendWhatsAppText(to, result.reply);
            } catch (error) {
              console.error('No se pudo responder al webhook de WhatsApp:', error);
            }
          }
        }
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/state') {
      sendJson(res, 200, state);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/state') {
      const body = await readJson(req);
      if (!body.parsed || typeof body.parsed !== 'object') {
        sendJson(res, 400, { error: 'Estado inválido' });
        return;
      }
      state = { ...defaultState(), ...body.parsed };
      saveState();
      sendJson(res, 200, state);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/chat') {
      const body = await readJson(req);
      const text = String(body.parsed.text || '').trim();
      if (!text || text.length > 500) {
        sendJson(res, 400, { error: 'El mensaje debe tener entre 1 y 500 caracteres' });
        return;
      }
      sendJson(res, 200, processCommand(text));
      return;
    }

    let filePath = url.pathname === '/' ? path.join(__dirname, 'index.html') : path.resolve(__dirname, '.' + decodeURIComponent(url.pathname));
    if (filePath !== path.join(__dirname, 'index.html') && !filePath.startsWith(__dirname + path.sep)) {
      sendJson(res, 403, { error: 'Ruta inválida' });
      return;
    }
    fs.stat(filePath, (error, stats) => {
      if (error || !stats.isFile()) {
        sendJson(res, 404, { error: 'No encontrado' });
        return;
      }
      res.writeHead(200, { 'Content-Type': `${getContentType(filePath)}; charset=utf-8` });
      fs.createReadStream(filePath).pipe(res);
    });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: 'Error interno del servidor' });
  }
});

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (publicTypes.has(ext)) {
    return ext === '.html' ? 'text/html' : ext === '.css' ? 'text/css' : ext === '.js' ? 'application/javascript' : ext === '.json' ? 'application/json' : ext === '.svg' ? 'image/svg+xml' : 'application/octet-stream';
  }
  return 'application/octet-stream';
}

server.listen(PORT, () => {
  console.log(`Mi Negocio corriendo en http://localhost:${PORT}`);
  console.log('Webhook: /webhook');
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) console.warn('Faltan WHATSAPP_TOKEN y PHONE_NUMBER_ID en las variables de entorno');
});
