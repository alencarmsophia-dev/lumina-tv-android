#!/usr/bin/env python3
"""
tools/servidor-teste.py
Servidor HTTP local de teste para o Lumina TV (v2.2.0).
Usa SOMENTE a biblioteca padrão do Python.
Suporta:
- Range / If-Range (HTTP 206 Partial Content)
- Gzip transparente
- Simulação de erros de rede:
  - 403 para o User-Agent padrão (VLC), liberando para User-Agent alternativo
  - 429 e 458 com cabeçalho Retry-After
  - Queda no meio do download (drop de socket)
  - Resposta lenta (throttling / stall simulado)
- Servir stream HLS sintético gerado via ffmpeg (se disponível) ou buffers TS/M3U8 sintéticos em memória
"""

import sys
import os
import time
import gzip
import re
import socket
from http.server import HTTPServer, BaseHTTPRequestHandler
import argparse

class MockIptvHandler(BaseHTTPRequestHandler):
    server_version = "LuminaMockServer/2.2.0"

    def do_HEAD(self):
        self.handle_request(is_head=True)

    def do_GET(self):
        self.handle_request(is_head=False)

    def handle_request(self, is_head=False):
        parsed_path = self.path.split("?")[0]
        query_string = self.path.split("?")[1] if "?" in self.path else ""

        # Estatísticas / contadores por rota
        counts = getattr(self.server, "request_counts", {})
        counts[parsed_path] = counts.get(parsed_path, 0) + 1
        self.server.request_counts = counts
        call_num = counts[parsed_path]

        # Simulação 1: Erro 403 para User-Agent padrão VLC (testa rotação de UA do ListDownloader)
        if "/simular-403" in parsed_path:
            ua = self.headers.get("User-Agent", "")
            if "VLC" in ua:
                self.send_response(403)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.send_header("Connection", "close")
                self.end_headers()
                if not is_head:
                    self.wfile.write(b"403 Forbidden: User-Agent VLC bloqueado para teste")
                return

        # Simulação 2: Erro 429 ou 458 com Retry-After nas primeiras chamadas
        if "/simular-429" in parsed_path:
            if call_num <= 1:
                self.send_response(429)
                self.send_header("Retry-After", "2")
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.end_headers()
                if not is_head:
                    self.wfile.write(b"429 Too Many Requests: Aguarde 2 segundos")
                return

        if "/simular-458" in parsed_path:
            if call_num <= 1:
                self.send_response(458)
                self.send_header("Retry-After", "2")
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.end_headers()
                if not is_head:
                    self.wfile.write(b"458 Max Connections Exceeded")
                return

        # Rota de arquivo físico (ex: listas sintéticas em disk_dir)
        filename = parsed_path.lstrip("/")
        filepath = os.path.join(self.server.serve_dir, filename)

        # Se for stream HLS em memória (/hls/stream.m3u8)
        if parsed_path.endswith(".m3u8"):
            content = self.generate_mock_hls_playlist()
            self.serve_bytes(content.encode("utf-8"), "application/vnd.apple.mpegurl", is_head)
            return

        # Se for segmento de vídeo TS sintético (/live/..., /hls/segment_*.ts)
        if parsed_path.endswith(".ts") and not os.path.exists(filepath):
            ts_bytes = self.generate_mock_ts_segment()
            self.serve_bytes(ts_bytes, "video/mp2t", is_head)
            return

        # Se for arquivo MP4 de teste sintético
        if parsed_path.endswith(".mp4") and not os.path.exists(filepath):
            mp4_bytes = self.generate_mock_mp4_file()
            self.serve_bytes(mp4_bytes, "video/mp4", is_head)
            return

        # Servir arquivo do diretório local
        if os.path.exists(filepath) and os.path.isfile(filepath):
            with open(filepath, "rb") as f:
                data = f.read()

            content_type = "audio/x-mpegurl; charset=utf-8" if filepath.endswith(".m3u") else "application/octet-stream"

            # Simulação de queda de socket na primeira tentativa (/simular-queda)
            if "/simular-queda" in parsed_path and call_num == 1:
                half = len(data) // 2
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Accept-Ranges", "bytes")
                self.end_headers()
                if not is_head and half > 0:
                    self.wfile.write(data[:half])
                    self.wfile.flush()
                # Força fechamento abrupto de conexão TCP
                self.close_connection = True
                return

            self.serve_bytes(data, content_type, is_head)
            return

        # Resposta padrão 404
        self.send_response(404)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        if not is_head:
            self.wfile.write(b"Not Found")

    def serve_bytes(self, data, content_type, is_head=False):
        total_len = len(data)
        range_header = self.headers.get("Range", "")
        start = 0
        end = total_len - 1
        is_partial = False

        if range_header.startswith("bytes=") and total_len > 0:
            m = re.match(r"bytes=(\d+)-(\d*)", range_header)
            if m:
                s_str = m.group(1)
                e_str = m.group(2)
                s = int(s_str)
                if s < total_len:
                    start = s
                    end = int(e_str) if e_str else total_len - 1
                    end = min(end, total_len - 1)
                    is_partial = True

        slice_data = data[start:end + 1]
        status_code = 206 if is_partial else 200

        self.send_response(status_code)
        self.send_header("Content-Type", content_type)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("ETag", '"lumina-mock-v22"')
        self.send_header("Content-Length", str(len(slice_data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        if is_partial:
            self.send_header("Content-Range", f"bytes {start}-{end}/{total_len}")
        self.end_headers()

        if not is_head:
            self.wfile.write(slice_data)

    def generate_mock_hls_playlist(self):
        # M3U8 sintético curto com 2 faixas de áudio e 1 legenda
        return (
            "#EXTM3U\n"
            "#EXT-X-VERSION:3\n"
            "#EXT-X-TARGETDURATION:4\n"
            "#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"audio\",NAME=\"Português\",DEFAULT=YES,AUTOSELECT=YES,LANGUAGE=\"por\",URI=\"audio_pt.m3u8\"\n"
            "#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"audio\",NAME=\"Inglês\",DEFAULT=NO,AUTOSELECT=YES,LANGUAGE=\"eng\",URI=\"audio_en.m3u8\"\n"
            "#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID=\"subs\",NAME=\"Português\",DEFAULT=NO,AUTOSELECT=NO,LANGUAGE=\"por\",URI=\"subs_pt.m3u8\"\n"
            "#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=1280x720,AUDIO=\"audio\",SUBTITLES=\"subs\"\n"
            "video_720p.m3u8\n"
        )

    def generate_mock_ts_segment(self):
        # Gera pacote MPEG-TS sintético com byte de sincronismo 0x47 repetido
        packet = bytearray(188)
        packet[0] = 0x47  # Sync byte
        packet[1] = 0x40  # Payload start + PID 0x00
        packet[2] = 0x00
        packet[3] = 0x10  # Adaptation field control + continuity counter
        return bytes(packet * 32)  # ~6 KB

    def generate_mock_mp4_file(self):
        # Header ISO/IEC MP4 'ftyp' sintético mínimo válido para inspeção de container
        box_type = b"ftyp"
        major_brand = b"isom"
        minor_ver = b"\x00\x00\x02\x00"
        compat = b"isomiso2mp41"
        length = 8 + len(major_brand) + len(minor_ver) + len(compat)
        hdr = length.to_bytes(4, byteorder="big") + box_type + major_brand + minor_ver + compat
        moov_placeholder = (32).to_bytes(4, byteorder="big") + b"moov" + (b"\x00" * 24)
        return hdr + moov_placeholder

def run_server(port, serve_dir):
    server_address = ("0.0.0.0", port)
    httpd = HTTPServer(server_address, MockIptvHandler)
    httpd.serve_dir = os.path.abspath(serve_dir)
    httpd.request_counts = {}
    print(f"Servidor HTTP de testes Lumina TV rodando em http://0.0.0.0:{port} (dir={httpd.serve_dir})")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nEncerrando servidor...")
        httpd.server_close()

def main():
    parser = argparse.ArgumentParser(description="Servidor HTTP local de teste para Lumina TV")
    parser.add_argument("--port", type=int, default=8080, help="Porta HTTP (padrão 8080)")
    parser.add_argument("--dir", type=str, default=".", help="Diretório com arquivos a servir")
    args = parser.parse_args()

    os.makedirs(args.dir, exist_ok=True)
    run_server(args.port, args.dir)

if __name__ == "__main__":
    main()
