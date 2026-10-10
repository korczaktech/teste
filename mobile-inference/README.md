# Servidores móveis de inferência do Zeus

A implantação é dividida em fases para evitar expor um servidor de modelo sem autenticação.

## Fase 1 — Note20 5G

Preparação e teste do servidor local no Samsung Galaxy Note20 5G.

- [Guia de instalação e validação](note20/README.md)
- [Instalador de dependências, compilação e modelo](note20/install.sh)
- [Inicializar o servidor local](note20/start.sh)
- [Teste de saúde e geração](note20/test.sh)
- [Encerrar o servidor](note20/stop.sh)

O teste inicial com cinco requisições foi concluído sem erros de transporte; a qualidade do modelo 0.5B foi considerada insuficiente para uso real. O modelo maior será avaliado separadamente.

## Fase 2 — Galaxy J8 com Qwen2.5 1.5B

Configuração separada para o Samsung Galaxy J8, usando Qwen2.5-1.5B-Instruct GGUF Q4_K_M (arquivo de aproximadamente 1,12 GB), contexto conservador e wakelock para ajudar a manter a CPU ativa com a tela apagada.

- [Guia de instalação, teste com tela apagada e critérios de aceite](j8/README.md)
- [Instalador de dependências, compilação e modelo](j8/install.sh)
- [Inicializar o servidor local](j8/start.sh)
- [Teste de saúde e geração](j8/test.sh)
- [Encerrar o servidor e liberar wakelock](j8/stop.sh)

A execução em segundo plano precisa ser testada no próprio aparelho; o wakelock não garante que todas as versões do Android ou fabricantes mantenham o processo ativo.

## Fase 3 — Integração com Zeus API

A API do Render será conectada aos dispositivos por uma ponte autenticada de saída, com controle de disponibilidade, timeout, seleção de dispositivo e fallback. Nenhum celular será publicado diretamente na internet.

**Segurança em todas as fases:** o endpoint local deve escutar somente em `127.0.0.1:8080`. Não exponha a porta à rede nem altere a configuração para `0.0.0.0`. A integração com o Render ainda não está implementada.
