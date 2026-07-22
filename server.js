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

// ---------- traducciones al español ----------
// Se traduce por SKU (más confiable que traducir texto libre automáticamente).
// Al agregar categorías nuevas, hay que sumar sus traducciones aquí también.
const TRADUCCION_SECCION = {
  'QUICKSHIP LEAD APRONS': 'Delantales plomados Quickship',
  'CUSTOM LEAD APRONS': 'Delantales plomados a medida',
  'LEAD APRONS & WEARABLES ACCESSORIES': 'Accesorios para delantales y vestimenta plomada',
  'GONAD/OVARIAN SHIELDS': 'Protectores gonadales/ováricos',
  'THYROID SHIELDS': 'Protectores tiroideos',
  'RADIATION HATS': 'Gorros de radioprotección',
  'LEAD BLANKETS': 'Mantas plomadas',
  'DISPOSABLE RADIATION APPAREL': 'Vestimenta de radioprotección desechable'
};

const TRADUCCION_SKU = {
  'QS-RA-FFA-LF50-M-NYBK': 'Delantal plomado Quickship Flexiback frontal, 0.50mm Pb Eq, Axion Core 2000, Talla M, Nylon Negro',
  'QS-RA-FFA-LL50-M-RIPBL': 'Delantal plomado Quickship Flexiback frontal, 0.50mm Pb Eq, Plomo Liviano, Talla M, Ripstop Azul',
  'QS-RA-VSA-LL50-XL-NYBL': 'Delantal plomado Quickship chaleco y falda (traslape completo), 0.50mm Pb Eq, Plomo Liviano, Talla XL, Nylon Azul',
  'QS-RA-LGHA-LL50-M-NYBK': 'Medio delantal plomado Quickship tipo Lapguard, 0.50mm Pb Eq, Plomo Liviano, Talla M, Nylon Negro',
  'QS-RA-LGHA-LF50-L-RIPBL': 'Medio delantal plomado Quickship tipo Lapguard, 0.50mm Pb Eq, Axion Core 2000, Talla L, Ripstop Azul',
  'QS-RA-TF-LL50-S-NYBL': 'Delantal plomado Quickship con amarre frontal, 0.50mm Pb Eq, Plomo Liviano, Talla S, Nylon Azul',
  'QS-RA-DENT-LL25-A-NYBL': 'Delantal dental plomado Quickship, 0.25mm Pb Eq, Plomo Liviano, Talla adulto, Nylon Azul',
  'QS-RA-DENT-ELF25-A-RIPBL': 'Delantal dental plomado Quickship, 0.25mm Pb Eq, Axion Core 1000, Talla adulto, Ripstop Azul',

  'RA-FFA-PLF50': 'Delantal Flexiback a medida con cierre de velcro, Axion Core 3000, 0.50mm Pb, Nylon, Talla personalizada, Azul rey',
  'RA-FFAB-PLF50': 'Delantal Flexiback a medida con cierre de hebilla, Axion Core 3000, 0.50mm Pb, Nylon, Talla M, Negro',
  'RA-FFAB-BACK-PLF50': 'Delantal Flexiback a medida con soporte lumbar, Axion Core 3000, 0.50mm Pb, Nylon, Talla S, Negro',
  'RA-TF-LF50': 'Delantal a medida con amarre frontal, Axion Core 2000, 0.50mm Pb, Nylon, Talla M, Negro',
  'RA-J1P-PLF50': 'Chaqueta a medida de una pieza, Axion Core 3000, 0.50mm Pb, Ripstop, Talla personalizada, Azul rey',
  'RA-RJ1P-PLF50': 'Chaqueta reversible a medida de una pieza, Axion Core 3000, 0.50mm Pb, Ripstop, Talla M, Negro',
  'RA-PRJ1P-LF50': 'Chaqueta reversible para embarazo a medida (una pieza), Axion Core 2000, 0.50mm Pb, Nylon, Talla M, Azul rey',
  'RA-SDF-LL50': 'Cortina quirúrgica a medida, Plomo Liviano, 0.50mm Pb, Nylon, Talla M, Negro',
  'RA-VSA-PLF50': 'Chaleco y falda a medida, Axion Core 3000, 0.50mm Pb, Nylon, Talla personalizada, Azul rey',
  'RA-RVSA-PLF50': 'Chaleco y falda reversible a medida, Axion Core 3000, 0.50mm Pb, Nylon, Talla M, Dorado',
  'RA-LGHA-LF50': 'Medio delantal tipo LapGuard a medida, Axion Core 2000, 0.50mm Pb, Nylon, Talla S, Gris carbón',
  'RA-MP-LF50': 'Panel de maternidad a medida, Axion Core 2000, 0.50mm Pb, Nylon, Talla única, Negro',
  'RA-DENT-LL25': 'Delantal dental a medida, Plomo Liviano, 0.25mm Pb, Nylon, Talla única, Negro',

  'RA-SLEEVE-PLF50': 'Manga protectora a medida, Axion Core 3000, 0.50mm Pb, Nylon, Talla personalizada, Estampado salpicado',
  'RA-SHIN-LL25': 'Protector de espinilla a medida, Plomo Liviano, 0.25mm Pb, Nylon, Talla S, Naranja fluorescente',
  'RA-SHIN-FT-LL25': 'Protector de espinilla con cubre-pie a medida, Plomo Liviano, 0.25mm Pb, Nylon, Talla M, Negro',
  'RA-BAG-CUST': 'Bolso de transporte a medida para delantal plomado, Nylon, Negro',
  'QS-RA-BAG-BK': 'Bolso de transporte Quickship para delantal plomado, Nylon, Negro',
  'RA-DSBG-LF50': 'Porta-credencial / dosímetro de rayos X',
  'PS-RGLDSS-BL': 'Protectores laterales de radioprotección universales, juego de 2, Azul',
  'RM-OP-0.5': 'Protección de mano radiológica veterinaria — Manopla de palma abierta',
  'RA-BELT-S': 'Cinturón lumbar, Talla S',
  'RA-SUSP': 'Par de tirantes desmontables para delantales',

  'RA-GOS-SET-LL50': 'Juego de protectores gonadales/ováricos a medida, Plomo Liviano, 0.50mm Pb, Nylon, Juego de 3 (S, M, L), Negro',
  'RA-PGOS-LL25': 'Protector gonadal/ovárico pediátrico a medida, Plomo Liviano, 0.25mm Pb, Nylon, Pediátrico, Negro',
  'GOS-DPR-LL50': 'Pañal gonadal/ovárico a medida, Plomo Liviano, 0.50mm Pb, Nylon, Talla M, Negro',
  'QS-GOS-Blue-3pcs': 'Protector gonadal/ovárico Quickship, Azul, Plomo Liviano, Juego de 3 (S, M, L), Nylon, Azul',
  'GOS-LF25-NICU-PACK5': 'Protectores gonadales desechables para UCIN, Gris, Axion Core 2000, Paquete de 5 (chico), Desechable Gris',

  'RA-TS-ELF50': 'Protector tiroideo a medida, Axion Core 1000, 0.50mm Pb, Nylon, Talla L, Dorado',
  'RA-TS-BIB-ELF50': 'Protector tiroideo tipo babero, Axion Core 1000, 0.50mm Pb, Nylon',
  'RA-TS-U-LL50': 'Protector tiroideo tipo U, Plomo Liviano, 0.50mm Pb, Nylon',
  'RA-TS-VISOR-ELF25': 'Protector tiroideo tipo visera, Axion Core 1000, 0.25mm Pb, Nylon',
  'QS-TS-ELF50-NYBK': 'Protector tiroideo Quickship, Axion Core 1000, 0.50mm Pb, Nylon',
  'QS-TS-ELF50-RIPBL': 'Protector tiroideo Quickship, Axion Core 1000, 0.50mm Pb, Ripstop',

  'RA-RH-ELF50': 'Gorro radiológico a medida con velcro, Axion Core 1000, 0.50mm Pb, Nylon, Talla M, Calaveras decoradas',
  'QS-RH-ELF50-NYBK': 'Gorro radiológico Quickship con velcro, Nylon, Axion Core 1000, Talla única, Negro',
  'QS-RPC-LL50-NYBL': 'Gorro protector radiológico Quickship, Nylon, Plomo Liviano, Talla única, Azul',

  'RDA-BLNKT-LF50-BL-12x18': 'Manta plomada cosida, 12" x 18"',
  'RADG-BLNKT-LF50-BL-24x48': 'Manta libre de plomo Radgenic®, 24" x 48"',
  'RADG-HA-LL50-BL-XS': 'Medio delantal libre de plomo Radgenic® — Pediátrico, 10" x 10"',

  'AT-CAP-05': 'Gorro desechable, Axion Core 2000, Talla única, Azul — Caja de 5',
  'AT-TC-10': 'Cubre-tiroides desechable (paquete de 10)',
  'TS-DS-LF50-M': 'Collar tiroideo desechable (paquete de 10) — Talla M',
  'RRG-6.5': 'Guantes de protección radiológica SAFEGRIP — Talla 6.5',
  'RRG-FREE160-BOX': 'Guantes quirúrgicos atenuadores de radiación FREE1 FREEGUARD 6.0 — Caja (5 pares)',
  'RRG-FREE260-BOX': 'Guantes quirúrgicos atenuadores de radiación FREE2 FREEGUARD 6.0 — Caja (5 pares)',
  'RRG-XGRD-RR160-BOX': 'Guantes quirúrgicos de goma RR1 XGUARD 6.0 — Caja (5 pares)',
  'RRG-XGRD-RR260-BOX': 'Guantes quirúrgicos de goma RR2 XGUARD 6.0 — Caja (5 pares)',
  'RRG-XGRD-RR370-BOX': 'Guantes quirúrgicos de goma RR3 XGUARD 7.0 — Caja (3 pares)',
  'SLEEVE-XGRD-S-BOX': 'Manga quirúrgica de goma XGUARD, Talla S — Caja (3 pares)'
};

function traducir(sku, seccion, descripcionOriginal){
  return {
    descripcion: TRADUCCION_SKU[sku] || descripcionOriginal,
    seccion: TRADUCCION_SECCION[seccion] || seccion
  };
}

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

    const t = traducir(sku, seccionActual, desc);

    items.push({
      seccion: t.seccion,
      sku,
      modelo: colModelo >= 0 ? (fila[colModelo] || '').trim() : '',
      descripcion: t.descripcion,
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
// ---------- configuración comercial (privada — nunca se envía al navegador del cliente) ----------
// El servidor calcula Neto/IVA/Total y solo entrega esos montos ya listos;
// el margen y el factor de importación quedan solo en el servidor.
// Para cambiarlos: variables de entorno en Render (Settings -> Environment)
// MARGEN_DEFAULT y FACTOR_IMPORTACION_DEFAULT, o edita los valores por defecto aquí.
const MARGEN_DEFAULT = parseFloat(process.env.MARGEN_DEFAULT) || 40;
const FACTOR_IMPORTACION_DEFAULT = parseFloat(process.env.FACTOR_IMPORTACION_DEFAULT) || 35;

function calcularPrecio(precioUsd, tipoCambio){
  const costoBodegaUsd = precioUsd * (1 + FACTOR_IMPORTACION_DEFAULT / 100);
  const costoBodegaClp = costoBodegaUsd * tipoCambio;
  const neto = Math.round(costoBodegaClp / (1 - MARGEN_DEFAULT / 100));
  const iva = Math.round(neto * 0.19);
  const total = neto + iva;
  return { neto, iva, total };
}

app.get('/api/productos', async (req, res) => {
  try{
    const { datos, avisos } = await cargarProductos();
    const tc = await cargarTipoCambio();
    const productosConPrecio = datos.map(p => {
      const precios = calcularPrecio(p.precioUsd, tc.valor);
      return {
        seccion: p.seccion,
        sku: p.sku,
        modelo: p.modelo,
        descripcion: p.descripcion,
        neto: precios.neto,
        iva: precios.iva,
        total: precios.total
      };
    });
    res.json({ productos: productosConPrecio, avisos });
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
    const tc = await cargarTipoCambio();
    const productosConPrecio = datos.map(p => {
      const precios = calcularPrecio(p.precioUsd, tc.valor);
      return { seccion: p.seccion, sku: p.sku, modelo: p.modelo, descripcion: p.descripcion, neto: precios.neto, iva: precios.iva, total: precios.total };
    });
    res.json({ productos: productosConPrecio, avisos, refrescado: true });
  }catch(e){
    res.status(500).json({ error: e.message });
  }
});

// ---------- sitio estático (el catálogo) ----------
app.use(express.static('public'));

app.listen(PORT, () => {
  console.log(`Servidor Phillips escuchando en el puerto ${PORT}`);
});
