# Modo Mac no Windows

Script do [AutoHotkey v2](https://www.autohotkey.com/) que deixa o Windows 11 com atalhos e comportamento parecidos com o macOS. O Alt esquerdo passa a funcionar como o Cmd.

## Instalação

1. Instale o **AutoHotkey v2**.
2. Dê dois cliques em `mac.ahk`. Deve aparecer o aviso "Modo Mac ATIVADO".
3. Para abrir junto com o Windows: `Win+R` → `shell:startup` → coloque um atalho do `mac.ahk` nessa pasta.
4. Desative a "tecla Office" (`Ctrl+Shift+Alt+Win`). Sem isso, o `Ctrl+Shift+Cmd+4` abre o Copilot em vez do print. No Prompt de Comando:

   ```
   REG ADD HKCU\Software\Classes\ms-officeapp\Shell\Open\Command /t REG_SZ /d rundll32 /f
   ```

   Para desfazer: `REG DELETE HKCU\Software\Classes\ms-officeapp /f`

## O que o Modo Mac faz

`Ctrl+Alt+Win+M` liga e desliga tudo. O script sempre abre com o modo ligado.

| Atalho | Ação |
|---|---|
| Cmd + A / C / V / X / Z | selecionar tudo / copiar / colar / recortar / desfazer |
| Cmd + Shift + Z | refazer |
| Cmd + S / Shift+S / F / P / O | salvar / salvar como / buscar / imprimir / abrir |
| Cmd + T / Shift+T / W / N / R / L | nova aba / reabrir aba / fechar aba / nova janela / recarregar / barra de endereço |
| Cmd + Shift + C | histórico da área de transferência (`Win+V`) |
| Cmd + Espaço | Menu Iniciar |
| Cmd + Q / M | fechar app / minimizar |
| Cmd + Shift + 3 | print da tela |
| Cmd + Shift + 4, Ctrl + Shift + Cmd + 4 | print de área (`Win+Shift+S`) |
| Cmd + ← / → / ↑ / ↓ (com Shift seleciona) | início/fim da linha e do documento |
| Cmd + Backspace | apaga até o início da linha |
| Botão da frente do mouse | Alt+Tab que fica aberto |
| Botão de trás do mouse | visão de todas as janelas (`Win+Tab`) |
| Rolagem do mouse | invertida ("natural") |
| Barra de tarefas | oculta automaticamente |
