"""Build print PDFs for Magistrate Wizard architecture diagrams and layman workflows."""

from __future__ import annotations

import html
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
DIAGRAMS = ROOT / "docs" / "diagrams"
LAYMAN = ROOT / "docs" / "workflows-layman"
ASSETS = DIAGRAMS / "assets"
PDF_DIR = LAYMAN / "pdf"
ARCH_PDF_DIR = DIAGRAMS / "pdf"

LAYMAN_FILES = [
    "00-how-to-read-these-guides.md",
    "01-getting-started.md",
    "02-court-assignment.md",
    "03-working-a-docket-matter.md",
    "04-hearings-parties-documents.md",
    "05-sharing-and-retained.md",
    "06-writing-a-judgment.md",
    "07-researching-case-law.md",
    "08-legislation-notes-codes.md",
    "09-admin-roster-and-library.md",
    "10-search-and-bookmarks.md",
]

DIAGRAM_FILES = [
    "01-system-context.md",
    "02-c4-containers.md",
    "03-application-layers.md",
    "04-erd-complete.md",
    "05-erd-court-docket.md",
    "06-erd-work-product.md",
    "07-erd-legal-library.md",
    "08-access-control.md",
    "09-user-journeys.md",
    "10-sequence-workflows.md",
]

HERO_FIGURES = [
    ("system-context.svg", "System context — people, the app, and Supabase"),
    ("three-path-access.svg", "Three paths onto a Docket Matter"),
    ("domain-map.svg", "Court cabinet, personal desk, shared library"),
    ("erd-overview.svg", "Entity map"),
    ("user-swimlanes.svg", "A sitting day versus an admin day"),
]


CSS = """
:root {
  --ink: #1e293b;
  --muted: #64748b;
  --navy: #1e40af;
  --rule: #e2e8f0;
}
* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  color: var(--ink);
  font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
  font-size: 11.5pt;
  line-height: 1.45;
}
.cover {
  page-break-after: always;
  min-height: 240mm;
  padding: 36mm 12mm 0;
}
.cover h1 {
  font-family: Georgia, "Times New Roman", serif;
  font-size: 32pt;
  color: var(--navy);
  margin: 0 0 12px;
  line-height: 1.15;
}
.cover .lede { font-size: 14pt; color: var(--muted); max-width: 140mm; }
.cover .meta { margin-top: 28mm; color: var(--muted); font-size: 10.5pt; }
.cover .rule { width: 48mm; height: 4px; background: #3b82f6; margin: 18px 0 22px; }
h1, h2, h3 {
  font-family: Georgia, "Times New Roman", serif;
  color: var(--navy);
  page-break-after: avoid;
}
h1 { font-size: 20pt; margin: 0 0 10px; }
h2 { font-size: 15pt; margin: 22px 0 8px; }
h3 { font-size: 12.5pt; margin: 16px 0 6px; }
p { margin: 0 0 10px; }
ul, ol { margin: 0 0 12px; padding-left: 22px; }
li { margin-bottom: 4px; }
table {
  width: 100%;
  border-collapse: collapse;
  margin: 0 0 14px;
  font-size: 10pt;
  page-break-inside: avoid;
}
th, td {
  border: 1px solid var(--rule);
  padding: 6px 8px;
  text-align: left;
  vertical-align: top;
}
th { background: #eff6ff; color: #1e3a5f; }
code {
  font-family: Consolas, "Courier New", monospace;
  font-size: 0.9em;
  background: #f1f5f9;
  padding: 1px 4px;
  border-radius: 3px;
}
pre {
  background: #0f172a;
  color: #e2e8f0;
  padding: 12px 14px;
  border-radius: 8px;
  font-size: 9pt;
  overflow: hidden;
  page-break-inside: avoid;
}
pre code { background: transparent; color: inherit; padding: 0; }
.chapter { page-break-before: always; }
.chapter:first-of-type { page-break-before: auto; }
.hero {
  page-break-inside: avoid;
  margin: 0 0 18px;
}
.hero img, .hero svg { width: 100%; height: auto; }
.hero figcaption {
  font-size: 9.5pt;
  color: var(--muted);
  margin-top: 6px;
}
.mermaid {
  page-break-inside: avoid;
  margin: 12px 0 16px;
}
blockquote {
  margin: 0 0 12px;
  padding: 8px 12px;
  border-left: 4px solid #3b82f6;
  background: #f8fafc;
  color: #334155;
}
hr { border: 0; border-top: 1px solid var(--rule); margin: 18px 0; }
"""


def md_inline(text: str) -> str:
    text = html.escape(text)
    text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', text)
    text = re.sub(r"`([^`]+)`", r"<code>\1</code>", text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<em>\1</em>", text)
    return text


def md_to_html(source: str) -> str:
    lines = source.replace("\r\n", "\n").split("\n")
    out: list[str] = []
    i = 0
    in_code = False
    code_lang = ""
    code_buf: list[str] = []
    in_ul = False
    in_ol = False
    in_table = False
    table_rows: list[list[str]] = []

    def close_lists() -> None:
        nonlocal in_ul, in_ol
        if in_ul:
            out.append("</ul>")
            in_ul = False
        if in_ol:
            out.append("</ol>")
            in_ol = False

    def flush_table() -> None:
        nonlocal in_table, table_rows
        if not table_rows:
            in_table = False
            return
        out.append("<table>")
        for idx, row in enumerate(table_rows):
            if idx == 1 and all(re.fullmatch(r":?-{3,}:?", c.strip()) for c in row):
                continue
            tag = "th" if idx == 0 else "td"
            cells = "".join(f"<{tag}>{md_inline(c.strip())}</{tag}>" for c in row)
            out.append(f"<tr>{cells}</tr>")
        out.append("</table>")
        table_rows = []
        in_table = False

    while i < len(lines):
        line = lines[i]
        if in_code:
            if line.startswith("```"):
                body = html.escape("\n".join(code_buf))
                if code_lang == "mermaid":
                    out.append(f'<div class="mermaid">{body}</div>')
                else:
                    out.append(f"<pre><code>{body}</code></pre>")
                in_code = False
                code_buf = []
                code_lang = ""
            else:
                code_buf.append(line)
            i += 1
            continue

        if line.startswith("```"):
            close_lists()
            flush_table()
            in_code = True
            code_lang = line[3:].strip()
            i += 1
            continue

        if line.startswith("|") and line.endswith("|"):
            close_lists()
            in_table = True
            table_rows.append([c for c in line.strip("|").split("|")])
            i += 1
            continue
        if in_table:
            flush_table()

        if not line.strip():
            close_lists()
            i += 1
            continue

        if line.startswith("# "):
            close_lists()
            out.append(f"<h1>{md_inline(line[2:].strip())}</h1>")
        elif line.startswith("## "):
            close_lists()
            out.append(f"<h2>{md_inline(line[3:].strip())}</h2>")
        elif line.startswith("### "):
            close_lists()
            out.append(f"<h3>{md_inline(line[4:].strip())}</h3>")
        elif re.match(r"^[-*] ", line):
            if in_ol:
                out.append("</ol>")
                in_ol = False
            if not in_ul:
                out.append("<ul>")
                in_ul = True
            out.append(f"<li>{md_inline(line[2:].strip())}</li>")
        elif re.match(r"^\d+\. ", line):
            if in_ul:
                out.append("</ul>")
                in_ul = False
            if not in_ol:
                out.append("<ol>")
                in_ol = True
            out.append(f"<li>{md_inline(re.sub(r'^\d+\. ', '', line).strip())}</li>")
        elif line.startswith("> "):
            close_lists()
            out.append(f"<blockquote>{md_inline(line[2:].strip())}</blockquote>")
        elif line.strip() == "---":
            close_lists()
            out.append("<hr/>")
        else:
            close_lists()
            out.append(f"<p>{md_inline(line.strip())}</p>")
        i += 1

    close_lists()
    flush_table()
    return "\n".join(out)


def svg_data_uri(path: Path) -> str:
    return "data:image/svg+xml;utf8," + html.escape(path.read_text(encoding="utf-8"))


def figures_html() -> str:
    chunks = ['<div class="chapter"><h1>Hero diagrams</h1>']
    for name, caption in HERO_FIGURES:
        svg = (ASSETS / name).read_text(encoding="utf-8")
        chunks.append(
            f'<figure class="hero">{svg}<figcaption>{html.escape(caption)}</figcaption></figure>'
        )
    chunks.append("</div>")
    return "\n".join(chunks)


def wrap_html(title: str, lede: str, body: str, include_heroes: bool) -> str:
    heroes = figures_html() if include_heroes else ""
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>{html.escape(title)}</title>
  <style>{CSS}</style>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
</head>
<body>
  <section class="cover">
    <div class="rule"></div>
    <h1>{html.escape(title)}</h1>
    <p class="lede">{html.escape(lede)}</p>
    <p class="meta">Magistrate Wizard<br/>
    Architecture as implemented (migrations 0001–0067)<br/>
    Court-anchored Docket · no admin bypass into private judicial content<br/>
    13 August 2026</p>
  </section>
  {heroes}
  {body}
  <script>
    mermaid.initialize({{ startOnLoad: true, theme: "neutral", securityLevel: "loose" }});
  </script>
</body>
</html>
"""


def concat_chapters(folder: Path, names: list[str]) -> str:
    parts: list[str] = []
    for name in names:
        text = (folder / name).read_text(encoding="utf-8")
        # Drop the first H1 from README-style files if duplicated; keep all.
        parts.append(f'<section class="chapter">{md_to_html(text)}</section>')
    return "\n".join(parts)


def write_html_pack() -> tuple[Path, Path]:
    PDF_DIR.mkdir(parents=True, exist_ok=True)
    ARCH_PDF_DIR.mkdir(parents=True, exist_ok=True)

    layman = wrap_html(
        "Magistrate Wizard workflows — plain language",
        "How magistrates, clerks, and administrators actually use the system. Written for a first-day colleague, not for the database.",
        concat_chapters(LAYMAN, LAYMAN_FILES),
        include_heroes=True,
    )
    arch = wrap_html(
        "Magistrate Wizard architecture diagrams",
        "C4 context, entity-relationship diagrams, access control, user journeys, and sequence workflows. Authority: Final Architecture Specification Revision 3 and live migrations.",
        concat_chapters(DIAGRAMS, DIAGRAM_FILES),
        include_heroes=True,
    )

    layman_html = PDF_DIR / "Magistrate-Wizard-Workflows-Plain-Language.html"
    arch_html = ARCH_PDF_DIR / "Magistrate-Wizard-Architecture-Diagrams.html"
    layman_html.write_text(layman, encoding="utf-8")
    arch_html.write_text(arch, encoding="utf-8")

    # Individual short workflow HTML (also printed)
    for name in LAYMAN_FILES:
        title = name.replace(".md", "").split("-", 1)[1].replace("-", " ").title()
        html_doc = wrap_html(
            f"Magistrate Wizard — {title}",
            "Plain-language workflow. See the collected pack for the full set.",
            f'<section class="chapter">{md_to_html((LAYMAN / name).read_text(encoding="utf-8"))}</section>',
            include_heroes=False,
        )
        (PDF_DIR / f"{name.replace('.md', '')}.html").write_text(html_doc, encoding="utf-8")
    return layman_html, arch_html


def print_pdfs(html_paths: list[Path]) -> None:
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        for html_path in html_paths:
            pdf_path = html_path.with_suffix(".pdf")
            page.goto(html_path.as_uri(), wait_until="networkidle", timeout=120000)
            page.wait_for_timeout(2500)
            page.pdf(
                path=str(pdf_path),
                format="A4",
                print_background=True,
                display_header_footer=True,
                header_template='<div style="font-size:9px; color:#64748b; width:100%; padding:0 16mm;">Magistrate Wizard</div>',
                footer_template='<div style="font-size:9px; color:#64748b; width:100%; padding:0 16mm; display:flex; justify-content:space-between;"><span>Magistrate Wizard</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
                margin={"top": "16mm", "bottom": "18mm", "left": "14mm", "right": "14mm"},
            )
            print(f"Wrote {pdf_path}")
        browser.close()


if __name__ == "__main__":
    layman_html, arch_html = write_html_pack()
    extras = sorted(p for p in PDF_DIR.glob("*.html") if p.name[0].isdigit())
    print_pdfs([layman_html, arch_html, *extras])
