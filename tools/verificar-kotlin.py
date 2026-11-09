#!/usr/bin/env python3
"""Verificação rápida de Kotlin, sem compilar (só biblioteca padrão do Python).

Pega dois erros que já derrubaram um build:
  1) texto de aspas simples ("...") quebrado em várias linhas;
  2) classe comum do Android/Java usada sem o import correspondente.

Uso: python3 tools/verificar-kotlin.py [pasta]   (padrão: app/src/main/java)
Sai com código 1 se achar algo. Para adicionar uma classe à checagem, edite KNOWN.
"""
import pathlib
import re
import sys

KNOWN = {
    "android.util": ["Log"],
    "android.widget": ["ScrollView", "Button", "Toast", "TextView", "LinearLayout",
                       "FrameLayout", "ImageView", "ProgressBar", "EditText"],
    "android.graphics": ["Typeface", "Color", "Bitmap"],
    "android.content": ["ClipData", "ClipboardManager", "Context", "Intent", "SharedPreferences"],
    "android.os": ["Build", "Bundle", "Handler", "Looper", "SystemClock"],
    "android.net": ["Uri"],
    "android.view": ["View", "ViewGroup", "Gravity", "KeyEvent", "MotionEvent", "WindowManager"],
    "java.util": ["Locale", "Date"],
    "java.util.concurrent": ["Executors", "TimeUnit", "ConcurrentHashMap"],
    "java.text": ["SimpleDateFormat"],
    "java.io": ["File", "InputStream", "FileOutputStream", "ByteArrayInputStream", "IOException"],
    "java.net": ["URL", "HttpURLConnection"],
    "java.security": ["MessageDigest"],
    "org.json": ["JSONObject", "JSONArray"],
}
CLASS_PKG = {c: p for p, cs in KNOWN.items() for c in cs}


def strip_code(text):
    """Devolve (código sem strings/comentários, lista de erros de string quebrada)."""
    n = len(text)
    out = [" "] * n
    errors = []

    def line_of(idx):
        return text.count("\n", 0, idx) + 1

    def scan_string(i):
        start = i - 1
        while i < n:
            c = text[i]
            if c == "\\":
                i += 2
            elif c == '"':
                return i + 1
            elif c == "\n":
                errors.append(line_of(start))
                return i
            elif c == "$" and text.startswith("{", i + 1):
                i = scan_code(i + 2, True)
            else:
                i += 1
        return i

    def scan_code(i, in_tpl=False):
        depth = 0
        while i < n:
            c = text[i]
            if c == "\n":
                out[i] = "\n"
                i += 1
            elif text.startswith("//", i):
                while i < n and text[i] != "\n":
                    i += 1
            elif text.startswith("/*", i):
                end = text.find("*/", i + 2)
                end = n if end < 0 else end + 2
                for k in range(i, end):
                    if text[k] == "\n":
                        out[k] = "\n"
                i = end
            elif text.startswith('"""', i):
                j = i + 3
                while j < n and not text.startswith('"""', j):
                    if text[j] == "\n":
                        out[j] = "\n"
                    j += 1
                while j < n and text.startswith('"""', j) and text.startswith('"', j + 3):
                    j += 1
                i = j + 3
            elif c == '"':
                i = scan_string(i + 1)
            elif c == "'":
                m = re.match(r"'(\\.[^']{0,6}|[^\\'])'", text[i:i + 10])
                if m:
                    i += m.end()
                else:
                    out[i] = c
                    i += 1
            elif c == "{":
                depth += 1
                out[i] = c
                i += 1
            elif c == "}":
                if in_tpl and depth == 0:
                    return i + 1
                depth -= 1
                out[i] = c
                i += 1
            else:
                out[i] = c
                i += 1
        return i

    scan_code(0)
    return "".join(out), errors


def check_file(path):
    problems = []
    text = path.read_text(encoding="utf-8")
    code, bad_strings = strip_code(text)
    for ln in bad_strings:
        problems.append(f"{path}:{ln}: texto entre aspas quebrado em várias linhas "
                        f'(use \\n dentro de "..." ou aspas triplas """...""")')
    if bad_strings:  # o resto do arquivo está desalinhado; corrija as aspas primeiro
        return problems
    imports = set(re.findall(r"^\s*import\s+([\w.*]+)", text, re.M))
    simple = {i.split(".")[-1] for i in imports}
    wild = {i[:-2] for i in imports if i.endswith(".*")}
    body = re.sub(r"^[ \t]*(import|package)[ \t].*$", "", code, flags=re.M)
    declared = set(re.findall(r"\b(?:class|object|interface)\s+(\w+)", body))
    for cls, pkg in sorted(CLASS_PKG.items()):
        if cls in simple or pkg in wild or cls in declared:
            continue
        m = re.search(r"(?<![\w.])" + cls + r"\b(?!\s*=[^=])", body)
        if m:
            ln = body.count("\n", 0, m.start()) + 1
            problems.append(f"{path}:{ln}: '{cls}' usado sem import -> import {pkg}.{cls}")
    return problems


def main():
    root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "app/src/main/java")
    files = sorted(root.rglob("*.kt"))
    if not files:
        print(f"Nenhum .kt encontrado em {root}")
        return 1
    problems = [p for f in files for p in check_file(f)]
    for p in problems:
        print("ERRO:", p)
    print(f"{len(files)} arquivo(s) verificado(s), {len(problems)} problema(s).")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
