# Trac3R project page

Static site, no build step. Preview: `python3 -m http.server 8000`, then open <http://localhost:8000>.

## Launch checklist (together with arXiv)
1. `grep -n LAUNCH index.html` and resolve each item (noindex, links, og:image, video, BibTeX).
2. Make the repository public.
3. Settings > Pages > Deploy from a branch > `main`, `/ (root)`.
