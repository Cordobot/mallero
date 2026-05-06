# 📅 Mallero - Gestor de Horarios

Mallero es una herramienta web híbrida para la gestión de turnos laborales. Permite cargar horarios mediante OCR (capturas de pantalla) o pegando datos directamente desde Excel, ofreciendo persistencia local y recordatorios automáticos por WhatsApp.

## 🚀 Funcionalidades Principales
- **Entrada Dual**: OCR avanzado para leer capturas de malla y pegado TSV de Excel 100% fiable.
- **Edición Inline**: Modifica cualquier celda directamente en la tabla y guarda los cambios.
- **Resaltado Inteligente**: Indica visualmente el turno actual, el próximo turno y el día de hoy.
- **Automatización**: Envío automático de recordatorio por WhatsApp a las 10:00 PM del día anterior al turno.
- **Diseño Premium**: Interfaz moderna con glassmorphism, animaciones fluidas y modo oscuro.

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
- `main.js`: Lógica de procesamiento de datos, OCR y alarmas.
- `style.css`: Estilos premium y animaciones.
- `favicon.png`: Icono de la aplicación.

---
*Desarrollado por Adrián Alvarez.*
