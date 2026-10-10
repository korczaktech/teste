# Fase 2 — Galaxy J8 como servidor local de inferência

Esta fase prepara o Samsung Galaxy J8 para executar **Qwen2.5-1.5B-Instruct em GGUF Q4_K_M** usando `llama.cpp`. O Note20 continua sendo o segundo servidor previsto no plano geral; esta configuração do J8 é independente.

**Não conecta o celular ao Render e não altera a API do Zeus.** O servidor fica limitado a `127.0.0.1:8080`; não mude para `0.0.0.0` nem abra portas no roteador.

## Antes de começar

- Galaxy J8 com Termux atualizado, de uma fonte oficial (F-Droid ou GitHub oficial do Termux).
- Wi-Fi estável e celular conectado à energia durante a compilação.
- Recomendado: **4–5 GB livres** para ferramentas, código-fonte, modelo (~1,1 GB) e arquivos temporários.
- Feche aplicativos pesados. O desempenho varia conforme a versão do J8, RAM disponível, temperatura e estado da bateria.
- O modelo 1.5B exige mais memória que o modelo 0.5B. Se o Android encerrar a compilação ou o servidor, não insista repetidamente: reinicie, libere memória e tente novamente.

## 1. Baixar os scripts

No Termux do J8, execute:

```bash
pkg update -y
pkg install -y git
cd ~
git clone https://github.com/korczaktech/teste.git
cd ~/teste/mobile-inference/j8
```

Se `~/teste` já existir, atualize em vez de clonar novamente:

```bash
cd ~/teste
git pull --ff-only
cd ~/teste/mobile-inference/j8
```

## 2. Compilar e baixar o Qwen2.5 1.5B

Mantenha o Termux aberto e o telefone conectado à energia:

```bash
bash install.sh
```

O script compila `llama-server` no próprio aparelho e baixa o arquivo GGUF Q4_K_M. A compilação pode levar bastante tempo no J8.

## 3. Iniciar o servidor com tela apagada

Antes do primeiro teste, abra as configurações do Android para o Termux e configure a bateria como **Sem restrições** (o nome varia conforme a versão). Permita atividade em segundo plano.

Depois execute:

```bash
bash start.sh
```

O script solicita um wakelock do Termux para reduzir a chance de suspensão da CPU com a tela apagada. Isso não impede todos os fabricantes/versões do Android de encerrarem processos; valide com um teste real de tela apagada.

Endpoints locais:
- Health: `http://127.0.0.1:8080/health`
- Modelos: `http://127.0.0.1:8080/v1/models`
- Chat: `http://127.0.0.1:8080/v1/chat/completions`

## 4. Testar

```bash
bash test.sh
```

O teste verifica health, lista modelos e solicita uma resposta curta. Só considere a etapa validada se todas as chamadas funcionarem e o servidor continuar ativo.

## 5. Ver logs e parar

```bash
tail -n 100 ~/zeus-inference-j8/logs/llama-server.log
bash stop.sh
```

Para iniciar de novo:

```bash
bash ~/teste/mobile-inference/j8/start.sh
```

## Segurança e limites

- O servidor escuta apenas em `127.0.0.1`, acessível somente dentro do J8.
- Não crie redirecionamento de porta, não exponha o IP do celular e não publique a porta 8080.
- A API do Render não consegue acessar o localhost do J8. A ponte remota autenticada e criptografada será uma fase separada.
- O wakelock pode aumentar consumo de bateria e aquecimento. Use ventilação, monitore a temperatura e interrompa se aquecer excessivamente.
- O script não configura inicialização automática após reiniciar o Android.

## Critérios de aceite da Fase 2

- [ ] Compilação de `llama-server` concluída.
- [ ] Modelo Qwen2.5 1.5B GGUF existe e não está vazio.
- [ ] `/health` e `/v1/models` respondem.
- [ ] `/v1/chat/completions` retorna uma resposta válida.
- [ ] Servidor continua ativo com a tela apagada durante pelo menos 10 minutos.
- [ ] Sem encerramento por falta de memória ou aquecimento anormal.
- [ ] Confirmado que escuta apenas em `127.0.0.1:8080`.

A fase não é considerada aprovada antes desses testes reais no aparelho.
