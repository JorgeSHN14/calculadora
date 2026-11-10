# 🪞 Mirror — Aula Virtual ESPOL

Sistema de espejo visual en tiempo real para el Aula Virtual de ESPOL.  
Captura lo que ves en `aulavirtual.espol.edu.ec` y lo muestra en una página local de solo lectura.

---

## 🚀 Instalación

```bash
cd mirror-server
npm install
```

## ▶️ Uso

### 1. Iniciar el servidor

```bash
npm start
```

El servidor arranca en `http://localhost:3700`.

### 2. Inyectar el capturador

Abre **aulavirtual.espol.edu.ec** en tu navegador y usa uno de estos métodos:

#### Opción A: Consola del navegador (recomendado)
1. Presiona `F12` para abrir DevTools
2. Ve a la pestaña **Console**
3. Pega este código y presiona Enter:

```javascript
fetch('http://localhost:3700/injector.js').then(r=>r.text()).then(eval)
```

#### Opción B: Bookmarklet
1. Abre `http://localhost:3700` en tu navegador
2. Arrastra el botón **📸 Mirror Capture** a tu barra de favoritos
3. Cuando estés en el Aula Virtual, haz clic en el bookmarklet

### 3. Ver el espejo

Abre `http://localhost:3700` en otra pestaña o en otro dispositivo de la misma red.  
Verás exactamente lo que se muestra en tu Aula Virtual.

---

## 🔧 Cómo funciona

```
┌──────────────────────┐       POST /api/snapshot       ┌──────────────────────┐
│                      │  ──────────────────────────►   │                      │
│   Aula Virtual ESPOL │    JSON { html, url, title }   │   Mirror Server      │
│   + injector.js      │                                │   (Express + SQLite) │
│                      │                                │                      │
└──────────────────────┘                                └──────────┬───────────┘
                                                                   │
                                                         GET /api/snapshot/latest
                                                                   │
                                                        ┌──────────▼───────────┐
                                                        │                      │
                                                        │   Página Espejo      │
                                                        │   (iframe srcdoc)    │
                                                        │                      │
                                                        └──────────────────────┘
```

### El inyector (`injector.js`) — Modo 100% Pasivo:
- **CERO requests al servidor original** — no hace fetch/XHR a aulavirtual.espol.edu.ec
- **CERO modificaciones al DOM** — no inyecta elementos, no cambia atributos
- **CERO monkey-patching** — no toca history.pushState, fetch, XHR ni ninguna API global
- **CERO eventos generados** — no dispara popstate, hashchange, ni ningún evento
- **CERO acceso a cookies/storage/sesión** — no lee ni escribe nada de autenticación
- Solo **lee** lo que ya está en memoria:
  - CSS → `document.styleSheets[].cssRules` (ya parseado por el navegador)
  - Imágenes → canvas offscreen `drawImage` + `toDataURL` (píxeles ya renderizados)
  - DOM → `cloneNode(true)` (copia en memoria)
  - Formularios → lee `.value`, `.checked`, `.selected` (estado actual)
- Detecta cambios con `MutationObserver` (API pasiva, no detectable) + polling de URL
- El **único request** que hace es `POST` a `localhost:3700` (invisible para el servidor original)
- Usa `requestIdleCallback` para **cero impacto en rendimiento**

### El servidor:
- Almacena snapshots en SQLite (auto-limpia los más antiguos)
- Sirve la página espejo con polling cada 2 segundos
- API REST completa para gestión de snapshots

---

## 📡 API

| Método   | Ruta                       | Descripción                          |
|----------|----------------------------|--------------------------------------|
| `POST`   | `/api/snapshot`            | Guarda un nuevo snapshot             |
| `GET`    | `/api/snapshot/latest`     | Último snapshot (completo con HTML)  |
| `GET`    | `/api/snapshot/latest/meta`| Metadatos del último (sin HTML)      |
| `GET`    | `/api/snapshot/:id`        | Snapshot específico por ID           |
| `GET`    | `/api/snapshots`           | Lista todos (solo metadatos)         |
| `DELETE` | `/api/snapshots`           | Borra todos los snapshots            |

---

## ⚠️ Notas importantes

- El sistema funciona **100% local** — no necesita hosting externo
- Si el Aula Virtual tiene **Content Security Policy (CSP)** estricta, el método de la consola podría ser bloqueado. En ese caso, usa una extensión como [Disable CSP](https://chrome.google.com/webstore/detail/disable-content-security/ieelmcmcagommplceebfedjlakkhpden) temporalmente
- Las **imágenes cross-origin** que no permitan CORS se mostrarán con su URL absoluta original
- Los **videos embebidos** (YouTube, etc.) aparecerán como placeholders
- Los **formularios** se ven pero no son funcionales en el espejo
- La página espejo es de **solo lectura** — los links están desactivados

---

## 📁 Estructura

```
mirror-server/
├── package.json          # Dependencias del proyecto
├── server.js             # Servidor Express
├── db.js                 # Capa de base de datos SQLite
├── public/
│   ├── index.html        # Página espejo (UI)
│   ├── mirror.css        # Estilos de la interfaz
│   ├── mirror.js         # Lógica del cliente espejo
│   └── injector.js       # Script de inyección
└── data/
    └── mirror.db         # Base de datos (auto-creada)
```
