# Fase 1 — Samsung Galaxy Note20 5G como servidor local de inferência

Esta fase prepara o Note20 para executar um modelo GGUF localmente com `llama.cpp`. Ela **não altera a API do Zeus nem conecta o celular ao Render ainda**. A conexão remota segura será feita em uma fase posterior; não exponha a porta 8080 à internet ou à rede local.

## O que será instalado

- Termux, para executar ferramentas Linux no Android.
- `llama.cpp`, compilado no próprio celular.
- Qwen2.5-0.5B-Instruct em GGUF Q4_0 (aprox. 429 MB).
- Um endpoint local compatível com a API de chat OpenAI em `http://127.0.0.1:8080`.

O modelo de 0,5 bilhão de parâmetros é um ponto de partida leve, não uma garantia de qualidade ou velocidade. O desempenho depende da variante do Note20, temperatura, RAM disponível e gerenciamento de energia do Android.

## Requisitos

- Samsung Galaxy Note20 5G com Android funcional e atualizado.
- Wi-Fi estável durante a instalação.
- Aproximadamente 2–3 GB livres para ferramentas de compilação, código-fonte, modelo e arquivos temporários.
- Termux instalado de uma fonte oficial atual, preferencialmente F-Droid ou GitHub oficial do Termux. Não misture versões de Termux e complementos instalados de fontes diferentes.

## Instalação

Abra o Termux no Note20 e execute os comandos abaixo, um por vez.

### 1. Preparar o Termux e baixar o código

```bash
pkg update -y
pkg install -y git
cd ~
git clone https://github.com/korczaktech/teste.git
cd ~/teste/mobile-inference/note20
```

Se `~/teste` já existir, atualize-o em vez de clonar novamente:

```bash
cd ~/teste
git pull --ff-only
cd ~/teste/mobile-inference/note20
```

### 2. Compilar o servidor e baixar o modelo

Mantenha o celular conectado à energia, evite outros aplicativos pesados e não feche o Termux durante a compilação.

```bash
bash install.sh
```

A compilação pode demorar bastante no celular. Se o Android encerrar o Termux por falta de memória, reinicie o aparelho, feche aplicativos e execute o mesmo comando novamente.

### 3. Iniciar o servidor local

```bash
bash start.sh
```

O servidor deve responder em:

- Health: `http://127.0.0.1:8080/health`
- Modelos: `http://127.0.0.1:8080/v1/models`
- Chat: `http://127.0.0.1:8080/v1/chat/completions`

O endereço `127.0.0.1` é intencional: nesta fase, somente processos no próprio celular conseguem acessar o servidor.

### 4. Executar o teste automático

```bash
bash test.sh
```

O teste consulta a saúde, lista os modelos e envia uma mensagem de teste. A primeira geração pode levar algum tempo. Considere a fase validada somente se as três chamadas terminarem sem erro e a resposta final fizer sentido.

### 5. Consultar logs e encerrar o servidor

```bash
tail -n 100 ~/zeus-inference/logs/llama-server.log
bash stop.sh
```

Para iniciar novamente, execute `bash ~/teste/mobile-inference/note20/start.sh`.

## Manter o servidor ativo

No Android, abra as informações do aplicativo Termux e configure a bateria para **Sem restrições** (o nome pode variar). Permita a execução em segundo plano e evite que o sistema coloque o Termux em suspensão. Para testes longos, mantenha o aparelho ventilado e conectado à energia; interrompa se aquecer excessivamente.

A instalação não configura inicialização automática após reinicialização. Isso será feito somente depois de confirmar estabilidade, consumo e comportamento térmico.

## Segurança

- Não altere `--host 127.0.0.1` para `0.0.0.0`.
- Não crie redirecionamento de porta no roteador.
- Não publique o endereço IP do celular nem deixe o endpoint acessível à rede.
- Não coloque chaves, senhas ou tokens no repositório.
- Esta fase é apenas execução local e teste. O Render não consegue acessar `127.0.0.1` do celular. A ponte remota autenticada e criptografada será implementada e validada em fase posterior.

## Critérios de aceite da Fase 1

- [ ] `llama-server` foi compilado no Note20.
- [ ] O arquivo GGUF existe e não está vazio.
- [ ] `/health` responde com sucesso.
- [ ] `/v1/models` responde com sucesso.
- [ ] `/v1/chat/completions` devolve uma resposta coerente.
- [ ] O log não contém erro de carregamento do modelo.
- [ ] O serviço escuta somente em `127.0.0.1:8080`.
- [ ] Um teste de 10–15 minutos não provoca encerramento nem aquecimento anormal.

A fase ainda não deve ser marcada como concluída até os testes reais no aparelho serem executados.
