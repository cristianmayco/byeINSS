# 🔒 Segurança & Modelo de Ameaça — byeINSS

Este documento descreve **o que o byeINSS faz e o que NÃO faz** com os dados do usuário, para que você possa distribuir o app com confiança.

## ✅ O que o app FAZ

- Roda **100% local**. Sem servidor externo, sem telemetria, sem analytics.
- Persiste dados em **SQLite local** (`byeinss.db` na sua pasta de dados do usuário).
- Quando você usa o **Login embutido no Investidor10**:
  - Abre um navegador isolado dentro do app (Electron `BrowserWindow` com `partition: 'persist:investidor10'`).
  - Os cookies/sessão ficam **apenas** nesse perfil isolado dentro do `userData` do Electron.
  - O app lê o DOM (HTML visível) dessa janela para extrair os números da sua carteira.
  - Esses dados vão para o SQLite local.
  - Em nenhum momento são enviados para a internet.
- Permite **navegação externa** apenas para domínios permitidos (`investidor10.com.br`). Qualquer outro link abre no browser do sistema, não dentro do app.
- Lê o JSON que você cola manualmente (modo offline).

## ❌ O que o app NÃO faz

- **Não envia nada para a internet.** Nenhuma requisição de telemetria, nenhum analytics, nenhum erro reportado.
- **Não armazena sua senha do Investidor10.** O login é feito dentro do navegador embutido; a senha fica em cookies criptografados pelo próprio Electron (Chromium) no seu disco. O app não tem acesso a ela.
- **Não expõe a API local para a rede.** O Express escuta apenas em `127.0.0.1` (loopback), nunca em `0.0.0.0`. Outros dispositivos na sua rede não conseguem acessar.
- **Não modifica o seu Chrome do sistema.** O perfil de login fica em `~/.config/byeinss/` (ou `%APPDATA%/byeinss/` no Windows), separado do Chrome.
- **Validação rigorosa de inputs em todas as rotas.** Os endpoints do PRD 12 (vencimento de contratos) aplicam regex estrito no `:ticker` (`^[A-Z]{4}11$` ou `^[A-Z]{4}[0-9]$`), allowlist de campos mutáveis no `PUT`, prepared statements em todos os SQL e mensagens de erro genéricas (não vazam SQL paths). Ver `src/server/routes/contratos.js` + `src/shared/contratos.js`.
- **Não abre arquivos locais automaticamente.** Você escolhe o que importa.

## 🛡️ Checklist de segurança para distribuição

Antes de distribuir uma build:

- [ ] Verifique que o `package.json` não tem scripts de pós-instalação enviando dados.
- [ ] Verifique que `src/main/main.js` escuta em `127.0.0.1`, não `0.0.0.0`.
- [ ] Verifique que `src/main/scraper.js` só abre `investidor10.com.br` (ou o que você configurou).
- [ ] Forneça o código-fonte ou um link para ele no README.
- [ ] Assine o binário (recomendado para macOS/Windows; Linux pode usar GPG).
- [ ] Publique hashes SHA256 junto com os instaladores.

## 📦 Como gerar instaladores para distribuição

```bash
# 1. Instalar dependências
npm install

# 2. (Linux) buildar AppImage + .deb
npm run build:linux
# → dist/byeINSS-1.0.0.AppImage
# → dist/byeinss_1.0.0_amd64.deb

# 3. (Windows) buildar NSIS installer + portable
npm run build:win
# → dist/byeINSS Setup 1.0.0.exe
# → dist/byeINSS 1.0.0.exe (portable)

# 4. (macOS) buildar DMG
npm run build:mac
# → dist/byeINSS-1.0.0.dmg
```

Para suportar Windows/macOS você precisa estar **rodando nesses sistemas** (ou usar CI como GitHub Actions).

## 🔄 Atualizações

Sugestão: usar [electron-updater](https://www.electron.build/auto-update) com feeds do GitHub Releases. Não incluído no MVP.

## 📋 Versões suportadas

- **Linux:** Ubuntu 22.04+, Debian 12+, Fedora 38+ (x86_64 e arm64)
- **Windows:** Windows 10+, Windows Server 2019+ (x86_64)
- **macOS:** macOS 11+ (Big Sur), Intel e Apple Silicon
