# Servidores móveis de inferência do Zeus

A implantação é dividida em fases para evitar expor um servidor de modelo sem autenticação.

## Fase 1 — Note20 5G

Preparação e teste do servidor local no Samsung Galaxy Note20 5G.

- [Guia de instalação e validação](note20/README.md)
- [Instalador de dependências, compilação e modelo](note20/install.sh)
- [Inicializar o servidor local](note20/start.sh)
- [Teste de saúde e geração](note20/test.sh)
- [Encerrar o servidor](note20/stop.sh)

**Limite atual:** o endpoint escuta apenas em `127.0.0.1:8080`. Não está conectado ao Render e não deve ser exposto à rede. Primeiro valide a execução no aparelho; depois será implementada a ponte remota autenticada e criptografada.

## Fase 2 — Galaxy J8

Será preparado separadamente após validar o Note20, com modelo e parâmetros ajustados aos recursos reais do J8.

## Fase 3 — Integração com Zeus API

A API do Render será conectada aos dispositivos por uma ponte autenticada de saída, com controle de disponibilidade, timeout, seleção de dispositivo e fallback. Nenhum celular será publicado diretamente na internet.
