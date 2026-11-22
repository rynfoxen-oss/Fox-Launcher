!ifndef FOX_INSTALLER_NSH_INCLUDED
!define FOX_INSTALLER_NSH_INCLUDED

!include "nsDialogs.nsh"

Var /GLOBAL launchLink
Var /GLOBAL foxUninstallDialog
Var /GLOBAL foxDeleteDataCheckbox
Var /GLOBAL foxDeleteDataState

# Every release gets its own generated uninstall key. Older Fox Launcher keys
# would otherwise stay behind and show duplicate versions in Control Panel.
# Remove any stale "Fox Launcher" uninstall entry, but keep the current one.
!macro foxRemoveStaleUninstallEntries root
  StrCpy $0 0
  foxStale_${root}_loop:
    EnumRegKey $1 ${root} "Software\Microsoft\Windows\CurrentVersion\Uninstall" $0
    StrCmp $1 "" foxStale_${root}_done
    ReadRegStr $2 ${root} "Software\Microsoft\Windows\CurrentVersion\Uninstall\$1" "DisplayName"
    StrCmp $2 "Fox Launcher" foxStale_${root}_remove foxStale_${root}_keep
  foxStale_${root}_remove:
    !ifdef UNINSTALL_APP_KEY
      StrCmp $1 "${UNINSTALL_APP_KEY}" foxStale_${root}_keep
    !endif
    DeleteRegKey ${root} "Software\Microsoft\Windows\CurrentVersion\Uninstall\$1"
    Goto foxStale_${root}_loop
  foxStale_${root}_keep:
    IntOp $0 $0 + 1
    Goto foxStale_${root}_loop
  foxStale_${root}_done:
!macroend

!macro foxRemoveLegacyUninstallEntry
  !insertmacro foxRemoveStaleUninstallEntries HKCU
  !ifdef INSTALL_MODE_PER_ALL_USERS
    !insertmacro foxRemoveStaleUninstallEntries HKLM
  !endif
  Delete "$DESKTOP\FoxLauncher.lnk"
  ClearErrors
  RMDir /r "$SMPROGRAMS\FoxLauncher"
  ClearErrors
!macroend

!macro customInstall
  !insertmacro foxRemoveLegacyUninstallEntry
!macroend

!macro customUnInstall
  !insertmacro foxRemoveLegacyUninstallEntry
  ${If} $foxDeleteDataState == 1
    RMDir /r "$LOCALAPPDATA\FoxLauncher"
  ${Else}
    Delete "$LOCALAPPDATA\FoxLauncher\FoxLauncher.exe"
    Delete "$LOCALAPPDATA\FoxLauncher\uninstall.cmd"
  ${EndIf}
  ClearErrors
!macroend

# Text and page customization. The bitmaps are supplied to electron-builder
# through nsis.installerHeader / nsis.installerSidebar in package.json so we do
# not redefine the MUI bitmap macros that electron-builder already defines.
!macro customHeader
  !define MUI_WELCOMEPAGE_TITLE "Welcome to Fox Launcher Setup"
  !define MUI_WELCOMEPAGE_TEXT "Fox Launcher is a fast, modern Minecraft launcher for Java Edition. Create local profiles, install any version and mod loader, browse every Minecraft version, pick exact mod releases, manage skins, boost FPS with one click, and keep your worlds in a dedicated folder."
  !define MUI_DIRECTORYPAGE_TEXT_TOP "Choose the folder where Fox Launcher will be installed. Your Minecraft data stays separate in the Fox Launcher app-data folder."
  !define MUI_DIRECTORYPAGE_TEXT_DESTINATION "Installation folder:"
  !define MUI_INSTFILESPAGE_FINISHHEADER_TEXT "Fox Launcher installation complete"
  !define MUI_FINISHPAGE_TITLE "Fox Launcher is ready"
  !define MUI_FINISHPAGE_TEXT "Setup is complete. Open Fox Launcher to create your profile, add an instance, and start playing."
  !define MUI_FINISHPAGE_RUN_TEXT "Launch Fox Launcher now"
  !define MUI_FINISHPAGE_LINK "Visit Minecraft.net"
  !define MUI_FINISHPAGE_LINK_LOCATION "https://www.minecraft.net/"

  !define MUI_UNWELCOMEPAGE_TITLE "Uninstall Fox Launcher"
  !define MUI_UNWELCOMEPAGE_TEXT "This wizard will remove Fox Launcher from your computer. You can choose whether to keep or remove your Minecraft worlds, instances, mods, skins, and settings."
  !define MUI_UNFINISHPAGE_TITLE "Fox Launcher has been removed"
  !define MUI_UNFINISHPAGE_TEXT "Fox Launcher was uninstalled. If you chose to keep your game data, it is still available in the Fox Launcher app-data folder."
!macroend

!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customFinishPage
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !insertmacro MUI_PAGE_FINISH
!macroend

!macro customUnWelcomePage
  !insertmacro MUI_UNPAGE_WELCOME
!macroend

!macro customUninstallPage
  UninstPage custom un.foxDataPageCreate un.foxDataPageLeave "Game data"
!macroend

Function un.foxDataPageCreate
  ${If} ${Silent}
    Abort
  ${EndIf}

  nsDialogs::Create 1018
  Pop $foxUninstallDialog
  ${If} $foxUninstallDialog == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 28u "Choose what happens to your game data"
  Pop $0
  ${NSD_CreateLabel} 0 34u 100% 56u "Fox Launcher stores worlds, instances, mods, resource packs, skins, and settings separately from the app files. Keep them if you plan to reinstall or switch launchers."
  Pop $0
  ${NSD_CreateCheckbox} 0 104u 100% 22u "&Also delete all Fox Launcher game data"
  Pop $foxDeleteDataCheckbox
  ${NSD_CreateLabel} 20u 132u 100% 46u "This permanently removes the Fox Launcher app-data folder, including worlds and mods. This cannot be undone."
  Pop $0

  nsDialogs::Show
FunctionEnd

Function un.foxDataPageLeave
  ${If} $foxUninstallDialog == error
    Return
  ${EndIf}

  ${NSD_GetState} $foxDeleteDataCheckbox $foxDeleteDataState
  ${If} $foxDeleteDataState != 1
    DetailPrint "Keeping Fox Launcher game data."
    Return
  ${EndIf}

  MessageBox MB_YESNO|MB_ICONEXCLAMATION "Permanently delete all Fox Launcher worlds, mods, instances, skins, and settings?$\r$\n$\r$\nThis cannot be undone." IDYES foxDeleteConfirmed
  ${NSD_Uncheck} $foxDeleteDataCheckbox
  Abort

foxDeleteConfirmed:
  DetailPrint "Removing Fox Launcher game data..."

  # Electron stores user data per user even for all-users installs.
  SetShellVarContext current

  RMDir /r "$APPDATA\${APP_FILENAME}"
  !ifdef APP_PRODUCT_FILENAME
    RMDir /r "$APPDATA\${APP_PRODUCT_FILENAME}"
  !endif
  !ifdef APP_PACKAGE_NAME
    RMDir /r "$APPDATA\${APP_PACKAGE_NAME}"
    RMDir /r "$LOCALAPPDATA\${APP_PACKAGE_NAME}"
  !endif
FunctionEnd

!ifndef BUILD_UNINSTALLER
Function StartApp
  ExecShell "open" "$launchLink"
FunctionEnd
!endif

!endif
