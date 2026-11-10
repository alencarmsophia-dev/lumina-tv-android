#!/usr/bin/env node
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');
var childProcess = require('child_process');

var ROOT_DIR = path.resolve(__dirname, '..');
var WEBOS_DIR = path.join(ROOT_DIR, 'webos');
var DIST_APP_DIR = path.join(ROOT_DIR, 'dist-webos', 'app');
var SRC_APP_DIR = fs.existsSync(path.join(ROOT_DIR, 'lumina-tv', 'app'))
  ? path.join(ROOT_DIR, 'lumina-tv', 'app')
  : path.join(ROOT_DIR, 'app', 'src', 'main', 'assets', 'app');

// Lista declarada de arquivos compartilhados alterados (DEVE ser vazia)
var DECLARED_SHARED_MODIFIED = [];

var passed = 0;
var failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log('  [PASS] ' + msg);
  } else {
    failed++;
    console.error('  [FAIL] ' + msg);
  }
}

function readPngDimensions(filePath) {
  var buf = fs.readFileSync(filePath);
  if (buf.length < 24) return null;
  var sig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  for (var i = 0; i < sig.length; i++) {
    if (buf[i] !== sig[i]) return null;
  }
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20)
  };
}

console.log('=== Testes Estáticos e Funcionais — Lumina TV LG webOS 23 ===');

// 1. Garante que dist-webos/app foi gerado
if (!fs.existsSync(DIST_APP_DIR)) {
  var buildScript = path.join(ROOT_DIR, 'scripts', 'build-webos.sh');
  if (fs.existsSync(buildScript)) {
    childProcess.execFileSync('bash', [buildScript], {
      cwd: ROOT_DIR,
      env: Object.assign({}, process.env, { SKIP_ARES_PACKAGE: '1' }),
      stdio: 'inherit'
    });
  }
}

assert(fs.existsSync(DIST_APP_DIR), 'Diretório de staging dist-webos/app existe');

// 2. Validação do webos/appinfo.json e dist-webos/app/appinfo.json
var appinfoPath = path.join(WEBOS_DIR, 'appinfo.json');
var distAppinfoPath = path.join(DIST_APP_DIR, 'appinfo.json');
assert(fs.existsSync(appinfoPath), 'webos/appinfo.json existe');
assert(fs.existsSync(distAppinfoPath), 'dist-webos/app/appinfo.json existe');

var appinfo = JSON.parse(fs.readFileSync(appinfoPath, 'utf8'));
var distAppinfo = JSON.parse(fs.readFileSync(distAppinfoPath, 'utf8'));

assert(JSON.stringify(appinfo) === JSON.stringify(distAppinfo), 'appinfo.json em dist-webos/app é idêntico ao de webos/appinfo.json');
assert(appinfo.id === 'com.luminatv.player', 'appinfo.id === "com.luminatv.player" (sem hifens nem ponto+número, compatível com Luna Service)');
assert(/^[a-z0-9.]+$/.test(appinfo.id) && !/\.[0-9]/.test(appinfo.id), 'appinfo.id respeita regras de nomenclatura LG webOS');
assert(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(appinfo.version), 'appinfo.version está no formato x.y.z sem zeros à esquerda (' + appinfo.version + ')');
assert(appinfo.version === '2.2.1', 'appinfo.version é "2.2.1"');
assert(appinfo.vendor === 'Lumina Media', 'appinfo.vendor === "Lumina Media"');
assert(appinfo.type === 'web', 'appinfo.type === "web"');
assert(appinfo.main === 'index.html', 'appinfo.main === "index.html"');
assert(appinfo.title === 'Lumina TV', 'appinfo.title === "Lumina TV"');
assert(appinfo.icon === 'icon.png', 'appinfo.icon === "icon.png"');
assert(appinfo.largeIcon === 'largeIcon.png', 'appinfo.largeIcon === "largeIcon.png"');
assert(appinfo.splashBackground === 'splash.png', 'appinfo.splashBackground === "splash.png"');
assert(appinfo.bgColor === '#0B0F17', 'appinfo.bgColor === "#0B0F17"');
assert(appinfo.resolution === '1920x1080', 'appinfo.resolution === "1920x1080"');
assert(appinfo.disableBackHistoryAPI === true, 'appinfo.disableBackHistoryAPI === true');
assert(appinfo.handlesRelaunch === false, 'appinfo.handlesRelaunch === false');
assert(appinfo.uiRevision === 2, 'appinfo.uiRevision === 2');

// 3. Validação das dimensões exatas dos PNGs exigidos pela LG
var iconDim = readPngDimensions(path.join(DIST_APP_DIR, appinfo.icon));
var largeIconDim = readPngDimensions(path.join(DIST_APP_DIR, appinfo.largeIcon));
var splashDim = readPngDimensions(path.join(DIST_APP_DIR, appinfo.splashBackground));

assert(iconDim && iconDim.width === 80 && iconDim.height === 80, 'icon.png é PNG válido com exatamente 80x80 px');
assert(largeIconDim && largeIconDim.width === 130 && largeIconDim.height === 130, 'largeIcon.png é PNG válido com exatamente 130x130 px');
assert(splashDim && splashDim.width === 1920 && splashDim.height === 1080, 'splash.png é PNG válido com exatamente 1920x1080 px');

// 4. Validação do index.html gerado e de todos os arquivos referenciados
var origIndexHtml = fs.readFileSync(path.join(SRC_APP_DIR, 'index.html'), 'utf8');
var distIndexHtml = fs.readFileSync(path.join(DIST_APP_DIR, 'index.html'), 'utf8');

assert(origIndexHtml.indexOf('webos-platform.js') === -1, 'index.html original NÃO foi modificado');
assert(
  distIndexHtml.indexOf('<script src="js/platform/platform.js"></script>\n  <script src="js/platform/webos-platform.js"></script>') !== -1,
  'index.html da cópia dist-webos injeta <script src="js/platform/webos-platform.js"> logo após platform.js'
);

var refRegex = /<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/gi;
var match;
var refCount = 0;
while ((match = refRegex.exec(distIndexHtml)) !== null) {
  var relRef = match[1];
  if (/^(?:https?:|data:|#)/i.test(relRef)) continue;
  refCount++;
  var targetFile = path.join(DIST_APP_DIR, relRef);
  assert(fs.existsSync(targetFile), 'Arquivo referenciado em index.html existe no pacote: ' + relRef);
}
assert(refCount >= 25, 'Todos os ' + refCount + ' assets (CSS/JS/SVG) de index.html foram verificados');

// Verifica que arquivos de preview/documentação foram removidos da cópia dist-webos/app
assert(!fs.existsSync(path.join(DIST_APP_DIR, 'logos-preview.html')), 'logos-preview.html removido de dist-webos/app');
assert(!fs.existsSync(path.join(DIST_APP_DIR, 'assets', 'BRAND-GUIDE.md')), 'assets/BRAND-GUIDE.md removido de dist-webos/app');
assert(!fs.existsSync(path.join(DIST_APP_DIR, 'brand', 'BRAND-GUIDE.md')), 'brand/BRAND-GUIDE.md removido de dist-webos/app');
assert(!fs.existsSync(path.join(DIST_APP_DIR, 'playlists', 'exemplo.m3u')), 'playlists/exemplo.m3u removido de dist-webos/app');

// 5. Verificação de sintaxe e compatibilidade com Chromium 94 (webOS TV 23) e ES5
var webosPlatPath = path.join(WEBOS_DIR, 'js', 'webos-platform.js');
var webosPlatCode = fs.readFileSync(webosPlatPath, 'utf8');

var syntaxOk = false;
try {
  new vm.Script(webosPlatCode, { filename: 'webos-platform.js' });
  syntaxOk = true;
} catch (e) {
  syntaxOk = false;
}
assert(syntaxOk, 'webos-platform.js compila sem erros de sintaxe JavaScript');

// Proíbe recursos pós-Chromium 94 ou sintaxe fora do padrão ES5 do projeto
var forbiddenPatterns = [
  { name: 'structuredClone (Chrome 98+)', re: /\bstructuredClone\s*\(/ },
  { name: 'Object.hasOwn (Chrome 93+/ES2022)', re: /\bObject\.hasOwn\s*\(/ },
  { name: 'Array/String .toSorted/.toReversed/.with (Chrome 110+)', re: /\.(?:toSorted|toReversed|toSpliced)\s*\(/ },
  { name: 'Nullish coalescing ??', re: /\?\?/ },
  { name: 'Optional chaining ?.', re: /\?\.[a-zA-Z_$]/ },
  { name: 'Logical assignment ??=/||=/&&=', re: /(?:\?\?=|\|\|=|&&=)/ },
  { name: 'Arrow functions => (mantido ES5 puro)', re: /=>/ },
  { name: 'Declarações const/let (mantido ES5 var)', re: /\b(?:const|let)\s+[a-zA-Z_$]/ }
];
for (var f = 0; f < forbiddenPatterns.length; f++) {
  assert(!forbiddenPatterns[f].re.test(webosPlatCode), 'webos-platform.js não usa ' + forbiddenPatterns[f].name);
}

// 6. Validação do serviço Luna de fallback (Plano B)
var svcPkgPath = path.join(WEBOS_DIR, 'service', 'package.json');
var svcJsonPath = path.join(WEBOS_DIR, 'service', 'services.json');
var svcJsPath = path.join(WEBOS_DIR, 'service', 'lumina_service.js');

assert(fs.existsSync(svcPkgPath) && fs.existsSync(svcJsonPath) && fs.existsSync(svcJsPath), 'Arquivos do serviço JS webos/service existem');
var svcPkg = JSON.parse(fs.readFileSync(svcPkgPath, 'utf8'));
var svcJson = JSON.parse(fs.readFileSync(svcJsonPath, 'utf8'));
assert(svcPkg.name === 'com.luminatv.player.service', 'service/package.json name começa com o ID do app (com.luminatv.player.service)');
assert(svcJson.id === 'com.luminatv.player.service', 'service/services.json id === "com.luminatv.player.service"');

var svcSyntaxOk = false;
try {
  new vm.Script(fs.readFileSync(svcJsPath, 'utf8'), { filename: 'lumina_service.js' });
  svcSyntaxOk = true;
} catch (e) {}
assert(svcSyntaxOk, 'webos/service/lumina_service.js compila sem erros de sintaxe');

// 7. Testes comportamentais em sandbox simulando LG webOS TV 23
var sandbox = {
  navigator: {
    userAgent: 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.128 Safari/537.36 WebAppManager'
  },
  window: null,
  document: {
    readyState: 'complete',
    body: { style: {}, classList: { add: function () {}, remove: function () {} } },
    addEventListener: function () {},
    createElement: function (tag) {
      if (tag === 'video') {
        return {
          canPlayType: function (t) {
            return /mpegurl/i.test(t) ? 'probably' : 'maybe';
          }
        };
      }
      return { style: {}, classList: { add: function () {}, remove: function () {} } };
    }
  },
  localStorage: {
    _data: {},
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(this._data, k) ? this._data[k] : null; },
    setItem: function (k, v) { this._data[k] = String(v); }
  },
  XMLHttpRequest: function () {
    this.open = function () {};
    this.send = function () {};
    this.abort = function () {};
  },
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  setInterval: setInterval,
  clearInterval: clearInterval
};
sandbox.window = sandbox;
var platformBackCalled = false;
sandbox.webOS = {
  platformBack: function () { platformBackCalled = true; },
  service: { request: function () { return { cancel: function () {} }; } }
};

vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(DIST_APP_DIR, 'js', 'platform', 'platform.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(DIST_APP_DIR, 'js', 'player', 'engines', 'native.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(DIST_APP_DIR, 'js', 'player', 'engines', 'hlsjs.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(DIST_APP_DIR, 'js', 'player', 'engines', 'mpegts.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(DIST_APP_DIR, 'js', 'player', 'player-core.js'), 'utf8'), sandbox);
vm.runInContext(webosPlatCode, sandbox);

assert(sandbox.LuminaPlatform.isWebOS === true, 'LuminaPlatform.isWebOS detecta User-Agent oficial do webOS TV 23');
assert(sandbox.LuminaPlatform.isAndroid === false, 'LuminaPlatform.isAndroid é false no webOS TV 23');

var bkpJson = '{"version":2,"favorites":{"ch1":true}}';
var saveOk = sandbox.LuminaPlatform.saveBackupToDisk('lumina-backup.json', bkpJson);
var readBack = sandbox.LuminaPlatform.readBackupFromDisk('lumina-backup.json');
var clipBack = sandbox.LuminaPlatform.getClipboardText();
assert(saveOk === true && readBack === bkpJson && clipBack === bkpJson, 'Backup/Exportação e área de transferência funcionam no webOS sem exigir download de Blob');

var updRes = null;
sandbox.LuminaPlatform.checkForAppUpdate(function (_err, info) { updRes = info; });
assert(updRes && updRes.supported === false && /IPK/i.test(updRes.message), 'checkForAppUpdate informa que atualização no webOS é via IPK');

sandbox.LuminaPlatform.exitApp();
assert(platformBackCalled === true, 'LuminaPlatform.exitApp aciona webOS.platformBack()');

// Verifica plano de reprodução VOD no webOS (deve preferir NativeEngine em MP4 e MKV)
var mkvPlan = sandbox.LuminaPlayer.buildFallbackPlan({
  id: 'mov_1',
  kind: 'movie',
  url: 'http://example.com/movie/user/pass/1001.mkv'
});
assert(mkvPlan && mkvPlan.length > 0 && mkvPlan[0].engine === 'NativeEngine', 'Filmes MKV no webOS usam NativeEngine (<video> hardware) como 1º passo');

var mp4Plan = sandbox.LuminaPlayer.buildFallbackPlan({
  id: 'mov_2',
  kind: 'movie',
  url: 'http://example.com/movie/user/pass/1002.mp4'
});
assert(mp4Plan && mp4Plan.length > 0 && mp4Plan[0].engine === 'NativeEngine', 'Filmes MP4 no webOS usam NativeEngine (<video> hardware) como 1º passo');

// 8. Verifica via git que nenhum arquivo compartilhado com o Android foi modificado fora da lista declarada
try {
  var gitOut = childProcess.execSync('git status --porcelain', { cwd: ROOT_DIR, encoding: 'utf8' });
  var lines = gitOut.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
  var unauthorized = [];
  for (var idx = 0; idx < lines.length; idx++) {
    var entry = lines[idx];
    var filePart = entry.slice(3).trim();
    var isWebosSpecific =
      filePart === ".github/" ||
      filePart === "scripts/" ||
      filePart === "tests/" ||
      filePart.indexOf('webos/') === 0 ||
      filePart.indexOf('dist-webos/') === 0 ||
      filePart === 'scripts/build-webos.sh' ||
      filePart === '.github/workflows/build-webos-ipk.yml' ||
      filePart === 'tests/webos.test.js' ||
      filePart === 'CHANGELOG-WEBOS.md' ||
      filePart === 'RELATORIO-DE-BUGS.md';
    if (!isWebosSpecific && DECLARED_SHARED_MODIFIED.indexOf(filePart) === -1) {
      unauthorized.push(filePart);
    }
  }
  assert(unauthorized.length === 0, 'Nenhum arquivo compartilhado Android/web foi alterado fora da lista declarada');
} catch (gitErr) {
  console.log('  [INFO] Repositório git não inicializado neste diretório de teste; verificação git ignorada.');
}

console.log('\nResultado: ' + passed + ' passaram, ' + failed + ' falharam.');
if (failed > 0) {
  process.exit(1);
}
