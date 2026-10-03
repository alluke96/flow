#Requires AutoHotkey v2.0
#SingleInstance Force

global macMode := true
BarraAutoOcultar(true)
Aviso("Modo Mac ATIVADO")

; Ctrl+Alt+Win+M liga/desliga o Modo Mac
^!#m:: {
    global macMode
    macMode := !macMode
    BarraAutoOcultar(macMode)
    Aviso(macMode ? "Modo Mac ATIVADO" : "Modo Mac desativado")
}

Aviso(texto) {
    ToolTip texto
    SetTimer () => ToolTip(), -1500
}

; Liga/desliga "ocultar barra de tarefas automaticamente"
BarraAutoOcultar(ligar) {
    abd := Buffer(A_PtrSize = 8 ? 48 : 36, 0)
    NumPut("UInt", abd.Size, abd, 0)
    NumPut("Ptr", WinExist("ahk_class Shell_TrayWnd"), abd, A_PtrSize)
    NumPut("Ptr", ligar ? 1 : 0, abd, abd.Size - A_PtrSize)
    DllCall("Shell32\SHAppBarMessage", "UInt", 0xA, "Ptr", abd)
}

; ============ SÓ FUNCIONA COM O MODO MAC LIGADO ============
#HotIf macMode

; --- Botões laterais do mouse ---
XButton2::Send "^!{Tab}"     ; botão da frente = Alt+Tab que fica aberto
XButton1::Send "#{Tab}"      ; botão de trás = todas as janelas e áreas de trabalho

; --- Rolagem invertida do mouse (igual Mac) ---
WheelUp::Send "{WheelDown}"
WheelDown::Send "{WheelUp}"

; --- Cmd (Alt esquerdo) + letra ---
<!a::Send "^a"               ; selecionar tudo
<!c::Send "^c"               ; copiar
<!+c::Send "#v"              ; Cmd+Shift+C = histórico da área de transferência
<!v::Send "^v"               ; colar
<!x::Send "^x"               ; recortar
<!z::Send "^z"               ; desfazer
<!+z::Send "^y"              ; refazer
<!s::Send "^s"               ; salvar
<!+s::Send "^+s"             ; salvar como
<!f::Send "^f"               ; buscar
<!t::Send "^t"               ; nova aba
<!+t::Send "^+t"             ; reabrir aba fechada
<!w::Send "^w"               ; fechar aba
<!n::Send "^n"               ; nova janela
<!o::Send "^o"               ; abrir
<!p::Send "^p"               ; imprimir
<!r::Send "^r"               ; recarregar
<!l::Send "^l"               ; barra de endereço

; --- Outros atalhos ---
<!Space::Send "^{Esc}"       ; Cmd+Espaço = Menu Iniciar
<!q::Send "!{F4}"            ; Cmd+Q = fechar app
<!m::WinMinimize "A"         ; Cmd+M = minimizar
<!+3::Send "{PrintScreen}"   ; Cmd+Shift+3 = print da tela
<!+4::Send "#+s"             ; Cmd+Shift+4 = print de área
^<!+4::Send "#+s"            ; Ctrl+Shift+Cmd+4 = print de área (requer a "tecla Office" desativada, ver README)

; --- Cmd + setas ---
<!Left::Send "{Home}"
<!Right::Send "{End}"
<!Up::Send "^{Home}"
<!Down::Send "^{End}"
<!+Left::Send "+{Home}"
<!+Right::Send "+{End}"
<!+Up::Send "^+{Home}"
<!+Down::Send "^+{End}"
<!Backspace::Send "+{Home}{Delete}"

#HotIf
