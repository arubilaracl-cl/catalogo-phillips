// server.js
// Backend para el catálogo Phillips Safety, pensado para desplegar en Render.
//
// Qué hace:
// 1) Lee la planilla de precios de Phillips EN EL SERVIDOR (no en el navegador
//    del cliente) — esto evita por completo el problema de CORS que tuvimos
//    con la versión que corría solo en el navegador.
// 2) Expone /api/productos con el catálogo ya parseado (código, descripción,
//    precio USD, sección) para que el frontend solo tenga que mostrarlo.
// 3) Expone /api/tipo-cambio con el dólar observado del día (cacheado un rato
//    para no golpear la API del Banco Central en cada visita).
// 4) Sirve el catálogo (carpeta /public) como sitio estático.

const express = require('express');
const Papa = require('papaparse');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- configuración de la planilla ----------
// para agregar más categorías en el futuro, solo hay que sumar más
// entradas aquí con su nombre y su gid (se ve en la URL de cada pestaña)
const SHEET_ID = process.env.SHEET_ID || '1ItxD9POkojzWNQU1ULsji93V3dQ6n2FZHlmFWzeOwH4';
const PESTAÑAS = [
  { nombre: 'Radiation - Apparel', gid: '733320967' }
];

function urlCsv(gid){
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`;
}

function limpiaPrecio(s){
  if (!s) return null;
  const n = String(s).replace(/[^0-9.]/g, '');
  if (!n) return null;
  const v = parseFloat(n);
  return isNaN(v) ? null : v;
}

function parsearPestaña(filas, nombrePestaña){
  let idxHeader = -1;
  for (let i = 0; i < filas.length; i++){
    if (filas[i].some(c => /part number.*sku|sku/i.test(c || ''))){
      idxHeader = i;
      break;
    }
  }
  if (idxHeader === -1) return [];

  const header = filas[idxHeader];
  const idx = (regex) => header.findIndex(c => regex.test(c || ''));

  const colModelo = idx(/^model/i);
  const colSku = idx(/sku/i);
  const colDist2026 = header.findIndex(c => /distributor/i.test(c || '') && /2026/.test(c || ''));
  const colDist2025 = header.findIndex(c => /distributor/i.test(c || '') && /2025/.test(c || ''));
  const colDesc = idx(/^description/i);

  const items = [];
  let seccionActual = nombrePestaña;

  for (let i = idxHeader + 1; i < filas.length; i++){
    const fila = filas[i];
    if (!fila || fila.every(c => !c || !c.trim())) continue;

    const sku = colSku >= 0 ? (fila[colSku] || '').trim() : '';
    const desc = colDesc >= 0 ? (fila[colDesc] || '').trim() : '';

    if (!sku && desc && !(colDist2026 >= 0 && fila[colDist2026]) && !(colDist2025 >= 0 && fila[colDist2025])){
      seccionActual = desc;
      continue;
    }
    if (!sku) continue;

    const precio2026 = colDist2026 >= 0 ? limpiaPrecio(fila[colDist2026]) : null;
    const precio2025 = colDist2025 >= 0 ? limpiaPrecio(fila[colDist2025]) : null;
    const precioUsd = precio2026 != null ? precio2026 : precio2025;
    if (precioUsd == null) continue;

    items.push({
      seccion: seccionActual,
      sku,
      modelo: colModelo >= 0 ? (fila[colModelo] || '').trim() : '',
      descripcion: desc,
      precioUsd
    });
  }
  return items;
}

// ---------- caché en memoria (evita golpear Google/Banco Central en cada visita) ----------
let cacheProductos = { datos: null, timestamp: 0, avisos: [] };
const CACHE_MS_PRODUCTOS = 15 * 60 * 1000; // 15 minutos

let cacheTipoCambio = { valor: null, fecha: null, timestamp: 0 };
const CACHE_MS_TC = 6 * 60 * 60 * 1000; // 6 horas

async function cargarProductos(){
  const ahora = Date.now();
  if (cacheProductos.datos && (ahora - cacheProductos.timestamp) < CACHE_MS_PRODUCTOS){
    return cacheProductos;
  }

  let productos = [];
  const avisos = [];
  for (const pestaña of PESTAÑAS){
    try{
      const res = await fetch(urlCsv(pestaña.gid));
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const texto = await res.text();
      const filas = Papa.parse(texto, { skipEmptyLines: false }).data;
      productos = productos.concat(parsearPestaña(filas, pestaña.nombre));
    }catch(e){
      avisos.push(`No se pudo leer "${pestaña.nombre}": ${e.message}`);
    }
  }

  cacheProductos = { datos: productos, timestamp: ahora, avisos };
  return cacheProductos;
}

async function cargarTipoCambio(){
  const ahora = Date.now();
  if (cacheTipoCambio.valor && (ahora - cacheTipoCambio.timestamp) < CACHE_MS_TC){
    return cacheTipoCambio;
  }
  try{
    const res = await fetch('https://mindicador.cl/api/dolar');
    const data = await res.json();
    cacheTipoCambio = {
      valor: Math.round(data.serie[0].valor),
      fecha: data.serie[0].fecha.slice(0, 10),
      timestamp: ahora
    };
  }catch(e){
    console.error('Error obteniendo tipo de cambio:', e.message);
    if (!cacheTipoCambio.valor) cacheTipoCambio = { valor: 950, fecha: null, timestamp: ahora };
  }
  return cacheTipoCambio;
}

// ---------- rutas de la API ----------
app.get('/api/productos', async (req, res) => {
  try{
    const { datos, avisos } = await cargarProductos();
    res.json({ productos: datos, avisos });
  }catch(e){
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/tipo-cambio', async (req, res) => {
  try{
    const tc = await cargarTipoCambio();
    res.json(tc);
  }catch(e){
    res.status(500).json({ error: e.message });
  }
});

// fuerza recargar la planilla ahora mismo (ignora la caché), útil si Phillips
// acaba de actualizar un precio y no quieres esperar los 15 minutos
app.post('/api/productos/refrescar', async (req, res) => {
  cacheProductos.timestamp = 0;
  try{
    const { datos, avisos } = await cargarProductos();
    res.json({ productos: datos, avisos, refrescado: true });
  }catch(e){
    res.status(500).json({ error: e.message });
  }
});

// ---------- sitio estático (el catálogo) ----------
app.use(express.static('public'));

app.listen(PORT, () => {
  console.log(`Servidor Phillips escuchando en el puerto ${PORT}`);
});
