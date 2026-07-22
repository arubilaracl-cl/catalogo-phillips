# Catálogo Phillips Safety — backend + frontend

Lee en vivo la planilla de precios de Phillips (Google Sheets), aplica margen y
tipo de cambio, y muestra un catálogo cotizable en CLP. El servidor (no el
navegador del cliente) es quien le pide los datos a Google — esto evita el
problema de CORS que tenía la versión 100% en el navegador.

## Estructura

- `server.js` — backend Express. Expone:
  - `GET /api/productos` — catálogo ya parseado (código, descripción, precio USD)
  - `GET /api/tipo-cambio` — dólar observado del día (Banco Central vía mindicador.cl)
  - `POST /api/productos/refrescar` — fuerza releer la planilla ahora mismo
- `public/index.html` — el catálogo (frontend), sirve como sitio estático

## Cómo desplegar en Render

1. Sube esta carpeta a un repositorio de GitHub (puede ser privado).
2. En Render (https://dashboard.render.com): **New +** → **Web Service**.
3. Conecta el repositorio.
4. Configuración:
   - **Environment**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free está bien para probar (nota: en el plan gratis el servicio
     "duerme" tras ~15 min sin uso y tarda unos segundos en despertar en la
     próxima visita — si eso molesta, el plan pagado más económico lo evita).
5. Variables de entorno (opcional, tiene valores por defecto):
   - `SHEET_ID` — el ID de la planilla de Google (ya viene con el de Phillips
     configurado, solo cámbialo si Phillips te pasa una planilla nueva)
6. Deploy. Render te da una URL pública tipo `https://tu-app.onrender.com`.

## Agregar más categorías (pestañas) de la planilla

En `server.js`, busca el arreglo `PESTAÑAS` cerca del inicio del archivo:

```js
const PESTAÑAS = [
  { nombre: 'Radiation - Apparel', gid: '733320967' }
];
```

Para agregar otra categoría, abre esa pestaña en Google Sheets, copia el
`gid=NÚMERO` que aparece al final de la URL, y agrega una línea:

```js
const PESTAÑAS = [
  { nombre: 'Radiation - Apparel', gid: '733320967' },
  { nombre: 'Nombre de la nueva pestaña', gid: '123456789' }
];
```

Cada pestaña puede tener columnas ligeramente distintas — el lector busca las
columnas por nombre (no por posición fija), así que debería funcionar en la
mayoría de los casos, pero conviene revisar cada una la primera vez.

## Nota sobre las pruebas

Este código fue validado con datos reales de tu planilla (extracción y
cálculo de precios funcionando correctamente), pero no pude probar la
conexión en vivo desde mi entorno de desarrollo porque tiene una lista
restringida de dominios permitidos (bloquea `mindicador.cl` y
`docs.google.com` específicamente en mi sandbox de pruebas). Render no tiene
esta restricción — deberían funcionar sin problema ahí. Si al desplegar ves
algún error en los logs de Render, mándamelo y lo revisamos.
