# 📅 Mallero - Gestor de Horarios

Mallero es una herramienta web para la gestión de turnos laborales. Subes el Excel de la malla semanal, escribes tu cédula y la app toma tus horarios (fecha, día, entrada, almuerzo, breaks y salida) y programa las alarmas.

## 🚀 Funcionalidades Principales
- **Carga directa del Excel**: Arrastra el `.xlsx` de la malla y Mallero busca tu fila por cédula. El archivo se lee solo en el navegador (SheetJS) y no se sube a ningún servidor.
- **Respaldo**: OCR de capturas de pantalla y pegado de texto desde Excel, en "Otras opciones".
- **Edición Inline**: Modifica cualquier celda directamente en la tabla y guarda los cambios. Varios breaks en un día se separan con `/` (ej: `13:45/18:45`).
- **Alarmas en la página**: Aviso con sonido y notificación para entrada, salida y regreso de almuerzo, cada break, salida y un recordatorio a las 10:00 PM del día anterior. Puedes elegir qué alarmas activar y cuántos minutos antes avisar. Solo suenan con la pestaña abierta.
- **Exportar a calendario (.ics)**: Descarga todos los eventos de la semana con su alarma para importarlos en Google Calendar, Outlook o el calendario del celular, y que suenen aunque cierres el navegador.
- **WhatsApp**: Desde el aviso de alarma puedes enviarte el recordatorio a tu número (configurable).
- **Resaltado Inteligente**: Indica visualmente el turno actual, el próximo turno y el día de hoy, con cuenta regresiva al próximo evento.

## 📄 Formato esperado del Excel
La hoja debe tener una fila de encabezados con la columna `Cedula`. Encima de ella van:
- Dos filas arriba: el nombre de cada día (`Lunes` … `Domingo`) sobre su bloque, y el grupo `Break`.
- Una fila arriba: la fecha de cada día.

Cada día tiene las columnas `Hora Inicio`, `Inter Ini`, `Inter Fin` y `Hora Fin`; el grupo `Break` tiene una columna por día. Un día sin horas se toma como descanso. Las columnas se ubican por su encabezado, así que no importa en qué letra queden.

> ⚠️ Las mallas reales contienen datos de otras personas. El `.gitignore` excluye los archivos `.xlsx` para que no se suban al repositorio.

---

## 🛠️ Guía de Publicación (GitHub Desktop)

Si quieres subir este proyecto a tu perfil de GitHub usando la aplicación oficial:

1. **Abrir GitHub Desktop**: Si no lo tienes, descárgalo e inicia sesión.
2. **Agregar Repositorio Local**:
   - Ve a `File` > `Add Local Repository`.
   - Busca la carpeta `c:\Desarrollo\Paginas_Web\Mallero`.
   - Si no es un repositorio aún, la app te preguntará si quieres crearlo (`Create a repository here`). Haz clic en sí.
3. **Primer Commit**:
   - Verás todos los archivos en la lista de la izquierda.
   - En el cuadro inferior escribe un resumen como `Initial commit` y haz clic en **Commit to main**.
4. **Publicar en GitHub**:
   - Haz clic en el botón superior que dice **Publish repository**.
   - Ponle el nombre "Mallero" y decide si quieres que sea privado o público.
   - ¡Listo! Tu código ya está en la nube.

---

## 🌐 Guía de Despliegue (Vercel)

Para que tu aplicación esté disponible en internet (ej: `mallero.vercel.app`):

1. **Entrar a [Vercel.com](https://vercel.com)** e inicia sesión con tu cuenta de GitHub.
2. **Importar Proyecto**:
   - Haz clic en el botón **Add New** > **Project**.
   - Busca tu repositorio llamado `Mallero` y dale a **Import**.
3. **Configuración**:
   - Vercel detectará automáticamente que es un proyecto HTML/JS estático. No necesitas cambiar nada en "Framework Preset".
4. **Deploy**:
   - Haz clic en **Deploy**.
   - En menos de un minuto tendrás una URL pública para acceder a tu Mallero desde cualquier dispositivo.

---

## 📂 Estructura del Proyecto
- `index.html`: Estructura y diseño base.
- `main.js`: Lectura del Excel, OCR, alarmas y exportación a calendario.
- `style.css`: Estilos premium y animaciones.
- `favicon.png`: Icono de la aplicación.

---
© 2026 Adrián Alvarez. Todos los derechos reservados.
