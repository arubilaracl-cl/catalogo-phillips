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
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();

// Cabeceras de seguridad (oculta X-Powered-By, agrega CSP/X-Frame-Options/etc.)
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: false // el HTML usa estilos/scripts inline; se deja sin CSP estricta por ahora
}));

app.use(express.json({ limit: '2mb' }));

// Límite de peticiones para el endpoint de cotización (evita spam / abuso del cupo de Resend)
const limiteCotizacion = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 8, // máx. 8 solicitudes de cotización por IP cada 15 min
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes. Intenta de nuevo en unos minutos.' }
});
const PORT = process.env.PORT || 3000;

// ---------- configuración de la planilla ----------
// para agregar más categorías en el futuro, solo hay que sumar más
// entradas aquí con su nombre y su gid (se ve en la URL de cada pestaña)
const SHEET_ID = process.env.SHEET_ID || '1ItxD9POkojzWNQU1ULsji93V3dQ6n2FZHlmFWzeOwH4';
const PESTAÑAS = [
  { nombre: 'Radiation - Apparel', gid: '733320967' },
  { nombre: 'Radiation Glasses', gid: '2053326769' },
  { nombre: 'Radiation - Barriers', gid: '1765599488' },
  { nombre: 'Radiation - Apron Racks', gid: '1425193102' },
  { nombre: 'Radiation - Signs', gid: '173982867' },
  { nombre: 'Radiation - Nuclear Medicine', gid: '1754405718' },
  { nombre: 'Radiation - Lead Blockers', gid: '906081613' },
  { nombre: 'Radiation - Lead Markers', gid: '2000643853' }
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
  'DISPOSABLE RADIATION APPAREL': 'Vestimenta de radioprotección desechable',
  // categorías principales (nombre de pestaña) para las divisiones nuevas —
  // estas no llevan traducción SKU por SKU todavía (son ~285 productos),
  // así que la descripción de cada ítem queda en inglés tal como viene
  // de la planilla de Phillips.
  'Radiation Glasses': 'Lentes plomados',
  'Radiation - Barriers': 'Barreras de plomo',
  'Radiation - Apron Racks': 'Repisas para delantales plomados',
  'Radiation - Signs': 'Señalética de radiación',
  'Radiation - Nuclear Medicine': 'Medicina nuclear',
  'Radiation - Lead Blockers': 'Bloqueadores de plomo',
  'Radiation - Lead Markers': 'Marcadores radiográficos',
  // sub-divisiones dentro de la pestaña "Radiation Glasses"
  'PHILLIPS SAFETY LEAD GLASSES': 'Lentes plomados Phillips Safety',
  'PHILLIPS SAFETY FACE SHIELDS': 'Protectores faciales de plomo',
  'PHILLIPS SAFETY RADIATION/LASER COMBINATION GLASSES': 'Lentes combinados radiación/láser',
  'NIKE LEAD GLASSES': 'Lentes plomados Nike'
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

const TRADUCCION_ETIQUETA_OPCION = {
  'Matching Thyroid Shield': 'Protector tiroideo a juego',
  'Personalized Logo': 'Logo personalizado',
  'Embroidery': 'Bordado',
  'Tether': 'Correa/cordón'
};

// Tipos de marco de la pestaña "Radiation Glasses" (columna "Type:")
const TRADUCCION_TIPO = {
  'ECONOMY': 'Económico',
  'FITOVER': 'Fitover (sobrepuesto)',
  'GOGGLES': 'Antiparras',
  'PLASTIC': 'Plástico',
  'WRAP AROUND SPORT': 'Deportivo envolvente',
  'WRAP AROUND': 'Envolvente',
  'METAL': 'Metálico'
};

function traducirTipo(tipo){
  return TRADUCCION_TIPO[(tipo || '').toUpperCase().trim()] || tipo;
}

// Traducción "best effort" de descripciones que no tienen traducción exacta
// por SKU: en vez de traducir cada una a mano (son cientos de productos entre
// todas las categorías), se reemplazan frases técnicas repetidas por su
// equivalente en español. Lo que no calza queda en inglés (mejor eso que nada,
// y son términos técnicos igual de entendibles: "Pb Eq", medidas en pulgadas, etc.)
function traducirDescripcionGenerica(desc){
  if (!desc) return desc;
  let d = desc;
  const reemplazos = [
    // --- Radiation Glasses ---
    [/\bwith no prescription\b/gi, 'sin graduación'],
    [/\bwith Single Vision lens\b/gi, 'con lente monofocal'],
    [/\bwith Progressive Bifocal lens\b/gi, 'con lente progresivo/bifocal'],
    [/\+\s*Anti-Reflective Coating\b/gi, '+ recubrimiento antirreflejo'],
    [/\+\s*Fog-Free Coating\b/gi, '+ recubrimiento antiempañante'],
    [/\bEconomy Frame Style\b/gi, 'marco económico'],
    [/\bFitover Glasses\b/gi, 'lentes fitover (sobrepuestos)'],
    [/\bGoggle Style\b/gi, 'tipo antiparras'],
    [/\bPlastic Frame\b/gi, 'marco plástico'],
    [/\bWrap Around Sport Style\b/gi, 'estilo deportivo envolvente'],
    [/\bWrap Around Style\b/gi, 'estilo envolvente'],
    [/\bMetal frames\b/gi, 'marco metálico'],
    [/\bframe in\b/gi, 'marco en'],
    [/\bin (\w[\w/]*) color\b/gi, 'color $1'],
    [/,\s*size\s+(\d+),\s*/gi, ', talla $1, '],

    // --- Barreras (Radiation - Barriers) ---
    [/\bMobile Leaded Barrier\b/gi, 'Barrera móvil plomada'],
    [/\bMobile Lead Barrier\b/gi, 'Barrera móvil de plomo'],
    [/\bTilted Mobile Leaded Barrier\b/gi, 'Barrera móvil plomada inclinable'],
    [/\bCollapsible Mobile Lead Barrier\b/gi, 'Barrera móvil de plomo plegable'],
    [/\bInterventional Radiology Barrier\b/gi, 'Barrera de radiología intervencional'],
    [/\bleaded window size\b/gi, 'tamaño de ventana plomada'],
    [/\bLeaded Window Size\b/gi, 'Tamaño de ventana plomada'],
    [/\bOverall Size\b/gi, 'Tamaño total'],
    [/\bMRI SAFE NON MAGNETIC\b/gi, 'seguro para RM, no magnético'],
    [/\bNotched Style\b/gi, 'estilo con muesca'],
    [/\bShorty\b/gi, 'corta'],
    [/\bLead Free Acylic Barrier\b/gi, 'Barrera acrílica libre de plomo'],
    [/\bReach Through Curtain\b/gi, 'cortina de acceso manual'],
    [/\bStanding Mobile Shield\b/gi, 'Blindaje móvil de pie'],
    [/\bTable Shield\b/gi, 'Protector de mesa'],
    [/\bPleated Table Shield\b/gi, 'Protector de mesa plisado'],
    [/\bMobile Porta Shield\b/gi, 'Protector portátil móvil'],
    [/\bRadiation Shielding Pleated\b/gi, 'Blindaje de radiación plisado'],

    // --- Repisas (Radiation - Apron Racks) ---
    [/\bWall Mounted Apron Rack\b/gi, 'Repisa de pared para delantales'],
    [/\bWall Mounted Lead Apron Peg Rack\b/gi, 'Colgador de pared tipo gancho para delantales plomados'],
    [/\bWall Mounted Steel Multi Apron and Glove rack\b/gi, 'Repisa de pared de acero para delantales y guantes'],
    [/\bWall Mounted Chrome Lead Apron and Glove Holder\b/gi, 'Soporte de pared cromado para delantal y guantes'],
    [/\bMobile Apron Rack\b/gi, 'Repisa móvil para delantales'],
    [/\bMobile Radiation Apron Valet Rack\b/gi, 'Repisa móvil tipo valet para delantales'],
    [/\bSwing Rods?\b/gi, 'varillas giratorias'],
    [/\bSwing Arms?\b/gi, 'brazos giratorios'],
    [/\bDeluxe Mobile Lead Apron Locker\b/gi, 'Casillero móvil de lujo para delantales plomados'],
    [/\bClosed Loop Chrome Lead Apron Hanger\b/gi, 'Colgador cromado de argolla cerrada para delantal plomado'],
    [/\bOpen Loop Chrome Lead Apron Hanger\b/gi, 'Colgador cromado de argolla abierta para delantal plomado'],

    // --- Señalética (Radiation - Signs) ---
    [/\bRadiation Caution Sign\b/gi, 'Letrero de precaución por radiación'],
    [/\bX-Ray in Use Sign\b/gi, 'Letrero de rayos X en uso'],
    [/\bX-Ray Room Sign\b/gi, 'Letrero de sala de rayos X'],
    [/\bBiohazard Caution Sign\b/gi, 'Letrero de precaución de riesgo biológico'],
    [/\bWarning Sign\b/gi, 'Letrero de advertencia'],
    [/\bSilk Screened Sign\b/gi, 'Letrero serigrafiado'],
    [/\bMagnetic\b/gi, 'Magnético'],
    [/\bIlluminated\b/gi, 'Iluminado'],
    [/\bLed Sign\b/gi, 'Letrero LED'],
    [/\bwith Battery Backup\b/gi, 'con batería de respaldo'],

    // --- Medicina Nuclear (Radiation - Nuclear Medicine) ---
    [/\bErgo L-Block Shield\b/gi, 'Blindaje ergonómico tipo L-Block'],
    [/\bEconomy L Block Shield\b/gi, 'Blindaje económico tipo L-Block'],
    [/\bL-Block Shield and Cave\b/gi, 'Blindaje tipo L-Block con cueva'],
    [/\bL-Block Shield Only\b/gi, 'Solo blindaje tipo L-Block'],
    [/\bL-Block Cave Only\b/gi, 'Solo cueva tipo L-Block'],
    [/\bMobile Injection Cart\b/gi, 'Carro móvil de inyección'],
    [/\bMulti-Functional Mobile Injection Vehicle\b/gi, 'Vehículo móvil de inyección multifuncional'],
    [/\bShielded Waste Container\b/gi, 'Contenedor de residuos blindado'],
    [/\bMobile Shielded Waste Container\b/gi, 'Contenedor móvil de residuos blindado'],
    [/\bShielded Waste Decay Barrels?\b/gi, 'Barriles blindados de decaimiento de residuos'],
    [/\bSyringe Shield\b/gi, 'Protector de jeringa'],
    [/\bRinse Lead Cans?\b/gi, 'Recipientes de enjuague plomados'],
    [/\bShielded Sharps Container\b/gi, 'Contenedor blindado de cortopunzantes'],
    [/\bwith Electric Lift\b/gi, 'con elevador eléctrico'],

    // --- Bloqueadores / Marcadores ---
    [/\bLead Free Blockers\b/gi, 'Bloqueadores libres de plomo'],
    [/\bCustom OEM Calibration Blocker\b/gi, 'Bloqueador de calibración OEM a medida'],
    [/\bLeaded PB Markers?\b/gi, 'Marcadores plomados'],
    [/\bLeaded PB X-ray Markers?\b/gi, 'Marcadores radiográficos plomados'],
    [/\bAluminum Markers?\b/gi, 'Marcadores de aluminio'],
    [/\bwith Aluminum Backs?\b/gi, 'con respaldo de aluminio'],
    [/\bReversable L and R Radiation Marker\b/gi, 'Marcador radiográfico reversible D/I'],
    [/\bMade of Metal\b/gi, 'de metal'],
    [/\bR\s*&\s*L\b/g, 'D e I'],

    // --- Genéricos que aparecen en varias categorías ---
    [/\bRequest a [Qq]uote\b/gi, 'Cotizar bajo pedido'],
  ];
  reemplazos.forEach(([regex, reemplazo]) => { d = d.replace(regex, reemplazo); });
  return d;
}

// ---------- fotos de producto (Fase 1: tomadas del sitio público de Phillips,
// según autorización de Phillips) ----------
// Nota: la planilla no trae fotos, así que estas se mapearon a mano por SKU
// revisando phillips-safety.com. Para SKUs no listados aquí (variantes de
// medida, color u opciones que no tienen página propia), se usa la foto de
// su categoría como referencia visual — no es necesariamente el mismo color/
// tela exacto del SKU pedido, pero sí el mismo tipo de producto.
const FOTO_SKU = {
  // Delantales Quickship
  'QS-RA-FFA-LF50-M-NYBK': 'https://phillips-safety.com/wp-content/uploads/2024/09/PS-Flexiback-Frontal-Apron-Blue-Angle-Front_model_whitebg1.jpg',
  'QS-RA-FFA-LL50-M-RIPBL': 'https://phillips-safety.com/wp-content/uploads/2024/09/PS-Flexiback-Frontal-Apron-Blue-Angle-Front_model_whitebg1.jpg',
  'QS-RA-VSA-LL50-XL-NYBL': 'https://phillips-safety.com/wp-content/uploads/2024/09/PS-Vest-Skirt-Apron-Ripstop-Blue-Angle-Front_model_whitebg.jpg',
  'QS-RA-LGHA-LF50-M-NYBK': 'https://phillips-safety.com/wp-content/uploads/2024/09/lapguard_blue_whitebg.jpg',
  'QS-RA-LGHA-LF50-L-RIPBL': 'https://phillips-safety.com/wp-content/uploads/2024/09/lapguard_blue_whitebg.jpg',
  'QS-RA-TF-LL50-S-NYBL': 'https://phillips-safety.com/wp-content/uploads/2024/09/PS-Tie-Front-Apron-Blue-Angle-Front_model_whitebg.jpg',
  'QS-RA-DENT-LL25-A-NYBL': 'https://phillips-safety.com/wp-content/uploads/2024/06/dental-lead-apron_QS-RA-DENT-LL25-A-NYBL.jpg',
  'QS-RA-DENT-ELF25-A-RIPBL': 'https://phillips-safety.com/wp-content/uploads/2024/06/dental-lead-apron_QS-RA-DENT-LL25-A-NYBL.jpg',

  // Delantales a medida
  'RA-FFA-PLF50': 'https://phillips-safety.com/wp-content/uploads/2024/09/PS-Flexiback-Frontal-Apron-Blue-Angle-Front_model_whitebg1.jpg',
  'RA-FFAB-PLF50': 'https://phillips-safety.com/wp-content/uploads/2025/09/ps_flexiback-buckle_model_whitebg.jpg',
  'RA-FFAB-BACK-PLF50': 'https://phillips-safety.com/wp-content/uploads/2026/04/Flexiback-Frontal-Back-Support-Apron_Front.jpg',
  'RA-TF-LF50': 'https://phillips-safety.com/wp-content/uploads/2024/09/PS-Tie-Front-Apron-Blue-Angle-Front_model_whitebg.jpg',
  'RA-J1P-PLF50': 'https://phillips-safety.com/wp-content/uploads/2025/09/ps_jacket-one-piece_model_whitebg.jpg',
  'RA-RJ1P-PLF50': 'https://phillips-safety.com/wp-content/uploads/2026/05/Reverse-Flex-Jacket-1Piece_RA-RJ1P_Front.jpg',
  'RA-PRJ1P-LF50': 'https://phillips-safety.com/wp-content/uploads/2025/09/ps_jacket-one-piece_model_whitebg.jpg',
  'RA-SDF-LL50': 'https://phillips-safety.com/wp-content/uploads/2025/09/ps_surgical-drop_model_whitebg.jpg',
  'RA-VSA-PLF50': 'https://phillips-safety.com/wp-content/uploads/2024/09/PS-Vest-Skirt-Apron-Ripstop-Blue-Angle-Front_model_whitebg.jpg',
  'RA-RVSA-PLF50': 'https://phillips-safety.com/wp-content/uploads/2025/09/ps_reverse-vest-skirt_model_whitebg.jpg',
  'RA-LGHA-LF50': 'https://phillips-safety.com/wp-content/uploads/2024/09/lapguard_blue_whitebg.jpg',
  'RA-MP-LF50': 'https://phillips-safety.com/wp-content/uploads/2024/09/lapguard_blue_whitebg.jpg',
  'RA-DENT-LL25': 'https://phillips-safety.com/wp-content/uploads/2024/06/dental-lead-apron_QS-RA-DENT-LL25-A-NYBL.jpg',

  // Protectores gonadales/ováricos
  'RA-GOS-SET-LL50': 'https://phillips-safety.com/wp-content/uploads/2024/08/gonad-ovarian-shield-with-buckle-radiation-protection-set-of-3.jpg',
  'RA-PGOS-LL25': 'https://phillips-safety.com/wp-content/uploads/2026/01/RA-GOS-LL25-small.jpg',
  'GOS-DPR-LL50': 'https://phillips-safety.com/wp-content/uploads/2026/01/GOS-DPR_front-scaled.jpeg',
  'QS-GOS-Blue-3pcs': 'https://phillips-safety.com/wp-content/uploads/2024/08/gonad-ovarian-shield-with-buckle-radiation-protection-set-of-3.jpg',
  'GOS-LF25-NICU-PACK5': 'https://phillips-safety.com/wp-content/uploads/2024/05/NICU-Gonad-PO-2300154001-scaled.jpg',

  // Protectores tiroideos
  'RA-TS-ELF50': 'https://phillips-safety.com/wp-content/uploads/2024/06/RA-TS-LL35_model_cut.jpg',
  'RA-TS-BIB-ELF50': 'https://phillips-safety.com/wp-content/uploads/2024/06/RA-TS-BIB-LL25-model_cut.jpg',
  'RA-TS-U-LL50': 'https://phillips-safety.com/wp-content/uploads/2024/06/RA-TS-U-LL25-model_cut.jpg',
  'RA-TS-VISOR-ELF25': 'https://phillips-safety.com/wp-content/uploads/2024/06/RA-TS-VISOR-LL25-model_cut.jpg',
  'QS-TS-ELF50-NYBK': 'https://phillips-safety.com/wp-content/uploads/2024/06/PS-Thyroid-Shield-Nylon-Blue-Angle-Left_model_whitebg.jpg',
  'QS-TS-ELF50-RIPBL': 'https://phillips-safety.com/wp-content/uploads/2024/06/PS-Thyroid-Shield-Nylon-Blue-Angle-Left_model_whitebg.jpg',
  'TS-DS-LF50-M': 'https://phillips-safety.com/wp-content/uploads/2024/11/TS-DS-LF50-L_MAIN.jpg',

  // Gorros
  'RA-RH-ELF50': 'https://phillips-safety.com/wp-content/uploads/2024/06/RA-RH-LL25-model_front_cut.jpg',
  'QS-RH-ELF50-NYBK': 'https://phillips-safety.com/wp-content/uploads/2024/07/Radiation-Hats-Blue-Angle-Front.jpg',
  'QS-RPC-LL50-NYBL': 'https://phillips-safety.com/wp-content/uploads/2024/07/QS-RPC-LL50-NYBL.jpg',
  'AT-CAP-05': 'https://phillips-safety.com/wp-content/uploads/2023/12/Disposable_Hat_Side.jpg',

  // Lentes plomados (Fitover, Económico, Metálico) — el resto de tipos
  // (Antiparras, Plástico, Envolvente, Deportivo envolvente, Nike, protectores
  // faciales, combinados) aún no tiene foto mapeada, quedan pendientes.
  'RG-33-BK-50SS': 'https://phillips-safety.com/wp-content/uploads/2023/01/RG-33-BK07-scaled.jpg',
  'RG-33-T-50SS': 'https://phillips-safety.com/wp-content/uploads/2023/01/RG-33-T07-scaled.jpg',
  'RG-206-OB-50SS': 'https://phillips-safety.com/wp-content/uploads/2023/01/RG-206-OB-BULK-6-scaled.jpg',
  'RG-500-49GM-50SS': 'https://phillips-safety.com/wp-content/uploads/2023/01/RG-500-49GM-50SS-scaled.jpg'
};

// Respaldo por TIPO de marco (columna "Type:" de la pestaña Radiation Glasses):
// si el SKU exacto de un lente no está en FOTO_SKU pero conocemos su tipo,
// usamos la foto representativa de ese tipo en vez de dejarlo sin imagen.
const FOTO_TIPO = {
  'ECONOMY': 'https://phillips-safety.com/wp-content/uploads/2023/01/RG-206-OB-BULK-6-scaled.jpg',
  'FITOVER': 'https://phillips-safety.com/wp-content/uploads/2023/01/RG-33-BK07-scaled.jpg',
  'METAL': 'https://phillips-safety.com/wp-content/uploads/2023/01/RG-500-49GM-50SS-scaled.jpg'
};

function fotoTipoDe(tipo){
  return FOTO_TIPO[(tipo || '').toUpperCase().trim()] || null;
}

function fotoDe(sku){
  return FOTO_SKU[sku] || null;
}

function traducirEtiquetaOpcion(etiqueta){
  return TRADUCCION_ETIQUETA_OPCION[etiqueta] || etiqueta;
}

function traducir(sku, seccion, descripcionOriginal){
  return {
    descripcion: TRADUCCION_SKU[sku] || traducirDescripcionGenerica(descripcionOriginal),
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
  const colTipo = idx(/^type:?$/i);
  const colDist2026 = header.findIndex(c => /distributor/i.test(c || '') && /2026/.test(c || ''));
  const colDist2025 = header.findIndex(c => /distributor/i.test(c || '') && /2025/.test(c || ''));
  const colDesc0 = idx(/^description/i);
  const colDesc = colDesc0 >= 0 ? colDesc0 : idx(/summary/i);
  const colMaterial = idx(/core material/i);
  const colTela = idx(/^fabric/i);
  // cualquier columna cuyo encabezado empiece con "Add " es una personalización
  // opcional (logo, bordado, correa, etc.) — se captura de forma genérica para
  // que funcione igual en cualquier categoría futura sin tener que tocar el código
  const colsOpciones = header
    .map((c, idx2) => ({ idx: idx2, etiqueta: (c || '').replace(/^Add\s+/i, '').replace(/\s*\+\$[\d.]+\s*/g, '').replace(/:\s*$/, '').trim() }))
    .filter(c => /^Add\s/i.test(header[c.idx] || ''));

  const items = [];
  let seccionActual = nombrePestaña;
  let tipoActual = '';

  for (let i = idxHeader + 1; i < filas.length; i++){
    const fila = filas[i];
    if (!fila || fila.every(c => !c || !c.trim())) continue;

    const sku = colSku >= 0 ? (fila[colSku] || '').trim() : '';
    const desc = colDesc >= 0 ? (fila[colDesc] || '').trim() : '';
    const tieneAlgunPrecio = (colDist2026 >= 0 && fila[colDist2026]) || (colDist2025 >= 0 && fila[colDist2025]);

    if (!sku && !tieneAlgunPrecio){
      // fila-divisor de sección: puede traer el texto en la columna "Description"
      // (caso Apparel) o solo en la primera celda no vacía de la fila (caso
      // Radiation Glasses, que no tiene columna Description propiamente tal)
      const primerCelda = (fila.find(c => c && c.trim()) || '').trim();
      const textoDivisor = desc || primerCelda;
      if (textoDivisor){
        seccionActual = textoDivisor;
        tipoActual = ''; // nueva sección mayor -> reinicia el sub-tipo
        continue;
      }
    }
    if (!sku) continue;

    if (colTipo >= 0 && (fila[colTipo] || '').trim()){
      tipoActual = (fila[colTipo] || '').trim();
    }

    const precio2026 = colDist2026 >= 0 ? limpiaPrecio(fila[colDist2026]) : null;
    const precio2025 = colDist2025 >= 0 ? limpiaPrecio(fila[colDist2025]) : null;
    const precioUsd = precio2026 != null ? precio2026 : precio2025;
    if (precioUsd == null) continue;

    const t = traducir(sku, seccionActual, desc);
    const materialFinal = colMaterial >= 0
      ? (fila[colMaterial] || '').trim()
      : (tipoActual ? traducirTipo(tipoActual) : '');

    const opciones = colsOpciones
      .map(c => ({ etiqueta: traducirEtiquetaOpcion(c.etiqueta), valor: (fila[c.idx] || '').trim() }))
      .filter(o => o.valor && !/^n\/?a$/i.test(o.valor));

    items.push({
      seccion: t.seccion,
      sku,
      modelo: colModelo >= 0 ? (fila[colModelo] || '').trim() : '',
      descripcion: t.descripcion,
      material: materialFinal,
      tela: colTela >= 0 ? (fila[colTela] || '').trim() : '',
      opciones,
      foto: fotoDe(sku) || fotoTipoDe(tipoActual),
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
        material: p.material,
        tela: p.tela,
        opciones: p.opciones,
        foto: p.foto,
        neto: precios.neto,
        iva: precios.iva,
        total: precios.total
      };
    });
    res.json({ productos: productosConPrecio, avisos });
  }catch(e){
    console.error('Error en /api/productos:', e);
    res.status(500).json({ error: 'No se pudo cargar el catálogo. Intenta de nuevo en unos minutos.' });
  }
});

app.get('/api/tipo-cambio', async (req, res) => {
  try{
    const tc = await cargarTipoCambio();
    res.json(tc);
  }catch(e){
    console.error('Error en /api/tipo-cambio:', e);
    res.status(500).json({ error: 'No se pudo obtener el tipo de cambio.' });
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
      return { seccion: p.seccion, sku: p.sku, modelo: p.modelo, descripcion: p.descripcion, material: p.material, tela: p.tela, opciones: p.opciones, foto: p.foto, neto: precios.neto, iva: precios.iva, total: precios.total };
    });
    res.json({ productos: productosConPrecio, avisos, refrescado: true });
  }catch(e){
    console.error('Error en /api/productos/refrescar:', e);
    res.status(500).json({ error: 'No se pudo refrescar el catálogo. Intenta de nuevo en unos minutos.' });
  }
});

// ---------- envío de cotización (Resend: email HTML + CSV adjunto) ----------
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_REMITENTE = process.env.RESEND_REMITENTE || 'onboarding@resend.dev';
const RESEND_DESTINATARIO = process.env.RESEND_DESTINATARIO || 'rubilar.andres@outlook.com';

// Escapa HTML para insertarlo de forma segura en el correo (evita que el
// nombre/comentarios de quien cotiza inyecten HTML/script en el email).
function escapeHtml(valor){
  if (valor === null || valor === undefined) return '';
  return String(valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function csvEscape(valor){
  let s = String(valor ?? '');
  // Neutraliza inyección de fórmulas de Excel/Sheets: si el valor empieza con
  // = + - @ (o tab/CR), Excel podría interpretarlo como fórmula al abrir el
  // archivo. Se antepone un apóstrofe para forzar que se lea como texto plano.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\n;]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function generarCsvCotizacion(items){
  const encabezado = ['SKU', 'Producto', 'Cantidad', 'Neto unitario', 'Subtotal (con IVA)'];
  const filas = items.map(it => [
    it.sku, it.nombre, it.cantidad, it.netoUnitario, it.subtotalConIva
  ]);
  const lineas = [encabezado, ...filas].map(fila => fila.map(csvEscape).join(','));
  return lineas.join('\r\n');
}

function generarHtmlCotizacion({ cliente, items, total }){
  const filasHtml = items.map(it => `
    <tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;">${escapeHtml(it.sku)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;">${escapeHtml(it.nombre)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center;">${Number(it.cantidad) || 0}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;">$${Number(it.netoUnitario).toLocaleString('es-CL')}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;">$${Number(it.subtotalConIva).toLocaleString('es-CL')}</td>
    </tr>
  `).join('');

  return `
    <div style="font-family:Arial,sans-serif;color:#1a2b33;max-width:640px;">
      <h2 style="margin-bottom:4px;">Nueva solicitud de cotización — Catálogo Phillips</h2>
      <p style="color:#5a6b73;margin-top:0;">Recibida desde catalogo-phillips.onrender.com</p>

      <h3>Datos del solicitante</h3>
      <table style="font-size:14px;">
        <tr><td style="padding:2px 8px 2px 0;color:#5a6b73;">Nombre:</td><td><b>${escapeHtml(cliente.nombre) || '—'}</b></td></tr>
        <tr><td style="padding:2px 8px 2px 0;color:#5a6b73;">Empresa:</td><td>${escapeHtml(cliente.empresa) || '—'}</td></tr>
        <tr><td style="padding:2px 8px 2px 0;color:#5a6b73;">Email:</td><td>${escapeHtml(cliente.email) || '—'}</td></tr>
        <tr><td style="padding:2px 8px 2px 0;color:#5a6b73;">Teléfono:</td><td>${escapeHtml(cliente.telefono) || '—'}</td></tr>
      </table>
      ${cliente.comentarios ? `<p><b>Comentarios:</b> ${escapeHtml(cliente.comentarios)}</p>` : ''}

      <h3>Productos solicitados</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13.5px;">
        <thead>
          <tr style="background:#f0eee6;">
            <th style="padding:6px 10px;text-align:left;">SKU</th>
            <th style="padding:6px 10px;text-align:left;">Producto</th>
            <th style="padding:6px 10px;text-align:center;">Cant.</th>
            <th style="padding:6px 10px;text-align:right;">Neto unit.</th>
            <th style="padding:6px 10px;text-align:right;">Subtotal (IVA inc.)</th>
          </tr>
        </thead>
        <tbody>${filasHtml}</tbody>
      </table>
      <p style="text-align:right;font-size:16px;margin-top:10px;"><b>Total: $${Number(total).toLocaleString('es-CL')}</b></p>

      <p style="color:#8a8578;font-size:12px;">Va adjunto un CSV con el detalle, por si quieres importarlo directo a Excel.</p>
    </div>
  `;
}

// Quita saltos de línea y caracteres de control: evita inyección de
// cabeceras de correo (CRLF injection) si alguien manda "\n" en nombre/empresa.
function sanearLinea(valor, maxLen = 200){
  return String(valor ?? '').replace(/[\r\n\t]/g, ' ').trim().slice(0, maxLen);
}

const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

app.post('/api/enviar-cotizacion', limiteCotizacion, async (req, res) => {
  try{
    if (!RESEND_API_KEY){
      console.error('Falta RESEND_API_KEY en el entorno del servidor');
      return res.status(500).json({ error: 'No se pudo enviar la cotización. Intenta más tarde.' });
    }

    const { cliente, items, total } = req.body || {};

    if (!cliente || !sanearLinea(cliente.nombre) || !sanearLinea(cliente.email)){
      return res.status(400).json({ error: 'Faltan datos del solicitante (nombre y email son obligatorios)' });
    }
    if (!REGEX_EMAIL.test(String(cliente.email).trim())){
      return res.status(400).json({ error: 'El email no tiene un formato válido' });
    }
    if (!Array.isArray(items) || items.length === 0){
      return res.status(400).json({ error: 'El carrito de cotización está vacío' });
    }
    if (items.length > 200){
      return res.status(400).json({ error: 'Demasiados productos en una sola cotización' });
    }

    // ---- Validar cada ítem contra el catálogo REAL del servidor ----
    // No confiamos en el nombre/precio que mande el navegador: solo el SKU.
    // Así evitamos que alguien invente productos o manipule precios llamando
    // directo a este endpoint (sin pasar por el catálogo).
    const { datos: catalogo } = await cargarProductos();
    const tc = await cargarTipoCambio();
    const catalogoPorSku = new Map(catalogo.map(p => [p.sku, p]));

    const itemsValidados = [];
    for (const item of items){
      const prod = catalogoPorSku.get(String(item?.sku || ''));
      if (!prod) continue; // SKU no reconocido: se descarta silenciosamente
      const cantidad = Math.min(Math.max(parseInt(item.cantidad, 10) || 1, 1), 9999);
      const precios = calcularPrecio(prod.precioUsd, tc.valor);
      itemsValidados.push({
        sku: prod.sku,
        nombre: prod.modelo || prod.descripcion || prod.sku,
        cantidad,
        netoUnitario: precios.neto,
        subtotalConIva: precios.total * cantidad
      });
    }

    if (itemsValidados.length === 0){
      return res.status(400).json({ error: 'Ninguno de los productos enviados es válido' });
    }

    const totalValidado = itemsValidados.reduce((s, i) => s + i.subtotalConIva, 0);

    const clienteSaneado = {
      nombre: sanearLinea(cliente.nombre, 120),
      empresa: sanearLinea(cliente.empresa, 120),
      email: sanearLinea(cliente.email, 200),
      telefono: sanearLinea(cliente.telefono, 60),
      comentarios: sanearLinea(cliente.comentarios, 1000)
    };

    const csv = generarCsvCotizacion(itemsValidados);
    const csvBase64 = Buffer.from(csv, 'utf8').toString('base64');
    const html = generarHtmlCotizacion({ cliente: clienteSaneado, items: itemsValidados, total: totalValidado });

    const asunto = `Cotización catálogo Phillips — ${clienteSaneado.nombre}${clienteSaneado.empresa ? ' (' + clienteSaneado.empresa + ')' : ''}`;

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: RESEND_REMITENTE,
        to: [RESEND_DESTINATARIO],
        reply_to: clienteSaneado.email,
        subject: asunto,
        html,
        attachments: [
          { filename: 'cotizacion.csv', content: csvBase64 }
        ]
      })
    });

    if (!resendRes.ok){
      const errText = await resendRes.text();
      console.error(`Resend error ${resendRes.status}: ${errText}`);
      throw new Error('resend_failed');
    }

    res.json({ ok: true });
  }catch(e){
    console.error('Error en /api/enviar-cotizacion:', e);
    res.status(500).json({ error: 'No se pudo enviar la cotización. Intenta de nuevo en unos minutos.' });
  }
});

// ---------- SEO: título/descripción/JSON-LD dinámicos según la categoría ----------
// Mismas 8 macro-categorías que usa el frontend (public/index.html), con sus
// slugs para las URLs tipo /?categoria=barreras-de-plomo. Si mañana cambian
// las categorías reales, hay que actualizar esta lista en ambos lados.
const SITE_URL = 'https://catalogo-phillips.onrender.com';
const MACRO_CATEGORIAS_SEO = [
  { nombre: 'Repisas para Delantales', slug: 'repisas-para-delantales', match: /repisa|rack|soporte/i },
  { nombre: 'Delantales Plomados', slug: 'delantales-plomados', match: /delantal|gonad|tiroide|gorro|manta|desechable|accesorio/i },
  { nombre: 'Lentes Plomados', slug: 'lentes-plomados', match: /lentes plomados|lead glasses/i },
  { nombre: 'Barreras de Plomo', slug: 'barreras-de-plomo', match: /barrera/i },
  { nombre: 'Señalética de Radiación', slug: 'senaletica-de-radiacion', match: /señal|sign/i },
  { nombre: 'Medicina Nuclear', slug: 'medicina-nuclear', match: /nuclear/i },
  { nombre: 'Bloqueadores de Plomo', slug: 'bloqueadores-de-plomo', match: /bloquead/i },
  { nombre: 'Marcadores Radiográficos', slug: 'marcadores-radiograficos', match: /marcador/i },
];

function macroDeSeccionSeo(seccion){
  return MACRO_CATEGORIAS_SEO.find(m => m.match.test(seccion || '')) || null;
}

let plantillaHtml = null;
function cargarPlantilla(){
  if (!plantillaHtml){
    plantillaHtml = require('fs').readFileSync(require('path').join(__dirname, 'public', 'index.html'), 'utf8');
  }
  return plantillaHtml;
}

function escapeHtmlSeo(valor){
  return String(valor ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

app.get('/', async (req, res) => {
  try {
    const slug = String(req.query.categoria || '').trim();
    const macro = slug ? MACRO_CATEGORIAS_SEO.find(m => m.slug === slug) : null;

    let productosCatalogo = [];
    try {
      const { datos } = await cargarProductos();
      productosCatalogo = datos || [];
    } catch (e) {
      console.error('No se pudo cargar el catálogo para SEO (se sirve la página igual):', e.message);
    }

    // Conteo real de productos por macro-categoría (para el bloque pre-renderizado y JSON-LD)
    const conteoPorMacro = {};
    productosCatalogo.forEach(p => {
      const m = macroDeSeccionSeo(p.seccion);
      const key = m ? m.nombre : 'Otros';
      conteoPorMacro[key] = (conteoPorMacro[key] || 0) + 1;
    });

    const tituloBase = 'Quantical | Distribuidor Oficial Phillips Safety — Protección Radiológica Chile';
    const descBase = 'Quantical — Distribuidor oficial de Phillips Safety Products en Chile. Equipos de protección radiológica Made in USA: delantales plomados, lentes, barreras, medicina nuclear.';

    const titulo = macro
      ? `${macro.nombre} Phillips Safety Chile — Cotiza con Quantical`
      : tituloBase;
    const descripcion = macro
      ? (() => {
          const n = conteoPorMacro[macro.nombre] || 0;
          return `Cotiza ${macro.nombre.toLowerCase()} originales Phillips Safety en Chile. ${n} producto${n !== 1 ? 's' : ''} disponible${n !== 1 ? 's' : ''}, distribución directa Quantical.`;
        })()
      : descBase;
    const canonical = macro ? `${SITE_URL}/?categoria=${macro.slug}` : `${SITE_URL}/`;

    // Bloque de texto real (visible para buscadores) con las 8 categorías y
    // sus cantidades — así un crawler ve contenido aunque no ejecute el JS.
    const listaCategoriasHtml = MACRO_CATEGORIAS_SEO.map(m =>
      `<li>${escapeHtmlSeo(m.nombre)}: ${conteoPorMacro[m.nombre] || 0} productos disponibles — <a href="/?categoria=${m.slug}">ver ${escapeHtmlSeo(m.nombre.toLowerCase())}</a></li>`
    ).join('');
    const seoPrerender = `
      <h1>Quantical — Distribuidor oficial Phillips Safety en Chile</h1>
      <p>Equipos de protección radiológica Phillips Safety Products (USA) para hospitales, clínicas y centros de imagenología en Chile.</p>
      <h2>Categorías de productos</h2>
      <ul>${listaCategoriasHtml}</ul>
    `;

    // JSON-LD: entidad Organization + catálogo de categorías como ItemList
    const jsonLd = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Organization',
          name: 'Quantical',
          url: SITE_URL,
          logo: `${SITE_URL}/logos/quantical.png`,
          description: descBase,
          areaServed: 'CL'
        },
        {
          '@type': 'ItemList',
          itemListElement: MACRO_CATEGORIAS_SEO.map((m, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            name: m.nombre,
            url: `${SITE_URL}/?categoria=${m.slug}`
          }))
        }
      ]
    };

    let html = cargarPlantilla();
    html = html
      .replace(/__SEO_TITLE__/g, escapeHtmlSeo(titulo))
      .replace(/__SEO_DESCRIPTION__/g, escapeHtmlSeo(descripcion))
      .replace(/__SEO_CANONICAL__/g, escapeHtmlSeo(canonical))
      .replace('__SEO_JSONLD__', `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`)
      .replace('__SEO_PRERENDER__', seoPrerender);

    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    console.error('Error sirviendo la home:', e);
    res.sendFile(require('path').join(__dirname, 'public', 'index.html'));
  }
});

// ---------- sitio estático (logos, robots.txt, sitemap.xml, etc.) ----------
app.use(express.static('public', { index: false }));

app.listen(PORT, () => {
  console.log(`Servidor Phillips escuchando en el puerto ${PORT}`);
});
