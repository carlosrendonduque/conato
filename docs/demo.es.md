# Recorrido guiado

Un paseo por lo que hace Conato, usando el corpus de dominio público que viene
incluido. Sirve para probar la herramienta y como escaleta para grabar.

Cada sección arranca del mismo estado limpio, así que puedes parar, repetir o
regrabar cualquier parte sin que la toma anterior deje rastro.

*(English version: [demo.md](demo.md))*

## Preparación, una sola vez

```bash
npm install
docker compose up -d
npm run db:migrate
npm run corpus:ingest -- --dir ./examples/demo-corpus --slug demo --name "Demo Corpus"
npm run dev
```

## Volver a empezar, entre tomas

```bash
npm run demo:reset
```

Borra todos los archivos del corpus `demo` —con sus versiones, invocaciones,
propuestas, candidatos y comentarios— y los reingesta desde disco. **Recarga el
navegador después**: el reset toca la base de datos, no lo que el editor tiene
en memoria.

Espera a ver `Done: 6 files · 6 indexed · 29 chunks` antes de recargar; tarda
unos segundos porque recalcula los embeddings.

No hace falta reiniciar el servidor, ni volver a entrar, ni tocar Docker.

Para un corpus propio:

```bash
npm run corpus:reset -- --dir /ruta/al/corpus --slug mi-obra
```

Esa forma pide confirmación antes de borrar. `demo:reset` pasa `--yes` porque
el corpus de demostración es desechable por definición.

---

## 1 · El editor

**Muestra:** Markdown WYSIWYG, y que la metadata no estorba mientras escribes.

1. Abre `quijote/capitulo_08.es.md`.
2. Señala el contador del header — **82 palabras** — y que la prosa empieza de
   inmediato. El archivo tiene seis líneas de frontmatter YAML (`title`,
   `kind`, `voice`, `act`, `order`, `lang`); ninguna está en pantalla.
3. Escribe una frase donde sea. El header pasa solo de *guardado* a
   *sin guardar* y de vuelta a *guardado*.
4. Usa **B**, **I** y **H2** de la barra. El Markdown es real; la sintaxis
   queda oculta.

**El punto:** estás editando un `.md` plano que cualquier otra herramienta
abre, pero nunca ves la puntuación de Markdown mientras escribes.

---

## 2 · Las cinco operaciones

**Muestra:** el ciclo central — selección, operación, propuesta.

1. Selecciona `—¿Qué gigantes? —dijo Sancho Panza.`
2. Pon la operación en **expand** y pulsa **invocar**.
3. Aparece una propuesta a la derecha, etiquetada con la operación y el modelo
   que la produjo.

Todas tienen la misma forma:

| Operación | Necesita | Hace |
|---|---|---|
| `expand` | selección | más largo, misma voz y registro |
| `contract` | selección | más corto, sin perder lo esencial |
| `rewrite` | selección | de otra manera — sin decir que sea mejor |
| `continue` | cursor, sin selección | sigue desde donde está el cursor |
| `free_prompt` | cualquiera | lo que le pidas |

No existe "mejorar". Mejorar implica que el modelo juzgue qué es mejor, y ese
es tu trabajo. Si quieres una mejora concreta, pídela con `free_prompt`.

**Vale la pena decirlo en cámara:** el modelo nunca escribe sobre el archivo.
Todo lo que devuelve es una propuesta.

---

## 3 · Aceptar, descartar, guardar

**Muestra:** qué pasa con una propuesta después.

1. Con una propuesta en pantalla, pulsa **aceptar**. Aparece el diff: lo que
   sale en rojo, lo que entra en verde.
2. Confirma. El texto aterriza en el editor, exactamente sobre las palabras que
   habías seleccionado, y queda registrada una versión.
3. Invoca otra vez sobre la misma selección y pulsa **descartar**. Desaparece.
4. Invoca una tercera vez y pulsa **guardar como candidato**. Cambia de archivo
   y vuelve: el candidato sigue ahí. Las propuestas son de la sesión; los
   candidatos persisten.

---

## 4 · Comparar modelos

**Muestra:** por qué el panel acumula en vez de reemplazar.

1. Selecciona una frase, elige **rewrite**, invoca con **Claude Opus 5**.
2. Sin tocar la selección, cambia el modelo a **Claude Sonnet 5** e invoca de
   nuevo.
3. Ahora las dos respuestas están en el panel, cada una con su modelo. Léelas
   una al lado de la otra y acepta una.

**El punto:** una invocación a la vez, por decisión. Mandar el mismo prompt a
todos los modelos de golpe produce cuatro respuestas que comparar y ninguna
razón para preferir alguna. El flujo de Conato es: pide, lee, y solo vuelve a
pedir si la primera no te sirvió.

---

## 5 · El contexto

**Muestra:** por qué las propuestas encajan con la obra en vez de sonar
genéricas.

1. Abre `meta/canon-manifest.md`. Lista tres rutas.
2. Abre `meta/canon.es.md` y lee las reglas de voz: *"Don Quijote habla en
   registro elevado; Sancho, en registro llano. Ese contraste no se suaviza."*
3. Vuelve a un capítulo, selecciona una línea de Sancho y haz **expand**.

La propuesta conserva el registro llano y refranero de Sancho, porque al modelo
le llegaron tres cosas automáticamente: cada documento que lista el manifiesto,
inyectado entero; fragmentos del resto del corpus recuperados por similitud; y
el archivo completo que estás editando.

Editar el manifiesto cambia qué cuenta como canon en la siguiente invocación.
Es dato del corpus, no configuración.

---

## 6 · Versiones y comentarios

**Muestra:** que no se pierde nada.

1. Abre el menú **⋮** del header y entra al histórico. Cada guardado está ahí.
2. Marca uno como hito con una etiqueta. Destaca en la lista.
3. Restaura una versión anterior. El texto vuelve atrás.
4. Selecciona una frase y añade un comentario — *"verificar esta cita"*. Queda
   anclado al texto y vive en el panel de comentarios.

Los comentarios son notas privadas tuyas. El modelo no las ve.

---

## Notas de grabación

- Corre `npm run demo:reset` y recarga antes de cada toma.
- Las invocaciones tardan unos segundos. O dejas la espera —es honesto sobre
  cómo se siente usar esto— o cortas en el clic del botón.
- Cada sección se sostiene sola, así que pueden ser clips cortos separados en
  vez de un vídeo largo.
