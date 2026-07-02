# TableroPro

Kanban interno tipo Trello: colorido, tareas recurrentes (por día de la semana, con regeneración automática), checklists, imágenes en las tarjetas, etiquetas, custom fields, swimlanes, automation, y vistas de Calendario, Timeline y Dashboard.

Ahora con **login por persona** (email + contraseña) y **tableros compartidos**: todos los que entran ven y editan el mismo tablero. El registro está protegido con un **código de invitación**.

## Arquitectura

- `index.html` — la app completa (frontend en un solo archivo).
- `server.js` — servidor Node **sin frameworks** que sirve la app y expone la API (`/api/register`, `/api/login`, `/api/logout`, `/api/me`, `/api/state`).
- Base de datos **PostgreSQL**: guarda usuarios y un único workspace compartido (JSON). Las contraseñas se guardan con hash (scrypt); la sesión es una cookie firmada.

## Variables de entorno

| Variable | Obligatoria | Para qué |
|---|---|---|
| `DATABASE_URL` | sí | Conexión a Postgres. En Railway se setea sola al agregar la base. |
| `INVITE_CODE` | sí | Código que hay que ingresar para crear una cuenta. Ej: `EQUIPO-2026`. Sin esto, el registro queda deshabilitado. |
| `SESSION_SECRET` | recomendada | Clave para firmar las sesiones. Poné un texto largo al azar. Si no la ponés, las sesiones se cierran cada vez que reinicia el server. |
| `PORT` | no | La setea Railway automáticamente. |

## Deploy en Railway (paso a paso)

1. Subí este repo a GitHub (ver más abajo).
2. Entrá a https://railway.app → **New Project** → **Deploy from GitHub repo** → elegí el repo.
3. En el proyecto: **+ New** → **Database** → **Add PostgreSQL**. Railway crea la base y comparte `DATABASE_URL` con el servicio automáticamente.
4. En el servicio de la app → pestaña **Variables** → agregá:
   - `INVITE_CODE` = el código que quieras (ej: `EQUIPO-2026`)
   - `SESSION_SECRET` = un texto largo al azar
5. Pestaña **Settings → Networking → Generate Domain** para obtener la URL pública.
6. Abrí la URL → **Creá tu cuenta** con el código de invitación. Pasale el mismo código a la otra persona para que se registre.

Railway detecta Node por `package.json`, corre `npm install` (instala `pg`) y arranca con `npm start`.

## Correr local (opcional, necesita Postgres)

```bash
npm install
export DATABASE_URL="postgres://usuario:clave@localhost:5432/tablero"
export INVITE_CODE="EQUIPO-2026"
export SESSION_SECRET="algo-largo-al-azar"
npm start
# abrir http://localhost:3000
```

> Nota: abrir `index.html` con doble clic **ya no funciona solo** — la app necesita el servidor para el login y los datos compartidos.

## Subir a GitHub

Ya está inicializado el repo git con commits. Solo falta conectarlo a tu remoto:

```bash
# 1. Creá un repo vacío en https://github.com/new (sin README)
# 2. Conectá y push (reemplazá TU-USUARIO y NOMBRE-REPO):
git remote add origin https://github.com/TU-USUARIO/NOMBRE-REPO.git
git branch -M main
git push -u origin main
```

Con HTTPS, GitHub pide un **Personal Access Token** (Settings → Developer settings → Tokens) como contraseña.

## Notas

- **Concurrencia**: si dos personas editan a la vez, el que guarda segundo recibe el cambio del otro y se sincroniza (control por número de versión). La app también refresca sola cada 15s.
- **Datos**: el tablero vive en Postgres, así que persiste entre reinicios. El botón **Export/Import** sigue disponible para backups en JSON.
- Para escalar a varios tableros privados por equipo/persona habría que extender el modelo (hoy es un único workspace compartido, que es lo pedido).
