#!/usr/bin/env python3
"""
tools/gerar-lista-teste.py
Gera listas M3U sintéticas para testes do Lumina TV (v2.2.1).
Usa SOMENTE a biblioteca padrão do Python.
PROIBIDO o uso de dados, listas, servidores ou credenciais reais de terceiros.
Todas as URLs apontam para http://10.0.2.2:8080 (servidor de teste local acessível pelo emulador Android).
"""

import sys
import argparse
import random

LIVE_GROUPS = [
    "Canais | Abertos HD",
    "Esportes ⚽ Ao Vivo",
    "Notícias 24h & Mundo",
    "Documentários & Ciência",
    "Infantil & Desenhos",
    "Adulto +18 Canais XXX"
]

MOVIE_GROUPS = [
    "Filmes | Lançamentos 2025 🎬",
    "Filmes | Ação & Aventura [4K]",
    "Filmes | Comédia, Romance & Drama",
    "Filmes | Ficção Científica & Fantasia",
    "Filmes | Terror & Suspense",
    "Filmes | Clássicos Premiados",
    "Filmes | Adulto XXX +18"
]

SERIES_GROUPS = [
    "Séries | Originais Lumina 🔥",
    "Séries | Drama & Investigação",
    "Novelas | Nacionais & Históricas",
    "Séries | Animes & Geek"
]

TITLE_WORDS_A = [
    "Operação", "Crônicas", "Império", "Coração", "Horizonte", "Segredo",
    "Guardiões", "Lenda", "Noite", "Estrela", "Conexão", "Vingança",
    "Destino", "Fronteira", "Tempestade", "Aventura", "Mistério", "Cidade"
]

TITLE_WORDS_B = [
    "do Amanhã", "da Amazônia", "de Fogo, Sangue e Honra", "Implacável",
    "Proibido", "Invisível", "Selvagem", "dos Mares", "Sem Volta",
    "Especial 🔥", "Supremo", "do Sertão", "Eterno", "Final"
]

def generate_entry(idx, total_items, rng):
    mod100 = idx % 100
    eol = "\r\n" if (idx % 3 == 0) else "\n"
    word_a = TITLE_WORDS_A[idx % len(TITLE_WORDS_A)]
    word_b = TITLE_WORDS_B[(idx * 7) % len(TITLE_WORDS_B)]
    lines = []

    # Diretivas adicionais esporádicas para exercitar o parser
    if idx % 250 == 10:
        lines.append("#EXTVLCOPT:http-user-agent=VLC/3.0.20 LibVLC/3.0.20")
    if idx % 500 == 25:
        lines.append("#EXTVLCOPT:http-referrer=http://10.0.2.2:8080/ref")

    if mod100 < 20:
        # 20% Canais Ao Vivo
        is_adult = (mod100 == 19)
        grp = LIVE_GROUPS[5] if is_adult else LIVE_GROUPS[idx % 5]
        tvg_id = "dup.channel.id" if (idx % 50 == 0) else f"ch.{idx}"
        # Alguns itens com campos vazios intencionais
        logo_field = f' tvg-logo="http://10.0.2.2:8080/img/ch/{idx % 500}.png"' if (idx % 7 != 0) else ''
        qual = "[FHD]" if (idx % 2 == 0) else "HD"
        title = f"Canal {word_a} {qual} #{idx}"
        lines.append(f'#EXTINF:-1 tvg-id="{tvg_id}"{logo_field} group-title="{grp}",{title}')
        if idx % 400 == 5:
            lines.append(f"#EXTGRP:{grp}")
        lines.append(f"http://10.0.2.2:8080/live/teste_user/TestePass123/{100000 + idx}.ts")
    elif mod100 < 80:
        # 60% Filmes
        is_adult = (mod100 == 79)
        grp = MOVIE_GROUPS[6] if is_adult else MOVIE_GROUPS[idx % 6]
        year = 1995 + (idx % 31)
        audio = "[LEG]" if (idx % 4 == 0) else "[DUB]"
        qual = "[4K]" if (idx % 3 == 0) else "[FHD]"
        title = f"{word_a} {word_b} {idx} ({year}) {qual} {audio}"
        lines.append(f'#EXTINF:-1 tvg-id="mv.{idx}" tvg-logo="http://10.0.2.2:8080/img/mv/{idx % 1000}.jpg" group-title="{grp}",{title}')
        lines.append(f"http://10.0.2.2:8080/movie/teste_user/TestePass123/{500000 + idx}.mp4")
    else:
        # 20% Séries e Episódios (distribuídos em ~6% de séries)
        num_series = max(1, int(total_items * 0.06))
        series_idx = ((idx // 100) * 20 + (mod100 - 80)) % num_series + 1
        grp = SERIES_GROUPS[series_idx % len(SERIES_GROUPS)]
        is_novela = "Novelas" in grp
        season_num = ((idx // 100) % 3) + 1
        ep_num = (idx % 20) + 1
        pat = idx % 3
        if pat == 0:
            se_tag = f"S0{season_num}E{ep_num:02d}"
        elif pat == 1:
            se_tag = f"T{season_num} E{ep_num}"
        else:
            se_tag = f"{season_num}x{ep_num:02d}"
        show_base = ("Novela " if is_novela else "Série ") + TITLE_WORDS_A[series_idx % len(TITLE_WORDS_A)] + f" {series_idx}"
        title = f"{show_base} {se_tag} (2024) [FHD] [DUB]"
        lines.append(f'#EXTINF:-1 tvg-id="sr.{series_idx}" tvg-logo="http://10.0.2.2:8080/img/sr/{series_idx}.jpg" group-title="{grp}",{title}')
        lines.append(f"http://10.0.2.2:8080/series/teste_user/TestePass123/{900000 + idx}.mp4")

    return eol.join(lines) + eol

def generate_list(total_items, output_file, seed=42):
    rng = random.Random(seed)
    with open(output_file, "w", encoding="utf-8", newline="") as f:
        # Cabeçalho padrão com diretiva EPG sintética
        f.write('\ufeff#EXTM3U url-tvg="http://10.0.2.2:8080/epg.xml"\r\n')
        for i in range(total_items):
            entry = generate_entry(i, total_items, rng)
            f.write(entry)

def main():
    parser = argparse.ArgumentParser(description="Gerador de listas M3U sintéticas para testes do Lumina TV")
    parser.add_argument("--count", type=int, default=1000, choices=[1000, 50000, 300000, 1000000],
                        help="Quantidade de itens (1000, 50000, 300000, 1000000)")
    parser.add_argument("--out", type=str, required=True, help="Arquivo de saída (.m3u)")
    parser.add_argument("--seed", type=int, default=42, help="Semente determinística PRNG")
    args = parser.parse_args()

    print(f"Gerando lista sintética com {args.count} itens para {args.out} (seed={args.seed})...")
    generate_list(args.count, args.out, args.seed)
    print(f"Concluído! Arquivo gerado com sucesso: {args.out}")

if __name__ == "__main__":
    main()
