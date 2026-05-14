# Despliegue rápido

## En GitHub

Sube el contenido completo de esta carpeta, no el ZIP.

Debe verse así:

```text
assets/
index.html
main.css
main.js
vercel.json
README.md
README_DEPLOY.md
```

## En Vercel

- Framework Preset: Other / Static
- Root Directory: ./
- Build Command: dejar vacío
- Output Directory: dejar vacío
- Install Command: dejar vacío

Si Vercel no te deja vacíos los campos, usa:

- Build Command: `echo "static deploy"`
- Output Directory: `.`
