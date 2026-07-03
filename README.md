# TableroPro

Kanban interno tipo Trello: colorido, tareas recurrentes (por día de la semana, con regeneración automática), checklists, imágenes en las tarjetas, etiquetas, custom fields, swimlanes, automation, y vistas de Calendario, Timeline y Dashboard.

Ahora con **login por persona** (email + contraseña) y **tableros compartidos**: todos los que entran ven y editan el mismo tablero. El registro está protegido con un **código de invitación**.

## Arquitectura

- `index.html` — la app completa (frontend en un solo archivo).
- `server.js` — servidor Node **sin frameworks** que sirve la app y expone la API (`/api/register`, `/api/login`, `/api/logout`, `/api/me`, `/api/state`).
- Base de datos **PostgreSQL**: guarda usuarios y un único workspace compartido (JSON). Las contraseñas se guardan con hash (scrypt); la sesión es una cookie firmada.

## Notas

- **Concurrencia**: si dos personas editan a la vez, el que guarda segundo recibe el cambio del otro y se sincroniza (control por número de versión). La app también refresca sola cada 15s.
- **Datos**: el tablero vive en Postgres, así que persiste entre reinicios. El botón **Export/Import** sigue disponible para backups en JSON.
- Para escalar a varios tableros privados por equipo/persona habría que extender el modelo (hoy es un único workspace compartido, que es lo pedido).
