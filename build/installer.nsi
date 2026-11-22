Var newStartMenuLink
Var oldStartMenuLink
Var newDesktopLink
Var oldDesktopLink
Var oldShortcutName
Var oldMenuDirectory

!include "common.nsh"
!include "MUI2.nsh"
!include "multiUser.nsh"
!include "allowOnlyOneInstallerInstance.nsh"

!ifdef INSTALL_MODE_PER_ALL_USERS
  RequestExecutionLevel admin
!else
  RequestExecutionLevel user
!endif

Var appExe

!ifmacrodef customHeader
  !insertmacro customHeader
!endif

# electron-builder does not define BUILD_UNINSTALLER for custom NSIS scripts,
# so the assisted installer template above only registers installer pages.
# Register the matching uninstaller pages here.
!ifndef BUILD_UNINSTALLER
  !ifndef ONE_CLICK
    !ifmacrodef customUnWelcomePage
      !insertmacro customUnWelcomePage
    !else
      !insertmacro MUI_UNPAGE_WELCOME
    !endif
    !insertmacro MUI_UNPAGE_INSTFILES
    !ifmacrodef customUninstallPage
      !insertmacro customUninstallPage
    !endif
    !insertmacro MUI_UNPAGE_FINISH
  !else
    !insertmacro MUI_UNPAGE_INSTFILES
  !endif
!endif

!ifdef ONE_CLICK
  !include "oneClick.nsh"
!else
  !include "assistedInstaller.nsh"
!endif

!insertmacro addLangs

Function .onInit
  Call setInstallSectionSpaceRequired

  SetOutPath $INSTDIR
  ${LogSet} on

  !ifmacrodef preInit
    !insertmacro preInit
  !endif

  !ifdef DISPLAY_LANG_SELECTOR
    !insertmacro MUI_LANGDLL_DISPLAY
  !endif

  !insertmacro check64BitAndSetRegView

  !ifdef ONE_CLICK
    !insertmacro ALLOW_ONLY_ONE_INSTALLER_INSTANCE
  !else
    ${IfNot} ${UAC_IsInnerInstance}
      !insertmacro ALLOW_ONLY_ONE_INSTALLER_INSTANCE
    ${EndIf}
  !endif

  !insertmacro initMultiUser

  !ifmacrodef customInit
    !insertmacro customInit
  !endif

  !ifmacrodef addLicenseFiles
    InitPluginsDir
    !insertmacro addLicenseFiles
  !endif
FunctionEnd

!include "installUtil.nsh"

Section "install" INSTALL_SECTION_ID
  !include "${BUILD_RESOURCES_DIR}\installSection.nsh"
SectionEnd

Function setInstallSectionSpaceRequired
  !insertmacro setSpaceRequired ${INSTALL_SECTION_ID}
FunctionEnd

!macro customCheckAppRunning
!macroend
!include "uninstaller.nsh"
