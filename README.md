<img src="assets/icon.svg" width="64" height="64" alt="">

# Shalendar

Calendario colaborativo, ligero y visual para organizar quedadas con amigos, marcar disponibilidad y votar fechas en tiempo real — **sin registros ni contraseñas**.

## Qué incluye

- **Calendario visual con mapa de calor**: haz clic o arrastra para pintar tus días como **Puedo**, **Quizá**, **No puedo** o **Borrar** (con atajo de un clic para marcar fines de semana).
- **Vista dual instantánea**: ve de un vistazo la disponibilidad del grupo en intensidad de color junto con tu propia selección en cada casilla, o cambia a *Solo mis días*.
- **Filtro de intersección por amigos**: pulsa uno o varios amigos para resaltar únicamente los días en los que coincidís todos.
- **Votación en vivo**: ranking automático de mejores días, propuesta de fechas candidatas con nota, límite configurable de votos por persona, barras de progreso visuales y botón de **Confirmar fecha definitiva**.
- **Tabla comparativa (Matriz)**: vista rápida *Amigos × Mejores fechas* para comparar de un vistazo.
- **Compartir y exportar**: enlace corto `/e/<slug>`, envío directo por WhatsApp con resumen automático, exportación a **Google Calendar** y descarga de archivo **`.ics`**.
- **Tiempo real (SSE) + Modo claro/oscuro**: todos los amigos ven los cambios en directo sin recargar.

## Stack elegido

- **Frontend**: React 19 + TypeScript + Vite 6 + Tailwind CSS v4 + Lucide Icons
- **Backend**: Node.js 22 + Hono + SQLite nativo (`node:sqlite`, cero compilación nativa) + Server-Sent Events (SSE) + Zod
- **Tests**: Vitest

## Cómo ejecutarlo

```bash
npm install
npm run dev
```

- Frontend (desarrollo): `http://localhost:5173`
- API (desarrollo): `http://localhost:3001`

### Producción (un solo puerto)

```bash
npm run build
npm start
```

Sirve tanto el frontend compilado como la API y base de datos SQLite (`data/shalendar.db`) en `http://localhost:3001`.

### Tests y verificación

```bash
npm run typecheck
npm test
```
