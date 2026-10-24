import pathlib
import re

SRC = pathlib.Path("design/Phantasm-Web_Dashboard.html")
OUT = pathlib.Path("design/extracted")
OUT.mkdir(parents=True, exist_ok=True)

html = SRC.read_text(encoding="utf-8")
css = re.search(r"<style>(.*?)</style>", html, re.S)
if css is None:
    raise SystemExit("style block not found")
(OUT / "dashboard.css").write_text(css.group(1).strip() + "\n", encoding="utf-8")

start = html.index("var c=")
end = html.index("/*! Bundled license information")
(OUT / "app.min.js").write_text(html[start:end].strip() + "\n", encoding="utf-8")
print("css bytes:", len(css.group(1)), "| app bytes:", end - start)
